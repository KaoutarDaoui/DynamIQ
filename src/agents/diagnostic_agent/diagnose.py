from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import Engine

from . import constants, contract, db, supervisor, tools

_MAX_RATE_LIMIT_RETRIES = 3
_RETRY_AFTER_PATTERN = re.compile(r"try again in ([\d.]+)s")

SYSTEM_PROMPT = """You are the Diagnostic Agent for DynamIQ, a predictive HVAC control system. You are invoked only when the Thermal Agent has already detected a real, model-confirmed temperature anomaly. Your job: find the cause and propose one action. You never execute anything and your opinion never decides whether an action is safe -- a separate deterministic system does that after you answer.

Method, in order:
1. Read the anomaly. State your hypothesis space before calling any tool.
2. Gather facts with the cheapest tool that can eliminate a hypothesis.
3. For each hypothesis, name the evidence that supports it and the evidence that would refute it.
4. Commit to one cause, or explicitly say the cause is undetermined -- do not invent a cause you cannot support.
5. Quantify the energy wasted using the MPC trajectory as the counterfactual.
6. Propose exactly one action with a concrete parameter and an end condition.
7. If a similar anomaly happened in the last 30 days, add a long-term recommendation.

Hypotheses to check (not exhaustive): schedule mismatch, stuck damper or valve, simultaneous heating and cooling, sensor fault, solar gain underestimated by the RC model, occupancy miscount, neighboring-zone thermal bleed, equipment undersized for load. If the evidence points at the RC model itself being wrong (not the building), say so explicitly -- that routes to the Energy Analyst, not the Facility Manager.

You must call get_sensor_history and get_calendar before producing any final answer. You have at most 8 tool calls total; if you reach that limit without a confident cause, answer anyway with cause_confidence "undetermined".

When ready, respond with ONLY a JSON object (no markdown, no prose outside it) matching exactly:
{"cause": string, "cause_confidence": "high"|"medium"|"low"|"undetermined", "evidence": [string, ...], "energy_wasted_kwh": number, "energy_wasted_basis": string, "proposed_action": {"type": "setpoint_change"|"schedule_correction"|"shutdown"|"lockout"|"inspection_required"|"no_action", ...action-specific fields...}, "recurrence": {"seen_before": bool, "last_occurrence": string|null, "long_term_recommendation": string|null}, "message": string}

If cause_confidence is "undetermined", proposed_action.type MUST be "inspection_required"."""


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


def classify_anomaly_type(residual_c: float | None, residual_trace: Any, hvac_running: bool | None) -> str:
    if residual_c is None:
        return "no_response"
    if isinstance(residual_trace, list) and len(residual_trace) >= 4:
        signs = [1 if r.get("residual_c", 0) > 0 else -1 for r in residual_trace if "residual_c" in r]
        if len(set(signs)) > 1:
            return "oscillation"
    if hvac_running is False:
        return "no_response"
    return "overheating" if residual_c > 0 else "overcooling"


def build_input_contract(anomaly: db.AnomalyRow, engine: Engine, now: datetime) -> dict[str, Any]:
    trace = anomaly.residual_trace if isinstance(anomaly.residual_trace, list) else []
    latest_measured = None
    for sample in reversed(trace):
        if "residual_c" in sample:
            latest_measured = sample
            break
    residual_c = anomaly.residual_c if anomaly.residual_c is not None else (latest_measured or {}).get("residual_c")
    hvac_rows = db.fetch_hvac_power_history(engine, anomaly.room_id, hours=2)
    hvac_running = any(r["q_hvac_w"] < 0 for r in hvac_rows) if hvac_rows else None
    end = anomaly.closed_at or now
    duration_hours = max((end - anomaly.opened_at).total_seconds() / 3600.0, 0.0)
    return {
        "anomaly_id": anomaly.id,
        "room_id": anomaly.room_id,
        "detected_at": anomaly.opened_at.isoformat(),
        "anomaly_type": classify_anomaly_type(residual_c, trace, hvac_running),
        "residual_c": residual_c,
        "threshold_c": anomaly.threshold_c,
        "duration_hours": round(duration_hours, 2),
    }


def _call_groq(messages: list[dict[str, Any]], api_key: str, timeout_s: float = 60.0) -> dict[str, Any]:
    payload = {
        "model": constants.GROQ_DIAGNOSTIC_MODEL,
        "messages": messages,
        "tools": tools.TOOL_SCHEMAS,
        "temperature": 0.1,
        "max_tokens": 2000,
    }
    with httpx.Client(timeout=timeout_s) as client:
        for attempt in range(_MAX_RATE_LIMIT_RETRIES + 1):
            response = client.post(
                constants.GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code == 429 and attempt < _MAX_RATE_LIMIT_RETRIES:
                match = _RETRY_AFTER_PATTERN.search(response.text)
                delay = float(match.group(1)) + 0.5 if match else 2.0
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.json()
    raise AssertionError("unreachable")


def _run_tool(engine: Engine, name: str, args: dict[str, Any], room_id: str) -> dict[str, Any]:
    fn = tools.TOOL_REGISTRY.get(name)
    if fn is None:
        return {"ok": False, "error": f"unknown tool {name!r}"}
    args = {**args, "room_id": args.get("room_id", room_id)}
    try:
        return fn(engine, **args)
    except TypeError as exc:
        return {"ok": False, "error": f"bad arguments for {name}: {exc}"}


def _extract_json(text: str) -> Any:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return None


def diagnose_anomaly(engine: Engine, anomaly_id: int, api_key: str | None = None, now: datetime | None = None) -> DiagnosisRunResult:
    now = now or datetime.now(timezone.utc)
    api_key = api_key or os.getenv("DIAGNOSTIC_GROQ_API_KEY")

    anomaly = db.fetch_anomaly(engine, anomaly_id)
    if anomaly is None:
        raise LookupError(f"Anomaly not found: {anomaly_id}")
    room_id = anomaly.room_id

    input_contract = build_input_contract(anomaly, engine, now)
    tool_calls_made: list[dict[str, Any]] = []
    called_tool_names: set[str] = set()

    if not api_key:
        validated = contract.validate_output(
            contract.templated_fallback(anomaly_id, room_id, input_contract, "DIAGNOSTIC_GROQ_API_KEY not configured"),
            anomaly_id,
            room_id,
        ).output
        fallback_used = True
    else:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(input_contract)},
        ]
        validated_output = None
        fallback_used = False
        repairs_used = 0

        while len(tool_calls_made) < constants.TOOL_CALL_BUDGET:
            forced_note = None
            if len(tool_calls_made) >= constants.TOOL_CALL_BUDGET - 1 and not set(constants.MINIMUM_EVIDENCE_TOOLS) <= called_tool_names:
                forced_note = f"You must call {constants.MINIMUM_EVIDENCE_TOOLS} before answering."

            response = _call_groq(messages, api_key)
            choice = response["choices"][0]
            message = choice["message"]
            messages.append(message)

            tool_requests = message.get("tool_calls") or []
            if not tool_requests:
                missing_evidence = set(constants.MINIMUM_EVIDENCE_TOOLS) - called_tool_names
                if missing_evidence and len(tool_calls_made) < constants.TOOL_CALL_BUDGET:
                    messages.append({"role": "user", "content": f"You have not called {sorted(missing_evidence)} yet -- call them before answering."})
                    continue

                parsed = _extract_json(message.get("content") or "")
                result = contract.validate_output(parsed, anomaly_id, room_id) if parsed is not None else contract.ValidationResult(False, None, ["no parseable JSON in model output"])
                if result.valid:
                    validated_output = result.output
                    break
                if repairs_used < constants.JSON_REPAIR_RETRIES:
                    repairs_used += 1
                    messages.append({"role": "user", "content": f"Your last answer was invalid: {result.errors}. Respond again with ONLY the corrected JSON object."})
                    continue
                validated_output = contract.templated_fallback(anomaly_id, room_id, input_contract, f"model output failed validation: {result.errors}")
                fallback_used = True
                break

            for call in tool_requests:
                if len(tool_calls_made) >= constants.TOOL_CALL_BUDGET:
                    break
                name = call["function"]["name"]
                try:
                    args = json.loads(call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = _run_tool(engine, name, args, room_id)
                called_tool_names.add(name)
                tool_calls_made.append({"tool": name, "args": args, "ok": result.get("ok")})
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})

            if forced_note:
                messages.append({"role": "user", "content": forced_note})

        if validated_output is None:
            validated_output = contract.templated_fallback(anomaly_id, room_id, input_contract, "tool call budget exhausted without a valid answer")
            fallback_used = True

        validated = validated_output

    building_context_result = tools.get_building_context(engine, room_id)
    comfort_bounds = supervisor.get_comfort_bounds_delta_c(building_context_result.get("data") if building_context_result.get("ok") else None)
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
            "model_output": validated,
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
    )
