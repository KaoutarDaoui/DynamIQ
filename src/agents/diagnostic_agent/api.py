from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents.logging_config import configure_agent_logging
from . import diagnose
from .db import fetch_anomaly, get_engine

configure_agent_logging("agents.diagnostic_agent", "diagnostic_agent.log")

app = FastAPI(title="DynamIQ Diagnostic Agent API")

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


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model=os.getenv("GROQ_DIAGNOSTIC_MODEL", "llama-3.3-70b-versatile"),
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
