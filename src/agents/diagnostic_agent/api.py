from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents.logging_config import configure_agent_logging
from . import constants, diagnose
from .db import ensure_action_decisions_table, fetch_anomaly, fetch_audit_log, fetch_action_decision, insert_action_decision, get_engine

configure_agent_logging("agents.diagnostic_agent", "diagnostic_agent.log")

app = FastAPI(title="DynamIQ Diagnostic Agent API")


@app.on_event("startup")
def _ensure_tables() -> None:
    ensure_action_decisions_table(get_engine())

_DEFAULT_CORS_ORIGINS = ",".join(
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(5173, 5178)
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("DIAGNOSTIC_API_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    model: str
    api_key_configured: bool


class AnomalyOut(BaseModel):
    id: int
    room_id: str
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None
    residual_c: float | None
    threshold_c: float | None
    diagnosed: bool


class SupervisorDecisionOut(BaseModel):
    decision: str
    reason: str


class DiagnosisResultOut(BaseModel):
    anomaly_id: int
    room_id: str
    diagnosis_id: int | None
    audit_log_id: int
    supervisor_decision: SupervisorDecisionOut
    cause: str
    cause_confidence: str
    energy_wasted_kwh: float
    proposed_action: dict[str, Any]
    fallback_used: bool
    tool_calls_made: list[dict[str, Any]]
    node_trace: list[str]
    timestamps: dict[str, str]


class ToolCallOut(BaseModel):
    tool: str
    args: dict[str, Any]
    result: dict[str, Any]
    result_summary: str = ""
    timestamp: str


class AuditLogOut(BaseModel):
    id: int
    anomaly_id: int
    room_id: str
    invoked_at: datetime
    tool_calls: list[ToolCallOut]
    model_output: dict[str, Any]
    supervisor_decision: dict[str, Any]
    diagnosis_id: int | None
    created_at: datetime
    action_decision: ActionDecisionOut | None = None


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model=constants.GROQ_DIAGNOSTIC_MODEL,
        api_key_configured=bool(os.getenv("DIAGNOSTIC_GROQ_API_KEY")),
    )


@app.get("/anomalies/{anomaly_id}", response_model=AnomalyOut)
def get_anomaly(anomaly_id: int) -> AnomalyOut:
    row = fetch_anomaly(get_engine(), anomaly_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    return AnomalyOut(
        id=row.id,
        room_id=row.room_id,
        anomaly_type=row.anomaly_type,
        opened_at=row.opened_at,
        closed_at=row.closed_at,
        residual_c=row.residual_c,
        threshold_c=row.threshold_c,
        diagnosed=row.diagnosed,
    )


@app.post("/anomalies/{anomaly_id}/diagnose", response_model=DiagnosisResultOut)
def diagnose_anomaly_endpoint(anomaly_id: int) -> DiagnosisResultOut:
    engine = get_engine()
    if fetch_anomaly(engine, anomaly_id) is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    try:
        result = diagnose.diagnose_anomaly(engine, anomaly_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {exc}")
    return DiagnosisResultOut(
        anomaly_id=result.anomaly_id,
        room_id=result.room_id,
        diagnosis_id=result.diagnosis_id,
        audit_log_id=result.audit_log_id,
        supervisor_decision=SupervisorDecisionOut(
            decision=result.supervisor_decision.decision,
            reason=result.supervisor_decision.reason,
        ),
        cause=result.validated_output["cause"],
        cause_confidence=result.validated_output["cause_confidence"],
        energy_wasted_kwh=result.validated_output["energy_wasted_kwh"],
        proposed_action=result.validated_output["proposed_action"],
        fallback_used=result.fallback_used,
        tool_calls_made=result.tool_calls_made,
        node_trace=result.node_trace,
        timestamps=result.timestamps,
    )


@app.get("/anomalies/{anomaly_id}/audit", response_model=AuditLogOut)
def get_audit_log(anomaly_id: int) -> AuditLogOut:
    engine = get_engine()
    if fetch_anomaly(engine, anomaly_id) is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    audit = fetch_audit_log(engine, anomaly_id)
    if audit is None:
        raise HTTPException(status_code=404, detail=f"Audit log not found for anomaly: {anomaly_id}")
    decision = fetch_action_decision(engine, anomaly_id)
    decision_out = None
    if decision is not None:
        decision_out = ActionDecisionOut(
            id=decision["id"],
            anomaly_id=decision["anomaly_id"],
            diagnosis_id=decision["diagnosis_id"],
            room_id=decision["room_id"],
            decision=decision["decision"],
            action_type=decision["action_type"],
            delta_c=decision["delta_c"],
            decided_by=decision["decided_by"],
            decided_at=decision["decided_at"],
        )
    tool_calls = []
    for tc in audit.get("tool_calls", []):
        tool_calls.append(ToolCallOut(
            tool=tc.get("tool", ""),
            args=tc.get("params") or tc.get("args") or {},
            result=tc.get("result") or {},
            result_summary=tc.get("result_summary") or "",
            timestamp=tc.get("timestamp", ""),
        ))
    return AuditLogOut(
        id=audit["id"],
        anomaly_id=audit["anomaly_id"],
        room_id=audit["room_id"],
        invoked_at=audit["invoked_at"],
        tool_calls=tool_calls,
        model_output=audit.get("model_output", {}),
        supervisor_decision=audit.get("supervisor_decision", {}),
        diagnosis_id=audit.get("diagnosis_id"),
        created_at=audit["created_at"],
        action_decision=decision_out,
    )


class ActionDecisionOut(BaseModel):
    id: int
    anomaly_id: int
    diagnosis_id: int | None
    room_id: str
    decision: str
    action_type: str | None
    delta_c: float | None
    decided_by: str | None
    decided_at: datetime


class ActionDecisionRequest(BaseModel):
    decision: str
    decided_by: str | None = None


@app.get("/anomalies/{anomaly_id}/action-decision", response_model=ActionDecisionOut)
def get_action_decision(anomaly_id: int) -> ActionDecisionOut:
    engine = get_engine()
    if fetch_anomaly(engine, anomaly_id) is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    decision = fetch_action_decision(engine, anomaly_id)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"No action decision recorded for anomaly: {anomaly_id}")
    return ActionDecisionOut(
        id=decision["id"],
        anomaly_id=decision["anomaly_id"],
        diagnosis_id=decision["diagnosis_id"],
        room_id=decision["room_id"],
        decision=decision["decision"],
        action_type=decision["action_type"],
        delta_c=decision["delta_c"],
        decided_by=decision["decided_by"],
        decided_at=decision["decided_at"],
    )


@app.post("/anomalies/{anomaly_id}/action-decision", response_model=ActionDecisionOut)
def post_action_decision(anomaly_id: int, body: ActionDecisionRequest) -> ActionDecisionOut:
    engine = get_engine()
    anomaly = fetch_anomaly(engine, anomaly_id)
    if anomaly is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    if body.decision not in ("applied", "rejected"):
        raise HTTPException(status_code=422, detail="decision must be 'applied' or 'rejected'")
    audit = fetch_audit_log(engine, anomaly_id)
    diagnosis_id = audit.get("diagnosis_id") if audit else None
    action = (audit.get("model_output") or {}).get("proposed_action", {}) if audit else {}
    decision_id = insert_action_decision(
        engine,
        {
            "anomaly_id": anomaly_id,
            "diagnosis_id": diagnosis_id,
            "room_id": anomaly.room_id,
            "decision": body.decision,
            "action_type": action.get("type"),
            "delta_c": action.get("delta_c"),
            "decided_by": body.decided_by or "facility_manager",
        },
    )
    decision = fetch_action_decision(engine, anomaly_id)
    decision["id"] = decision_id
    return ActionDecisionOut(
        id=decision["id"],
        anomaly_id=decision["anomaly_id"],
        diagnosis_id=decision["diagnosis_id"],
        room_id=decision["room_id"],
        decision=decision["decision"],
        action_type=decision["action_type"],
        delta_c=decision["delta_c"],
        decided_by=decision["decided_by"],
        decided_at=decision["decided_at"],
    )
