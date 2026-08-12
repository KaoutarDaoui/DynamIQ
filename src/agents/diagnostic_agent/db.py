from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Engine, create_engine, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import registry as orm_registry
from sqlmodel import Column, Field, Session, SQLModel, select

load_dotenv()


class DiagnosticBase(SQLModel, registry=orm_registry()):
    pass


class RoomsTable(DiagnosticBase, table=True):
    __tablename__ = "rooms"
    room_id: str = Field(primary_key=True)
    floor_id: str
    room_label: str
    room_type: str | None = None
    area_m2: float
    volume_m3: float
    primary_orientation: str | None = None
    r_wall: float
    c_zone: float
    sensor_id: str | None = None
    config_json: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime | None = None


class FloorsTable(DiagnosticBase, table=True):
    __tablename__ = "floors"
    floor_id: str = Field(primary_key=True)
    building_id: str
    level: int
    name: str | None = None
    floor_plan_url: str | None = None
    created_at: datetime | None = None


class BuildingsTable(DiagnosticBase, table=True):
    __tablename__ = "buildings"
    building_id: str = Field(primary_key=True)
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    total_floors: int
    country_code: str | None = None
    created_at: datetime | None = None
    org_id: str | None = None


class RoomAdjacenciesTable(DiagnosticBase, table=True):
    __tablename__ = "room_adjacencies"
    room_id: str = Field(primary_key=True)
    adjacent_room_id: str = Field(primary_key=True)
    direction: str
    wall_type: str | None = "internal"


class SensorReadingsTable(DiagnosticBase, table=True):
    __tablename__ = "sensor_readings"
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    ts: datetime
    temp_measured_c: float
    temp_ext_c: float
    q_solar_w: float
    q_occ_w: float
    q_hvac_w: float


class RcModelParamsTable(DiagnosticBase, table=True):
    __tablename__ = "rc_model_params"
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    version: int
    r_lumped: float
    c_lumped: float
    rmse_validation: float
    anomaly_threshold_c: float
    data_window_start: datetime
    data_window_end: datetime
    is_active: bool = True
    created_at: datetime | None = None


class AnomaliesTable(DiagnosticBase, table=True):
    __tablename__ = "anomalies"
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None = None
    residual_c: float | None = None
    residual_trace: Any = Field(default=None, sa_column=Column(JSONB))
    threshold_c: float | None = None
    model_version: int | None = None
    diagnosed: bool = False


class MpcSchedulesTable(DiagnosticBase, table=True):
    __tablename__ = "mpc_schedules"
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    solved_at: datetime
    slot_ts: datetime
    setpoint_c: float
    predicted_temp_c: float
    predicted_kwh: float | None = None
    predicted_gco2: float | None = None
    model_version: int


class DiagnosesTable(DiagnosticBase, table=True):
    __tablename__ = "diagnoses"
    id: int | None = Field(default=None, primary_key=True)
    anomaly_id: int
    room_id: str
    cause: str
    cause_confidence: str
    evidence: Any = Field(sa_column=Column(JSONB))
    energy_wasted_kwh: float
    energy_wasted_basis: str
    proposed_action: Any = Field(sa_column=Column(JSONB))
    recurrence: Any = Field(sa_column=Column(JSONB))
    message: str
    supervisor_decision: str
    created_at: datetime | None = None


class AlertsTable(DiagnosticBase, table=True):
    __tablename__ = "alerts"
    id: int | None = Field(default=None, primary_key=True)
    diagnosis_id: int
    room_id: str
    channel: str
    recipient: str
    payload: Any = Field(sa_column=Column(JSONB))
    sent_at: datetime | None = None


class AuditLogTable(DiagnosticBase, table=True):
    __tablename__ = "audit_log"
    id: int | None = Field(default=None, primary_key=True)
    anomaly_id: int
    room_id: str
    invoked_at: datetime
    tool_calls: Any = Field(sa_column=Column(JSONB))
    model_output: Any = Field(sa_column=Column(JSONB))
    supervisor_decision: Any = Field(sa_column=Column(JSONB))
    diagnosis_id: int | None = None
    created_at: datetime | None = None


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set (see .env.example)")
    return create_engine(database_url)


@dataclass(frozen=True)
class AnomalyRow:
    id: int
    room_id: str
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None
    residual_c: float | None
    residual_trace: Any
    threshold_c: float | None
    model_version: int | None
    diagnosed: bool


def fetch_anomaly(engine: Engine, anomaly_id: int) -> AnomalyRow | None:
    with Session(engine) as session:
        row = session.get(AnomaliesTable, anomaly_id)
    if row is None:
        return None
    return AnomalyRow(id=row.id, room_id=row.room_id, anomaly_type=row.anomaly_type, opened_at=row.opened_at, closed_at=row.closed_at, residual_c=row.residual_c, residual_trace=row.residual_trace, threshold_c=row.threshold_c, model_version=row.model_version, diagnosed=row.diagnosed)


def mark_anomaly_diagnosed(engine: Engine, anomaly_id: int) -> None:
    with Session(engine) as session:
        row = session.get(AnomaliesTable, anomaly_id)
        row.diagnosed = True
        session.add(row)
        session.commit()


def fetch_sensor_history(engine: Engine, room_id: str, hours: int) -> list[dict[str, Any]]:
    start = datetime.now(timezone.utc) - timedelta(hours=hours)
    with Session(engine) as session:
        rows = session.exec(select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= start).order_by(SensorReadingsTable.ts.asc())).all()
    return [{"ts": r.ts, "temp_measured_c": r.temp_measured_c, "temp_ext_c": r.temp_ext_c, "q_occ_w": r.q_occ_w, "q_hvac_w": r.q_hvac_w} for r in rows]


def fetch_occupancy_pattern(engine: Engine, room_id: str, days: int) -> list[dict[str, Any]]:
    start = datetime.now(timezone.utc) - timedelta(days=days)
    with Session(engine) as session:
        rows = session.exec(select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= start).order_by(SensorReadingsTable.ts.asc())).all()
    return [{"ts": r.ts, "q_occ_w": r.q_occ_w} for r in rows]


def fetch_mpc_trajectory(engine: Engine, room_id: str) -> list[dict[str, Any]]:
    with Session(engine) as session:
        latest_solved_at = session.exec(select(func.max(MpcSchedulesTable.solved_at)).where(MpcSchedulesTable.room_id == room_id)).first()
        if latest_solved_at is None:
            return []
        rows = session.exec(select(MpcSchedulesTable).where(MpcSchedulesTable.room_id == room_id, MpcSchedulesTable.solved_at == latest_solved_at).order_by(MpcSchedulesTable.slot_ts.asc())).all()
    return [{"slot_ts": r.slot_ts, "setpoint_c": r.setpoint_c, "predicted_temp_c": r.predicted_temp_c, "predicted_kwh": r.predicted_kwh, "predicted_gco2": r.predicted_gco2, "model_version": r.model_version} for r in rows]


def fetch_hvac_power_history(engine: Engine, room_id: str, hours: int) -> list[dict[str, Any]]:
    start = datetime.now(timezone.utc) - timedelta(hours=hours)
    with Session(engine) as session:
        rows = session.exec(select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= start).order_by(SensorReadingsTable.ts.asc())).all()
    return [{"ts": r.ts, "q_hvac_w": r.q_hvac_w} for r in rows]


def fetch_sensor_readings_between(engine: Engine, room_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
    with Session(engine) as session:
        rows = session.exec(
            select(SensorReadingsTable)
            .where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= start, SensorReadingsTable.ts <= end)
            .order_by(SensorReadingsTable.ts.asc())
        ).all()
    return [
        {"ts": r.ts, "temp_measured_c": r.temp_measured_c, "temp_ext_c": r.temp_ext_c, "q_occ_w": r.q_occ_w, "q_hvac_w": r.q_hvac_w}
        for r in rows
    ]


def fetch_mpc_slots_between(engine: Engine, room_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
    with Session(engine) as session:
        rows = session.exec(
            select(MpcSchedulesTable)
            .where(MpcSchedulesTable.room_id == room_id, MpcSchedulesTable.slot_ts >= start, MpcSchedulesTable.slot_ts <= end)
            .order_by(MpcSchedulesTable.slot_ts.asc())
        ).all()
    return [
        {"slot_ts": r.slot_ts, "setpoint_c": r.setpoint_c, "predicted_temp_c": r.predicted_temp_c, "predicted_kwh": r.predicted_kwh, "predicted_gco2": r.predicted_gco2, "model_version": r.model_version}
        for r in rows
    ]


def fetch_similar_anomalies(engine: Engine, room_id: str, days: int, exclude_anomaly_id: int | None = None) -> list[dict[str, Any]]:
    start = datetime.now(timezone.utc) - timedelta(days=days)
    with Session(engine) as session:
        query = (
            select(AnomaliesTable, DiagnosesTable.cause, DiagnosesTable.cause_confidence)
            .join(DiagnosesTable, DiagnosesTable.anomaly_id == AnomaliesTable.id, isouter=True)
            .where(AnomaliesTable.room_id == room_id, AnomaliesTable.anomaly_type == "thermal_anomaly", AnomaliesTable.opened_at >= start)
        )
        if exclude_anomaly_id is not None:
            query = query.where(AnomaliesTable.id != exclude_anomaly_id)
        rows = session.exec(query.order_by(AnomaliesTable.opened_at.desc())).all()
    return [{"id": a.id, "opened_at": a.opened_at, "closed_at": a.closed_at, "residual_c": a.residual_c, "threshold_c": a.threshold_c, "cause": cause, "cause_confidence": confidence} for a, cause, confidence in rows]


def fetch_building_context(engine: Engine, room_id: str) -> dict[str, Any] | None:
    with Session(engine) as session:
        row = session.exec(
            select(RoomsTable, FloorsTable.level, BuildingsTable.total_floors, BuildingsTable.name)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .join(BuildingsTable, BuildingsTable.building_id == FloorsTable.building_id)
            .where(RoomsTable.room_id == room_id)
        ).first()
        if row is None:
            return None
        room, floor_level, total_floors, building_name = row
        model = session.exec(select(RcModelParamsTable).where(RcModelParamsTable.room_id == room_id, RcModelParamsTable.is_active == True)).first()
    return {
        "room_id": room.room_id,
        "room_label": room.room_label,
        "room_type": room.room_type,
        "area_m2": room.area_m2,
        "volume_m3": room.volume_m3,
        "primary_orientation": room.primary_orientation,
        "r_wall": room.r_wall,
        "c_zone": room.c_zone,
        "config_json": room.config_json or {},
        "floor_level": floor_level,
        "total_floors": total_floors,
        "building_name": building_name,
        "active_model": {"version": model.version, "r_lumped": model.r_lumped, "c_lumped": model.c_lumped, "rmse_validation": model.rmse_validation, "anomaly_threshold_c": model.anomaly_threshold_c} if model is not None else None,
    }


def fetch_neighboring_zones(engine: Engine, room_id: str) -> list[dict[str, Any]]:
    with Session(engine) as session:
        adjacencies = session.exec(select(RoomAdjacenciesTable).where(RoomAdjacenciesTable.room_id == room_id)).all()
        neighbors = []
        for adj in adjacencies:
            latest = session.exec(select(SensorReadingsTable).where(SensorReadingsTable.room_id == adj.adjacent_room_id).order_by(SensorReadingsTable.ts.desc()).limit(1)).first()
            neighbors.append({
                "room_id": adj.adjacent_room_id,
                "direction": adj.direction,
                "wall_type": adj.wall_type,
                "latest_temp_c": latest.temp_measured_c if latest else None,
                "latest_ts": latest.ts if latest else None,
            })
    return neighbors


def insert_diagnosis(engine: Engine, record: dict[str, Any]) -> int:
    with Session(engine) as session:
        row = DiagnosesTable(
            anomaly_id=record["anomaly_id"],
            room_id=record["room_id"],
            cause=record["cause"],
            cause_confidence=record["cause_confidence"],
            evidence=record["evidence"],
            energy_wasted_kwh=record["energy_wasted_kwh"],
            energy_wasted_basis=record["energy_wasted_basis"],
            proposed_action=record["proposed_action"],
            recurrence=record["recurrence"],
            message=record["message"],
            supervisor_decision=record["supervisor_decision"],
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id


def insert_alert(engine: Engine, diagnosis_id: int, room_id: str, channel: str, recipient: str, payload: dict[str, Any]) -> int:
    with Session(engine) as session:
        row = AlertsTable(diagnosis_id=diagnosis_id, room_id=room_id, channel=channel, recipient=recipient, payload=payload, sent_at=datetime.now(timezone.utc))
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id


def insert_audit_log(engine: Engine, record: dict[str, Any]) -> int:
    with Session(engine) as session:
        row = AuditLogTable(
            anomaly_id=record["anomaly_id"],
            room_id=record["room_id"],
            invoked_at=record["invoked_at"],
            tool_calls=record["tool_calls"],
            model_output=record["model_output"],
            supervisor_decision=record["supervisor_decision"],
            diagnosis_id=record.get("diagnosis_id"),
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id


def fetch_recent_diagnoses_for_cooldown(engine: Engine, room_id: str, cause: str, days: int) -> list[dict[str, Any]]:
    start = datetime.now(timezone.utc) - timedelta(days=days)
    with Session(engine) as session:
        rows = session.exec(select(DiagnosesTable).where(DiagnosesTable.room_id == room_id, DiagnosesTable.cause == cause, DiagnosesTable.created_at >= start).order_by(DiagnosesTable.created_at.desc())).all()
    return [{"id": r.id, "created_at": r.created_at, "supervisor_decision": r.supervisor_decision} for r in rows]
