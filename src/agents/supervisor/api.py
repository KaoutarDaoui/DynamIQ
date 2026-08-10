from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agents.thermal_agent.db import fetch_instrumented_room_ids

from . import constants, orchestrate
from .db import fetch_undiagnosed_anomaly_ids, get_engine

app = FastAPI(title="DynamIQ Supervisor Agent API")

_DEFAULT_CORS_ORIGINS = ",".join(
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(5173, 5178)
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("SUPERVISOR_API_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# No real occupancy schedule exists yet -- the fast loop needs a per-room
# occupied array. Default to the ESI class schedule used everywhere else
# (occupied 08:00-16:00, UTC) unless the caller overrides it per room.
_DEFAULT_OCCUPIED_START_H = 8
_DEFAULT_OCCUPIED_END_H = 16
_DEFAULT_HORIZON_SLOTS = 96  # 24h at 15-min resolution


def _default_occupied_horizon() -> np.ndarray:
    now = datetime.now()
    return np.array([_DEFAULT_OCCUPIED_START_H <= (now.hour + int(k / 4)) % 24 < _DEFAULT_OCCUPIED_END_H for k in range(_DEFAULT_HORIZON_SLOTS)], dtype=bool)


def _occupied_by_room(engine, building_id: str, explicit: dict[str, list[bool]] | None) -> dict[str, np.ndarray]:
    occupied: dict[str, np.ndarray] = {}
    for room_id in fetch_instrumented_room_ids(engine, building_id):
        flags = explicit.get(room_id) if explicit else None
        if flags:
            occupied[room_id] = np.array(flags, dtype=bool)
        else:
            occupied[room_id] = _default_occupied_horizon()
    return occupied


class HealthResponse(BaseModel):
    status: str
    fast_loop_interval_minutes: int
    calibration_interval_hours: int


class FastLoopRoomOut(BaseModel):
    room_id: str
    ran_control: bool
    reason: str
    mpc_status: str | None
    comfort_violated: bool | None
    anomaly_stage: str | None


class DiagnosisOut(BaseModel):
    anomaly_id: int
    diagnosis_id: int | None
    decision: str
    reason: str
    cause: str
    fallback_used: bool


class CycleResultOut(BaseModel):
    building_id: str
    ran_at: datetime
    calibration: list[dict[str, Any]] | None
    fast_loop: list[FastLoopRoomOut]
    diagnoses: list[DiagnosisOut]
    alerts_dispatched: list[dict[str, Any]]


class RunCycleRequest(BaseModel):
    occupied_by_room: dict[str, list[bool]] | None = Field(default=None, description="Per-room occupied array (24h, 15-min steps). Defaults to 08:00-16:00 UTC occupancy for every instrumented room.")
    offline: bool = Field(default=False, description="Use offline weather/carbon forecasts (no network calls).")
    force_calibration: bool = Field(default=False, description="Force an RC calibration sweep this cycle, ignoring the 24h interval.")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        fast_loop_interval_minutes=constants.FAST_LOOP_INTERVAL_MINUTES,
        calibration_interval_hours=constants.CALIBRATION_INTERVAL_HOURS,
    )


@app.get("/buildings/{building_id}/undiagnosed-anomalies", response_model=list[int])
def undiagnosed_anomalies(building_id: str) -> list[int]:
    return fetch_undiagnosed_anomaly_ids(get_engine(), building_id)


@app.post("/buildings/{building_id}/run-cycle", response_model=CycleResultOut)
def run_cycle(building_id: str, body: RunCycleRequest | None = None) -> CycleResultOut:
    body = body or RunCycleRequest()
    engine = get_engine()
    occupied_by_room = _occupied_by_room(engine, building_id, body.occupied_by_room)
    result = orchestrate.run_full_cycle(
        engine,
        building_id,
        occupied_by_room,
        offline=body.offline,
        force_calibration=body.force_calibration,
    )
    return CycleResultOut(
        building_id=result.building_id,
        ran_at=datetime.now(),
        calibration=[
            {
                "room_id": c.room_id if hasattr(c, "room_id") else None,
                "accepted": c.accepted if hasattr(c, "accepted") else None,
                "reason": c.reason if hasattr(c, "reason") else None,
                "version": c.version if hasattr(c, "version") else None,
            }
            for c in (result.calibration_results or [])
        ],
        fast_loop=[
            FastLoopRoomOut(
                room_id=r.room_id,
                ran_control=r.ran_control,
                reason=r.reason,
                mpc_status=r.mpc_status,
                comfort_violated=r.comfort_violated,
                anomaly_stage=r.anomaly.stage if r.anomaly else None,
            )
            for r in result.fast_loop_results
        ],
        diagnoses=[
            DiagnosisOut(
                anomaly_id=d.anomaly_id,
                diagnosis_id=d.diagnosis_id,
                decision=d.supervisor_decision.decision,
                reason=d.supervisor_decision.reason,
                cause=d.validated_output["cause"],
                fallback_used=d.fallback_used,
            )
            for d in result.diagnosis_results
        ],
        alerts_dispatched=result.alerts_dispatched,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("agents.supervisor.api:app", host="0.0.0.0", port=8003, reload=True)
