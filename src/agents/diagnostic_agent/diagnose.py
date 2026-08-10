from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Engine

from . import constants, contract, db, graph, supervisor, tools
from .checkpointer import get_checkpointer
from .input_contract import build_input_contract


@dataclass(frozen=True)
class DiagnosisRunResult:
    anomaly_id: int
    room_id: str
    diagnosis_id: int | None
    audit_log_id: int
    supervisor_decision: supervisor.SupervisorDecision
    validated_output: dict[str, Any]
    tool_calls_made: list[dict[str, Any]]
    fallback_used: bool
    node_trace: list[str]
    timestamps: dict[str, str]


def diagnose_anomaly(
    engine: Engine,
    anomaly_id: int,
    api_key: str | None = None,
    now: datetime | None = None,
    checkpointer: Any | None = None,
) -> DiagnosisRunResult:
    now = now or datetime.now(timezone.utc)
    api_key = api_key or os.getenv("DIAGNOSTIC_GROQ_API_KEY")

    anomaly = db.fetch_anomaly(engine, anomaly_id)
    if anomaly is None:
        raise LookupError(f"Anomaly not found: {anomaly_id}")
    room_id = anomaly.room_id

    if not api_key:
        input_contract = build_input_contract(anomaly, engine, now)
        validated = contract.templated_fallback(
            anomaly_id, room_id, input_contract, "DIAGNOSTIC_GROQ_API_KEY not configured"
        )
        tool_calls_made: list[dict[str, Any]] = []
        fallback_used = True
        node_trace = ["build_contract", "fallback_node", "END"]
        timestamps: dict[str, str] = {"build_contract": now.isoformat()}
    else:
        checkpointer = checkpointer or get_checkpointer()
        final_state = graph.run_investigation(engine, anomaly_id, api_key, now=now, checkpointer=checkpointer)
        validated = final_state["validated_output"]
        tool_calls_made = final_state.get("tool_calls_made") or []
        fallback_used = bool(final_state.get("fallback_used"))
        node_trace = final_state.get("node_trace") or []
        timestamps = final_state.get("timestamps") or {}

    building_context_result = tools.get_building_context(engine, room_id)
    comfort_bounds = supervisor.get_comfort_bounds_delta_c(
        building_context_result.get("data") if building_context_result.get("ok") else None
    )
    recent = db.fetch_recent_diagnoses_for_cooldown(engine, room_id, validated["cause"], constants.COOLDOWN_DAYS)
    decision = supervisor.decide(validated, comfort_bounds, recent, now)

    diagnosis_id = db.insert_diagnosis(
        engine,
        {
            "anomaly_id": anomaly_id,
            "room_id": room_id,
            "cause": validated["cause"],
            "cause_confidence": validated["cause_confidence"],
            "evidence": validated["evidence"],
            "energy_wasted_kwh": validated["energy_wasted_kwh"],
            "energy_wasted_basis": validated["energy_wasted_basis"],
            "proposed_action": validated["proposed_action"],
            "recurrence": validated["recurrence"],
            "message": validated["message"],
            "supervisor_decision": decision.decision,
        },
    )
    db.mark_anomaly_diagnosed(engine, anomaly_id)

    if decision.decision == "human_alert":
        db.insert_alert(engine, diagnosis_id, room_id, channel="log", recipient="facility_manager", payload=validated)

    audit_log_id = db.insert_audit_log(
        engine,
        {
            "anomaly_id": anomaly_id,
            "room_id": room_id,
            "invoked_at": now,
            "tool_calls": tool_calls_made,
            "model_output": {**validated, "_trace": {"node_trace": node_trace, "timestamps": timestamps, "fallback_used": fallback_used}},
            "supervisor_decision": {"decision": decision.decision, "reason": decision.reason},
            "diagnosis_id": diagnosis_id,
        },
    )

    return DiagnosisRunResult(
        anomaly_id=anomaly_id,
        room_id=room_id,
        diagnosis_id=diagnosis_id,
        audit_log_id=audit_log_id,
        supervisor_decision=decision,
        validated_output=validated,
        tool_calls_made=tool_calls_made,
        fallback_used=fallback_used,
        node_trace=node_trace,
        timestamps=timestamps,
    )
