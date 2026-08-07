from __future__ import annotations
import os
from datetime import datetime
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from . import constants
from .db import fetch_alerts_overview, fetch_anomaly_detail, fetch_anomalies_overview, fetch_diagnoses_overview, fetch_latest_mpc_schedule, fetch_mpc_rooms, fetch_reports_summary, fetch_room, fetch_thermal_overview, get_engine

app = FastAPI(title="DynamIQ Thermal Agent API")

_DEFAULT_CORS_ORIGINS = ",".join(
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(5173, 5178)
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("THERMAL_API_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)


class ThermalModelRoom(BaseModel):
    room_id: str
    room_label: str
    floor_id: str
    floor_level: int
    area_m2: float
    is_instrumented: bool
    is_calibrated: bool
    version: int | None
    r_lumped_k_per_w: float | None
    c_lumped_j_per_k: float | None
    rmse_validation_c: float | None
    anomaly_threshold_c: float | None
    data_window_start: datetime | None
    data_window_end: datetime | None
    calibrated_at: datetime | None


@app.get("/buildings/{building_id}/thermal-models", response_model=list[ThermalModelRoom])
def get_thermal_models(building_id: str) -> list[ThermalModelRoom]:
    rows = fetch_thermal_overview(get_engine(), building_id)
    if not rows:
        raise HTTPException(status_code=404, detail=f"No rooms found for building {building_id!r}")
    return [
        ThermalModelRoom(
            room_id=r.room_id,
            room_label=r.room_label,
            floor_id=r.floor_id,
            floor_level=r.floor_level,
            area_m2=r.area_m2,
            is_instrumented=r.sensor_id is not None,
            is_calibrated=r.version is not None,
            version=r.version,
            r_lumped_k_per_w=r.r_lumped,
            c_lumped_j_per_k=r.c_lumped,
            rmse_validation_c=r.rmse_validation,
            anomaly_threshold_c=r.anomaly_threshold_c,
            data_window_start=r.data_window_start,
            data_window_end=r.data_window_end,
            calibrated_at=r.calibrated_at,
        )
        for r in rows
    ]


class MpcRoomSummary(BaseModel):
    room_id: str
    room_label: str
    floor_level: int
    latest_solved_at: datetime


@app.get("/buildings/{building_id}/mpc-rooms", response_model=list[MpcRoomSummary])
def get_mpc_rooms(building_id: str) -> list[MpcRoomSummary]:
    rows = fetch_mpc_rooms(get_engine(), building_id)
    return [MpcRoomSummary(room_id=r.room_id, room_label=r.room_label, floor_level=r.floor_level, latest_solved_at=r.latest_solved_at) for r in rows]


class MpcScheduleSlot(BaseModel):
    slot_ts: datetime
    setpoint_c: float
    predicted_temp_c: float
    predicted_kwh: float
    predicted_gco2: float
    actual_temp_c: float | None


class MpcScheduleResponse(BaseModel):
    room_id: str
    room_label: str
    solved_at: datetime
    model_version: int
    capacity_kw: float | None
    cop_cooling: float | None
    tariff_currency_per_kwh: float
    carbon_weight_lambda: float
    slots: list[MpcScheduleSlot]


@app.get("/buildings/{building_id}/rooms/{room_id}/mpc-schedule", response_model=MpcScheduleResponse)
def get_mpc_schedule(building_id: str, room_id: str) -> MpcScheduleResponse:
    engine = get_engine()
    try:
        room = fetch_room(engine, room_id)
    except LookupError:
        raise HTTPException(status_code=404, detail=f"Room not found: {room_id!r}")
    if room.building_id != building_id:
        raise HTTPException(status_code=404, detail=f"Room {room_id!r} does not belong to building {building_id!r}")
    result = fetch_latest_mpc_schedule(engine, room_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No MPC schedule has been solved yet for room {room_id!r}")
    hvac = room.config_json.get("hvac", {})
    return MpcScheduleResponse(
        room_id=room_id,
        room_label=room.room_label,
        solved_at=result.solved_at,
        model_version=result.model_version,
        capacity_kw=hvac.get("capacity_kw"),
        cop_cooling=hvac.get("cop_cooling"),
        tariff_currency_per_kwh=constants.TARIFF_CURRENCY_PER_KWH,
        carbon_weight_lambda=constants.CARBON_WEIGHT_LAMBDA,
        slots=[MpcScheduleSlot(slot_ts=s.slot_ts, setpoint_c=s.setpoint_c, predicted_temp_c=s.predicted_temp_c, predicted_kwh=s.predicted_kwh, predicted_gco2=s.predicted_gco2, actual_temp_c=s.actual_temp_c) for s in result.slots],
    )


def _anomaly_status(closed_at: datetime | None, diagnosed: bool) -> str:
    if closed_at is not None:
        return "resolved"
    return "diagnosed" if diagnosed else "open"


def _anomaly_severity(residual_c: float | None, threshold_c: float | None) -> str:
    if residual_c is None or not threshold_c:
        return "low"
    ratio = abs(residual_c) / threshold_c
    if ratio >= 2.0:
        return "high"
    if ratio >= 1.3:
        return "medium"
    return "low"


class AnomalyOverview(BaseModel):
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None
    residual_c: float | None
    threshold_c: float | None
    status: str
    severity: str
    diagnosed: bool
    cause: str | None
    cause_confidence: str | None
    supervisor_decision: str | None


@app.get("/buildings/{building_id}/anomalies", response_model=list[AnomalyOverview])
def get_anomalies(building_id: str) -> list[AnomalyOverview]:
    rows = fetch_anomalies_overview(get_engine(), building_id)
    return [
        AnomalyOverview(
            anomaly_id=r.anomaly_id,
            room_id=r.room_id,
            room_label=r.room_label,
            floor_level=r.floor_level,
            anomaly_type=r.anomaly_type,
            opened_at=r.opened_at,
            closed_at=r.closed_at,
            residual_c=r.residual_c,
            threshold_c=r.threshold_c,
            status=_anomaly_status(r.closed_at, r.diagnosed),
            severity=_anomaly_severity(r.residual_c, r.threshold_c),
            diagnosed=r.diagnosed,
            cause=r.cause,
            cause_confidence=r.cause_confidence,
            supervisor_decision=r.supervisor_decision,
        )
        for r in rows
    ]


class DiagnosisSummary(BaseModel):
    id: int
    cause: str
    cause_confidence: str
    evidence: list[str]
    energy_wasted_kwh: float
    energy_wasted_basis: str
    proposed_action: dict[str, Any]
    recurrence: dict[str, Any]
    message: str
    supervisor_decision: str
    created_at: datetime


class AnomalyDetail(BaseModel):
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None
    residual_c: float | None
    threshold_c: float | None
    residual_trace: list[dict[str, Any]]
    status: str
    severity: str
    diagnosed: bool
    diagnosis: DiagnosisSummary | None


@app.get("/buildings/{building_id}/anomalies/{anomaly_id}", response_model=AnomalyDetail)
def get_anomaly_detail(building_id: str, anomaly_id: int) -> AnomalyDetail:
    result = fetch_anomaly_detail(get_engine(), anomaly_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    if result.building_id != building_id:
        raise HTTPException(status_code=404, detail=f"Anomaly {anomaly_id} does not belong to building {building_id!r}")
    diagnosis = None
    if result.diagnosis is not None:
        d = result.diagnosis
        diagnosis = DiagnosisSummary(
            id=d.id, cause=d.cause, cause_confidence=d.cause_confidence, evidence=d.evidence,
            energy_wasted_kwh=d.energy_wasted_kwh, energy_wasted_basis=d.energy_wasted_basis,
            proposed_action=d.proposed_action, recurrence=d.recurrence, message=d.message,
            supervisor_decision=d.supervisor_decision, created_at=d.created_at,
        )
    return AnomalyDetail(
        anomaly_id=result.anomaly_id,
        room_id=result.room_id,
        room_label=result.room_label,
        floor_level=result.floor_level,
        anomaly_type=result.anomaly_type,
        opened_at=result.opened_at,
        closed_at=result.closed_at,
        residual_c=result.residual_c,
        threshold_c=result.threshold_c,
        residual_trace=result.residual_trace if isinstance(result.residual_trace, list) else [],
        status=_anomaly_status(result.closed_at, result.diagnosed),
        severity=_anomaly_severity(result.residual_c, result.threshold_c),
        diagnosed=result.diagnosed,
        diagnosis=diagnosis,
    )


class DiagnosisOverview(BaseModel):
    id: int
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    cause: str
    cause_confidence: str
    energy_wasted_kwh: float
    energy_wasted_basis: str
    proposed_action_type: str
    supervisor_decision: str
    message: str
    created_at: datetime


@app.get("/buildings/{building_id}/diagnoses", response_model=list[DiagnosisOverview])
def get_diagnoses(building_id: str) -> list[DiagnosisOverview]:
    rows = fetch_diagnoses_overview(get_engine(), building_id)
    return [
        DiagnosisOverview(
            id=r.id,
            anomaly_id=r.anomaly_id,
            room_id=r.room_id,
            room_label=r.room_label,
            floor_level=r.floor_level,
            cause=r.cause,
            cause_confidence=r.cause_confidence,
            energy_wasted_kwh=r.energy_wasted_kwh,
            energy_wasted_basis=r.energy_wasted_basis,
            proposed_action_type=str(r.proposed_action.get("type", "unknown")),
            supervisor_decision=r.supervisor_decision,
            message=r.message,
            created_at=r.created_at,
        )
        for r in rows
    ]


class AlertOverview(BaseModel):
    id: int
    diagnosis_id: int
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    channel: str
    recipient: str
    cause: str
    cause_confidence: str
    message: str
    sent_at: datetime


@app.get("/buildings/{building_id}/alerts", response_model=list[AlertOverview])
def get_alerts(building_id: str) -> list[AlertOverview]:
    rows = fetch_alerts_overview(get_engine(), building_id)
    return [
        AlertOverview(
            id=r.id,
            diagnosis_id=r.diagnosis_id,
            anomaly_id=r.anomaly_id,
            room_id=r.room_id,
            room_label=r.room_label,
            floor_level=r.floor_level,
            channel=r.channel,
            recipient=r.recipient,
            cause=r.cause,
            cause_confidence=r.cause_confidence,
            message=r.message,
            sent_at=r.sent_at,
        )
        for r in rows
    ]


class DailyEnergyPoint(BaseModel):
    date: str
    kwh: float
    gco2: float


class ComfortLeaderboardEntry(BaseModel):
    room_id: str
    room_label: str
    floor_level: int
    latest_temp_c: float
    deviation_c: float
    reading_at: datetime


class ReportsSummary(BaseModel):
    window_days: int
    total_predicted_kwh: float
    total_predicted_gco2: float
    total_predicted_cost_currency: float
    tariff_currency_per_kwh: float
    avg_comfort_deviation_c: float | None
    daily: list[DailyEnergyPoint]
    comfort_leaderboard: list[ComfortLeaderboardEntry]


@app.get("/buildings/{building_id}/reports/summary", response_model=ReportsSummary)
def get_reports_summary(building_id: str, days: int = 30) -> ReportsSummary:
    result = fetch_reports_summary(get_engine(), building_id, days)
    comfort_mid_c = (constants.T_MIN_OCCUPIED_C + constants.T_MAX_OCCUPIED_C) / 2.0
    leaderboard = sorted(
        (
            ComfortLeaderboardEntry(
                room_id=r.room_id,
                room_label=r.room_label,
                floor_level=r.floor_level,
                latest_temp_c=r.temp_measured_c,
                deviation_c=abs(r.temp_measured_c - comfort_mid_c),
                reading_at=r.ts,
            )
            for r in result.room_readings
        ),
        key=lambda e: e.deviation_c,
    )
    avg_deviation = sum(e.deviation_c for e in leaderboard) / len(leaderboard) if leaderboard else None
    return ReportsSummary(
        window_days=days,
        total_predicted_kwh=result.total_kwh,
        total_predicted_gco2=result.total_gco2,
        total_predicted_cost_currency=result.total_kwh * constants.TARIFF_CURRENCY_PER_KWH,
        tariff_currency_per_kwh=constants.TARIFF_CURRENCY_PER_KWH,
        avg_comfort_deviation_c=avg_deviation,
        daily=[DailyEnergyPoint(date=d.date, kwh=d.kwh, gco2=d.gco2) for d in result.daily],
        comfort_leaderboard=leaderboard[:6],
    )
