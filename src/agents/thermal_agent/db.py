from __future__ import annotations
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any
import numpy as np
from dotenv import load_dotenv
from sqlalchemy import Engine, create_engine, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import registry as orm_registry
from sqlmodel import Column, Field, Session, SQLModel, select
load_dotenv()

class ThermalBase(SQLModel, registry=orm_registry()):
    pass

class RoomsTable(ThermalBase, table=True):
    __tablename__ = 'rooms'
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

class FloorsTable(ThermalBase, table=True):
    __tablename__ = 'floors'
    floor_id: str = Field(primary_key=True)
    building_id: str
    level: int
    name: str | None = None
    floor_plan_url: str | None = None
    created_at: datetime | None = None

class BuildingsTable(ThermalBase, table=True):
    __tablename__ = 'buildings'
    building_id: str = Field(primary_key=True)
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    total_floors: int
    country_code: str | None = None
    created_at: datetime | None = None
    org_id: str | None = None

class OrganisationsTable(ThermalBase, table=True):
    __tablename__ = 'organisations'
    org_id: str = Field(primary_key=True)
    email: str | None = None

class RoomAdjacenciesTable(ThermalBase, table=True):
    __tablename__ = 'room_adjacencies'
    room_id: str = Field(primary_key=True)
    adjacent_room_id: str = Field(primary_key=True)
    direction: str
    wall_type: str | None = 'internal'

class SensorReadingsTable(ThermalBase, table=True):
    __tablename__ = 'sensor_readings'
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    ts: datetime
    temp_measured_c: float
    temp_ext_c: float
    q_solar_w: float
    q_occ_w: float
    q_hvac_w: float

class RcModelParamsTable(ThermalBase, table=True):
    __tablename__ = 'rc_model_params'
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

class AnomaliesTable(ThermalBase, table=True):
    __tablename__ = 'anomalies'
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

class MpcSchedulesTable(ThermalBase, table=True):
    __tablename__ = 'mpc_schedules'
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    solved_at: datetime
    slot_ts: datetime
    setpoint_c: float
    predicted_temp_c: float
    predicted_kwh: float | None = None
    predicted_gco2: float | None = None
    model_version: int

class DiagnosesTable(ThermalBase, table=True):
    __tablename__ = 'diagnoses'
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

class AlertsTable(ThermalBase, table=True):
    __tablename__ = 'alerts'
    id: int | None = Field(default=None, primary_key=True)
    diagnosis_id: int
    room_id: str
    channel: str
    recipient: str
    payload: Any = Field(sa_column=Column(JSONB))
    sent_at: datetime | None = None

@dataclass(frozen=True)
class BuildingRecord:
    building_id: str
    name: str
    latitude: float
    longitude: float
    total_floors: int
    country_code: str

@dataclass(frozen=True)
class FloorRecord:
    floor_id: str
    building_id: str
    level: int
    name: str | None

@dataclass(frozen=True)
class RoomRecord:
    room_id: str
    floor_id: str
    building_id: str
    room_label: str
    room_type: str | None
    area_m2: float
    volume_m3: float
    primary_orientation: str | None
    r_wall: float
    c_zone: float
    sensor_id: str | None
    config_json: dict[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class AdjacencyRecord:
    room_id: str
    adjacent_room_id: str | None
    direction: str
    wall_type: str

@lru_cache(maxsize=1)
def get_engine() -> Engine:
    database_url = (os.getenv('DATABASE_URL') or '').strip()
    if not database_url:
        raise RuntimeError('DATABASE_URL must be set (see .env.example)')
    return create_engine(database_url, pool_size=1, max_overflow=1, pool_pre_ping=True)

def fetch_room(engine: Engine, room_id: str) -> RoomRecord:
    with Session(engine) as session:
        row = session.exec(select(RoomsTable, FloorsTable.building_id).join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id).where(RoomsTable.room_id == room_id)).first()
    if row is None:
        raise LookupError(f'Room not found: {room_id}')
    room, building_id = row
    return RoomRecord(room_id=room.room_id, floor_id=room.floor_id, building_id=building_id, room_label=room.room_label, room_type=room.room_type, area_m2=room.area_m2, volume_m3=room.volume_m3, primary_orientation=room.primary_orientation, r_wall=room.r_wall, c_zone=room.c_zone, sensor_id=room.sensor_id, config_json=room.config_json or {})

def fetch_floor(engine: Engine, floor_id: str) -> FloorRecord:
    with Session(engine) as session:
        row = session.get(FloorsTable, floor_id)
    if row is None:
        raise LookupError(f'Floor not found: {floor_id}')
    return FloorRecord(floor_id=row.floor_id, building_id=row.building_id, level=row.level, name=row.name)

def fetch_building(engine: Engine, building_id: str) -> BuildingRecord:
    with Session(engine) as session:
        row = session.get(BuildingsTable, building_id)
    if row is None:
        raise LookupError(f'Building not found: {building_id}')
    return BuildingRecord(building_id=row.building_id, name=row.name, latitude=row.latitude, longitude=row.longitude, total_floors=row.total_floors, country_code=row.country_code)

def fetch_all_building_ids(engine: Engine) -> list[str]:
    with Session(engine) as session:
        rows = session.exec(select(BuildingsTable.building_id)).all()
    return list(rows)

def fetch_org_alert_email(engine: Engine, building_id: str) -> str | None:
    with Session(engine) as session:
        result = session.exec(
            select(OrganisationsTable.email)
            .join(BuildingsTable, BuildingsTable.org_id == OrganisationsTable.org_id)
            .where(BuildingsTable.building_id == building_id)
        ).first()
    return result

def update_org_alert_email(engine: Engine, building_id: str, email: str) -> bool:
    with Session(engine) as session:
        building = session.get(BuildingsTable, building_id)
        if building is None or building.org_id is None:
            return False
        org = session.get(OrganisationsTable, building.org_id)
        if org is None:
            return False
        org.email = email
        session.add(org)
        session.commit()
        return True

def fetch_room_adjacencies(engine: Engine, room_id: str) -> list[AdjacencyRecord]:
    with Session(engine) as session:
        rows = session.exec(select(RoomAdjacenciesTable).where(RoomAdjacenciesTable.room_id == room_id)).all()
    return [AdjacencyRecord(room_id=r.room_id, adjacent_room_id=r.adjacent_room_id, direction=r.direction, wall_type=r.wall_type) for r in rows]

@dataclass(frozen=True)
class SensorReadingsWindow:
    ts: list[datetime]
    temp_measured_c: np.ndarray
    temp_ext_c: np.ndarray
    q_solar_w: np.ndarray
    q_occ_w: np.ndarray
    q_hvac_w: np.ndarray

def _sensor_window(rows: list[SensorReadingsTable]) -> SensorReadingsWindow:
    return SensorReadingsWindow(ts=[r.ts for r in rows], temp_measured_c=np.array([r.temp_measured_c for r in rows], dtype=float), temp_ext_c=np.array([r.temp_ext_c for r in rows], dtype=float), q_solar_w=np.array([r.q_solar_w for r in rows], dtype=float), q_occ_w=np.array([r.q_occ_w for r in rows], dtype=float), q_hvac_w=np.array([r.q_hvac_w for r in rows], dtype=float))

def fetch_sensor_readings(engine: Engine, room_id: str, start: datetime, end: datetime) -> SensorReadingsWindow:
    with Session(engine) as session:
        rows = session.exec(select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= start, SensorReadingsTable.ts <= end).order_by(SensorReadingsTable.ts.asc())).all()
    return _sensor_window(rows)

def count_sensor_readings(engine: Engine, room_id: str, start: datetime, end: datetime) -> int:
    with Session(engine) as session:
        return session.exec(select(func.count()).select_from(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= start, SensorReadingsTable.ts <= end)).one()

def fetch_latest_sensor_readings(engine: Engine, room_id: str, n: int) -> SensorReadingsWindow:
    with Session(engine) as session:
        rows = session.exec(select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id).order_by(SensorReadingsTable.ts.desc()).limit(n)).all()
    return _sensor_window(list(reversed(rows)))

@dataclass(frozen=True)
class RcModelParamsRecord:
    id: int
    room_id: str
    version: int
    r_lumped: float
    c_lumped: float
    rmse_validation: float
    anomaly_threshold_c: float
    data_window_start: datetime
    data_window_end: datetime
    is_active: bool
    created_at: datetime

def fetch_active_rc_model_params(engine: Engine, room_id: str) -> RcModelParamsRecord | None:
    with Session(engine) as session:
        row = session.exec(select(RcModelParamsTable).where(RcModelParamsTable.room_id == room_id, RcModelParamsTable.is_active == True)).first()
    if row is None:
        return None
    return RcModelParamsRecord(id=row.id, room_id=row.room_id, version=row.version, r_lumped=row.r_lumped, c_lumped=row.c_lumped, rmse_validation=row.rmse_validation, anomaly_threshold_c=row.anomaly_threshold_c, data_window_start=row.data_window_start, data_window_end=row.data_window_end, is_active=row.is_active, created_at=row.created_at)

def insert_rc_model_params(engine: Engine, room_id: str, version: int, r_lumped: float, c_lumped: float, rmse_validation: float, anomaly_threshold_c: float, data_window_start: datetime, data_window_end: datetime) -> None:
    with Session(engine) as session:
        active_rows = session.exec(select(RcModelParamsTable).where(RcModelParamsTable.room_id == room_id, RcModelParamsTable.is_active == True)).all()
        for row in active_rows:
            row.is_active = False
            session.add(row)
        session.add(RcModelParamsTable(room_id=room_id, version=version, r_lumped=r_lumped, c_lumped=c_lumped, rmse_validation=rmse_validation, anomaly_threshold_c=anomaly_threshold_c, data_window_start=data_window_start, data_window_end=data_window_end, is_active=True, created_at=datetime.now(timezone.utc)))
        session.commit()

@dataclass(frozen=True)
class AnomalyRecord:
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

def fetch_open_anomaly(engine: Engine, room_id: str, anomaly_type: str) -> AnomalyRecord | None:
    with Session(engine) as session:
        row = session.exec(select(AnomaliesTable).where(AnomaliesTable.room_id == room_id, AnomaliesTable.anomaly_type == anomaly_type, AnomaliesTable.closed_at == None).order_by(AnomaliesTable.opened_at.desc())).first()
    if row is None:
        return None
    return AnomalyRecord(id=row.id, room_id=row.room_id, anomaly_type=row.anomaly_type, opened_at=row.opened_at, closed_at=row.closed_at, residual_c=row.residual_c, residual_trace=row.residual_trace, threshold_c=row.threshold_c, model_version=row.model_version, diagnosed=row.diagnosed)

def insert_anomaly(engine: Engine, room_id: str, anomaly_type: str, opened_at: datetime, closed_at: datetime | None, residual_c: float | None, residual_trace: Any, threshold_c: float | None, model_version: int | None) -> int:
    with Session(engine) as session:
        row = AnomaliesTable(room_id=room_id, anomaly_type=anomaly_type, opened_at=opened_at, closed_at=closed_at, residual_c=residual_c, residual_trace=residual_trace, threshold_c=threshold_c, model_version=model_version, diagnosed=False)
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id

def close_anomaly(engine: Engine, anomaly_id: int, closed_at: datetime) -> None:
    with Session(engine) as session:
        row = session.get(AnomaliesTable, anomaly_id)
        row.closed_at = closed_at
        session.add(row)
        session.commit()

def insert_mpc_schedule_rows(engine: Engine, room_id: str, solved_at: datetime, model_version: int, slot_ts: list[datetime], setpoint_c: np.ndarray, predicted_temp_c: np.ndarray, predicted_kwh: np.ndarray, predicted_gco2: np.ndarray) -> None:
    with Session(engine) as session:
        session.add_all([MpcSchedulesTable(room_id=room_id, solved_at=solved_at, slot_ts=slot_ts[k], setpoint_c=float(setpoint_c[k]), predicted_temp_c=float(predicted_temp_c[k]), predicted_kwh=float(predicted_kwh[k]), predicted_gco2=float(predicted_gco2[k]), model_version=model_version) for k in range(len(slot_ts))])
        session.commit()

def fetch_instrumented_room_ids(engine: Engine, building_id: str) -> list[str]:
    with Session(engine) as session:
        rows = session.exec(select(RoomsTable.room_id).join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id).where(FloorsTable.building_id == building_id, RoomsTable.sensor_id.is_not(None))).all()
    return list(rows)

@dataclass(frozen=True)
class ThermalOverviewRecord:
    room_id: str
    room_label: str
    floor_id: str
    floor_level: int
    area_m2: float
    sensor_id: str | None
    version: int | None
    r_lumped: float | None
    c_lumped: float | None
    rmse_validation: float | None
    anomaly_threshold_c: float | None
    data_window_start: datetime | None
    data_window_end: datetime | None
    calibrated_at: datetime | None

def fetch_thermal_overview(engine: Engine, building_id: str) -> list[ThermalOverviewRecord]:
    with Session(engine) as session:
        rows = session.exec(
            select(RoomsTable, FloorsTable.level, RcModelParamsTable)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .join(RcModelParamsTable, (RcModelParamsTable.room_id == RoomsTable.room_id) & (RcModelParamsTable.is_active == True), isouter=True)
            .where(FloorsTable.building_id == building_id)
            .order_by(FloorsTable.level.asc(), RoomsTable.room_label.asc())
        ).all()
    return [
        ThermalOverviewRecord(
            room_id=room.room_id, room_label=room.room_label, floor_id=room.floor_id, floor_level=level, area_m2=room.area_m2, sensor_id=room.sensor_id,
            version=params.version if params else None, r_lumped=params.r_lumped if params else None, c_lumped=params.c_lumped if params else None,
            rmse_validation=params.rmse_validation if params else None, anomaly_threshold_c=params.anomaly_threshold_c if params else None,
            data_window_start=params.data_window_start if params else None, data_window_end=params.data_window_end if params else None,
            calibrated_at=params.created_at if params else None,
        )
        for room, level, params in rows
    ]

@dataclass(frozen=True)
class MpcRoomSummary:
    room_id: str
    room_label: str
    floor_level: int
    latest_solved_at: datetime

def fetch_mpc_rooms(engine: Engine, building_id: str) -> list[MpcRoomSummary]:
    with Session(engine) as session:
        rows = session.exec(
            select(RoomsTable.room_id, RoomsTable.room_label, FloorsTable.level, func.max(MpcSchedulesTable.solved_at))
            .select_from(MpcSchedulesTable)
            .join(RoomsTable, RoomsTable.room_id == MpcSchedulesTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id)
            .group_by(RoomsTable.room_id, RoomsTable.room_label, FloorsTable.level)
            .order_by(func.max(MpcSchedulesTable.solved_at).desc())
        ).all()
    return [MpcRoomSummary(room_id=r[0], room_label=r[1], floor_level=r[2], latest_solved_at=r[3]) for r in rows]

@dataclass(frozen=True)
class MpcScheduleSlot:
    slot_ts: datetime
    setpoint_c: float
    predicted_temp_c: float
    predicted_kwh: float
    predicted_gco2: float
    actual_temp_c: float | None

@dataclass(frozen=True)
class MpcHistoryPoint:
    ts: datetime
    actual_temp_c: float | None
    predicted_temp_c: float | None

@dataclass(frozen=True)
class MpcScheduleResult:
    solved_at: datetime
    model_version: int
    slots: list[MpcScheduleSlot]
    history: list[MpcHistoryPoint]

MPC_HISTORY_WINDOW = timedelta(hours=3)


def fetch_latest_mpc_schedule(engine: Engine, room_id: str) -> MpcScheduleResult | None:
    # slot_ts is anchored to the wall-clock instant the fast loop happened to
    # run (now, now+900s, now+1800s, ...) while sensor_readings.ts is
    # anchored to whenever the sensor feed happened to write -- the two are
    # never exactly equal, so this matches each slot to the nearest reading
    # within half a slot width instead of requiring exact equality.
    from . import constants

    with Session(engine) as session:
        latest_solved_at = session.exec(select(func.max(MpcSchedulesTable.solved_at)).where(MpcSchedulesTable.room_id == room_id)).first()
        if latest_solved_at is None:
            return None
        schedule_rows = session.exec(
            select(MpcSchedulesTable)
            .where(MpcSchedulesTable.room_id == room_id, MpcSchedulesTable.solved_at == latest_solved_at)
            .order_by(MpcSchedulesTable.slot_ts.asc())
        ).all()
        if not schedule_rows:
            return None
        tolerance = timedelta(seconds=constants.DT_SECONDS / 2.0)
        window_start = schedule_rows[0].slot_ts - tolerance
        window_end = schedule_rows[-1].slot_ts + tolerance
        readings = session.exec(
            select(SensorReadingsTable.ts, SensorReadingsTable.temp_measured_c)
            .where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= window_start, SensorReadingsTable.ts <= window_end)
            .order_by(SensorReadingsTable.ts.asc())
        ).all()

        # A rolling window of real readings before the schedule's own start.
        # "Actual" on the schedule's own slots only ever covers the sliver
        # of time since this schedule was solved, which resets every
        # re-solve (every ~15min) -- this gives the chart real history to
        # show instead of that sliver alone.
        history_start = schedule_rows[0].slot_ts - MPC_HISTORY_WINDOW
        history_rows = session.exec(
            select(SensorReadingsTable.ts, SensorReadingsTable.temp_measured_c)
            .where(SensorReadingsTable.room_id == room_id, SensorReadingsTable.ts >= history_start, SensorReadingsTable.ts < window_start)
            .order_by(SensorReadingsTable.ts.asc())
        ).all()

        # Reconstruct what was actually *planned* during that same window.
        # Every past solve predicted the same stretch of time, but each was
        # superseded by the next re-solve ~15min later -- so "the plan" for
        # any given moment is whatever the most recent solve *as of that
        # moment* predicted for it, not every solve's full 24h horizon.
        past_solve_rows = session.exec(
            select(MpcSchedulesTable.solved_at, MpcSchedulesTable.slot_ts, MpcSchedulesTable.predicted_temp_c)
            .where(
                MpcSchedulesTable.room_id == room_id,
                MpcSchedulesTable.slot_ts >= history_start,
                MpcSchedulesTable.slot_ts < window_start,
                MpcSchedulesTable.solved_at < latest_solved_at,
            )
            .order_by(MpcSchedulesTable.solved_at.asc(), MpcSchedulesTable.slot_ts.asc())
        ).all()

    solves: dict[datetime, list[tuple[datetime, float]]] = {}
    for solved_at, slot_ts, predicted in past_solve_rows:
        solves.setdefault(solved_at, []).append((slot_ts, predicted))
    solve_times = sorted(solves)

    planned_history: list[tuple[datetime, float]] = []
    for i, solved_at in enumerate(solve_times):
        valid_until = solve_times[i + 1] if i + 1 < len(solve_times) else window_start
        for slot_ts, predicted in solves[solved_at]:
            if solved_at <= slot_ts < valid_until:
                planned_history.append((slot_ts, predicted))

    merged: dict[datetime, dict[str, float]] = {}
    for ts, temp in history_rows:
        merged.setdefault(ts, {})["actual_temp_c"] = temp
    for ts, predicted in planned_history:
        merged.setdefault(ts, {})["predicted_temp_c"] = predicted
    history = [
        MpcHistoryPoint(ts=ts, actual_temp_c=vals.get("actual_temp_c"), predicted_temp_c=vals.get("predicted_temp_c"))
        for ts, vals in sorted(merged.items())
    ]

    slots = []
    for m in schedule_rows:
        actual = None
        best_diff = None
        for ts, temp in readings:
            diff = abs((ts - m.slot_ts).total_seconds())
            if diff <= tolerance.total_seconds() and (best_diff is None or diff < best_diff):
                actual = temp
                best_diff = diff
        slots.append(MpcScheduleSlot(slot_ts=m.slot_ts, setpoint_c=m.setpoint_c, predicted_temp_c=m.predicted_temp_c, predicted_kwh=m.predicted_kwh, predicted_gco2=m.predicted_gco2, actual_temp_c=actual))
    return MpcScheduleResult(solved_at=latest_solved_at, model_version=schedule_rows[0].model_version, slots=slots, history=history)

@dataclass(frozen=True)
class AnomalyOverviewRecord:
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None
    residual_c: float | None
    threshold_c: float | None
    diagnosed: bool
    cause: str | None
    cause_confidence: str | None
    supervisor_decision: str | None
    proposed_action: str | None

def _action_type(proposed: Any) -> str | None:
    return proposed.get("type") if isinstance(proposed, dict) else None


def fetch_anomalies_overview(engine: Engine, building_id: str) -> list[AnomalyOverviewRecord]:
    with Session(engine) as session:
        rows = session.exec(
            select(AnomaliesTable, RoomsTable.room_label, FloorsTable.level)
            .join(RoomsTable, RoomsTable.room_id == AnomaliesTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id)
            .order_by(AnomaliesTable.opened_at.desc())
        ).all()
        anomaly_ids = [a.id for a, _, _ in rows]
        latest_diagnosis: dict[int, DiagnosesTable] = {}
        if anomaly_ids:
            diag_rows = session.exec(
                select(DiagnosesTable)
                .where(DiagnosesTable.anomaly_id.in_(anomaly_ids))
                .order_by(DiagnosesTable.created_at.desc())
            ).all()
            for d in diag_rows:
                latest_diagnosis.setdefault(d.anomaly_id, d)
    return [
        AnomalyOverviewRecord(
            anomaly_id=a.id, room_id=a.room_id, room_label=room_label, floor_level=level,
            anomaly_type=a.anomaly_type, opened_at=a.opened_at, closed_at=a.closed_at,
            residual_c=a.residual_c, threshold_c=a.threshold_c, diagnosed=a.diagnosed,
            cause=latest_diagnosis[a.id].cause if a.id in latest_diagnosis else None,
            cause_confidence=latest_diagnosis[a.id].cause_confidence if a.id in latest_diagnosis else None,
            supervisor_decision=latest_diagnosis[a.id].supervisor_decision if a.id in latest_diagnosis else None,
            proposed_action=_action_type(latest_diagnosis[a.id].proposed_action) if a.id in latest_diagnosis else None,
        )
        for a, room_label, level in rows
    ]

@dataclass(frozen=True)
class DiagnosisSummary:
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

@dataclass(frozen=True)
class AnomalyDetailRecord:
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    building_id: str
    anomaly_type: str
    opened_at: datetime
    closed_at: datetime | None
    residual_c: float | None
    threshold_c: float | None
    residual_trace: Any
    diagnosed: bool
    diagnosis: DiagnosisSummary | None

def fetch_anomaly_detail(engine: Engine, anomaly_id: int) -> AnomalyDetailRecord | None:
    with Session(engine) as session:
        row = session.exec(
            select(AnomaliesTable, RoomsTable.room_label, FloorsTable.level, FloorsTable.building_id)
            .join(RoomsTable, RoomsTable.room_id == AnomaliesTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(AnomaliesTable.id == anomaly_id)
        ).first()
        if row is None:
            return None
        anomaly, room_label, level, building_id = row
        diag = session.exec(
            select(DiagnosesTable).where(DiagnosesTable.anomaly_id == anomaly_id).order_by(DiagnosesTable.created_at.desc())
        ).first()
    diagnosis = None
    if diag is not None:
        diagnosis = DiagnosisSummary(id=diag.id, cause=diag.cause, cause_confidence=diag.cause_confidence, evidence=diag.evidence, energy_wasted_kwh=diag.energy_wasted_kwh, energy_wasted_basis=diag.energy_wasted_basis, proposed_action=diag.proposed_action, recurrence=diag.recurrence, message=diag.message, supervisor_decision=diag.supervisor_decision, created_at=diag.created_at)
    return AnomalyDetailRecord(
        anomaly_id=anomaly.id, room_id=anomaly.room_id, room_label=room_label, floor_level=level, building_id=building_id,
        anomaly_type=anomaly.anomaly_type, opened_at=anomaly.opened_at, closed_at=anomaly.closed_at,
        residual_c=anomaly.residual_c, threshold_c=anomaly.threshold_c, residual_trace=anomaly.residual_trace,
        diagnosed=anomaly.diagnosed, diagnosis=diagnosis,
    )

@dataclass(frozen=True)
class DiagnosisOverviewRecord:
    id: int
    anomaly_id: int
    room_id: str
    room_label: str
    floor_level: int
    cause: str
    cause_confidence: str
    energy_wasted_kwh: float
    energy_wasted_basis: str
    proposed_action: dict[str, Any]
    supervisor_decision: str
    message: str
    created_at: datetime

def fetch_diagnoses_overview(engine: Engine, building_id: str) -> list[DiagnosisOverviewRecord]:
    with Session(engine) as session:
        rows = session.exec(
            select(DiagnosesTable, RoomsTable.room_label, FloorsTable.level)
            .join(RoomsTable, RoomsTable.room_id == DiagnosesTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id)
            .order_by(DiagnosesTable.created_at.desc())
        ).all()
    return [
        DiagnosisOverviewRecord(
            id=d.id, anomaly_id=d.anomaly_id, room_id=d.room_id, room_label=room_label, floor_level=level,
            cause=d.cause, cause_confidence=d.cause_confidence, energy_wasted_kwh=d.energy_wasted_kwh,
            energy_wasted_basis=d.energy_wasted_basis, proposed_action=d.proposed_action,
            supervisor_decision=d.supervisor_decision, message=d.message, created_at=d.created_at,
        )
        for d, room_label, level in rows
    ]

@dataclass(frozen=True)
class AlertOverviewRecord:
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
    energy_wasted_kwh: float

def fetch_alerts_overview(engine: Engine, building_id: str) -> list[AlertOverviewRecord]:
    with Session(engine) as session:
        rows = session.exec(
            select(AlertsTable, DiagnosesTable.anomaly_id, DiagnosesTable.cause, DiagnosesTable.cause_confidence, DiagnosesTable.energy_wasted_kwh, RoomsTable.room_label, FloorsTable.level)
            .join(DiagnosesTable, DiagnosesTable.id == AlertsTable.diagnosis_id)
            .join(RoomsTable, RoomsTable.room_id == AlertsTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id)
            .order_by(AlertsTable.sent_at.desc())
        ).all()
    return [
        AlertOverviewRecord(
            id=a.id, diagnosis_id=a.diagnosis_id, anomaly_id=anomaly_id, room_id=a.room_id, room_label=room_label,
            floor_level=level, channel=a.channel, recipient=a.recipient, cause=cause, cause_confidence=cause_confidence,
            message=a.payload.get('message', '') if isinstance(a.payload, dict) else '', sent_at=a.sent_at,
            energy_wasted_kwh=energy_wasted_kwh,
        )
        for a, anomaly_id, cause, cause_confidence, energy_wasted_kwh, room_label, level in rows
    ]

@dataclass(frozen=True)
class DailyEnergyRecord:
    date: str
    kwh: float
    gco2: float

@dataclass(frozen=True)
class RoomLatestReading:
    room_id: str
    room_label: str
    floor_level: int
    temp_measured_c: float
    ts: datetime

@dataclass(frozen=True)
class ReportsSummaryRecord:
    total_kwh: float
    total_gco2: float
    daily: list[DailyEnergyRecord]
    room_readings: list[RoomLatestReading]

def fetch_reports_summary(engine: Engine, building_id: str, days: int) -> ReportsSummaryRecord:
    window_start = datetime.now(timezone.utc) - timedelta(days=days)
    with Session(engine) as session:
        schedule_rows = session.exec(
            select(MpcSchedulesTable.slot_ts, MpcSchedulesTable.predicted_kwh, MpcSchedulesTable.predicted_gco2)
            .join(RoomsTable, RoomsTable.room_id == MpcSchedulesTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id, MpcSchedulesTable.slot_ts >= window_start)
        ).all()
        room_rows = session.exec(
            select(RoomsTable.room_id, RoomsTable.room_label, FloorsTable.level)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id, RoomsTable.sensor_id.is_not(None))
        ).all()
        room_readings: list[RoomLatestReading] = []
        for room_id, room_label, level in room_rows:
            latest = session.exec(
                select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id).order_by(SensorReadingsTable.ts.desc()).limit(1)
            ).first()
            if latest is not None:
                room_readings.append(RoomLatestReading(room_id=room_id, room_label=room_label, floor_level=level, temp_measured_c=latest.temp_measured_c, ts=latest.ts))
    daily_map: dict[str, list[float]] = {}
    total_kwh = 0.0
    total_gco2 = 0.0
    for slot_ts, kwh, gco2 in schedule_rows:
        kwh = kwh or 0.0
        gco2 = gco2 or 0.0
        total_kwh += kwh
        total_gco2 += gco2
        bucket = daily_map.setdefault(slot_ts.date().isoformat(), [0.0, 0.0])
        bucket[0] += kwh
        bucket[1] += gco2
    daily = [DailyEnergyRecord(date=k, kwh=v[0], gco2=v[1]) for k, v in sorted(daily_map.items())]
    return ReportsSummaryRecord(total_kwh=total_kwh, total_gco2=total_gco2, daily=daily, room_readings=room_readings)


@dataclass(frozen=True)
class HeatmapRoomRecord:
    room_id: str
    room_label: str
    floor_id: str
    floor_level: int
    area_m2: float
    is_instrumented: bool
    latest_temp_c: float | None
    setpoint_c: float | None
    predicted_temp_c: float | None
    energy_kwh_24h: float
    carbon_gco2_24h: float
    has_open_anomaly: bool

def fetch_floor_heatmap(engine: Engine, building_id: str, floor_level: int, days: int = 1) -> list[HeatmapRoomRecord]:
    window_start = datetime.now(timezone.utc) - timedelta(days=days)
    with Session(engine) as session:
        rooms = session.exec(
            select(RoomsTable, FloorsTable.level)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id, FloorsTable.level == floor_level)
            .order_by(RoomsTable.room_label.asc())
        ).all()
        room_ids = [r.room_id for r, _ in rooms]
        if not room_ids:
            return []
        anomalies = session.exec(
            select(AnomaliesTable.room_id)
            .where(AnomaliesTable.room_id.in_(room_ids), AnomaliesTable.closed_at.is_(None))
        ).all()
        open_rooms = set(a for a in anomalies)
        energy_rows = session.exec(
            select(MpcSchedulesTable.room_id, func.sum(MpcSchedulesTable.predicted_kwh), func.sum(MpcSchedulesTable.predicted_gco2))
            .where(MpcSchedulesTable.room_id.in_(room_ids), MpcSchedulesTable.slot_ts >= window_start)
            .group_by(MpcSchedulesTable.room_id)
        ).all()
        energy_map = {room_id: (float(kwh or 0.0), float(gco2 or 0.0)) for room_id, kwh, gco2 in energy_rows}
        readings_map: dict[str, SensorReadingsTable] = {}
        setpoint_map: dict[str, MpcSchedulesTable] = {}
        for room_id in room_ids:
            latest_reading = session.exec(
                select(SensorReadingsTable).where(SensorReadingsTable.room_id == room_id).order_by(SensorReadingsTable.ts.desc()).limit(1)
            ).first()
            if latest_reading is not None:
                readings_map[room_id] = latest_reading
            latest_slot = session.exec(
                select(MpcSchedulesTable).where(MpcSchedulesTable.room_id == room_id).order_by(MpcSchedulesTable.slot_ts.desc()).limit(1)
            ).first()
            if latest_slot is not None:
                setpoint_map[room_id] = latest_slot
    return [
        HeatmapRoomRecord(
            room_id=r.room_id, room_label=r.room_label, floor_id=r.floor_id, floor_level=level,
            area_m2=r.area_m2, is_instrumented=r.sensor_id is not None,
            latest_temp_c=readings_map[r.room_id].temp_measured_c if r.room_id in readings_map else None,
            setpoint_c=setpoint_map[r.room_id].setpoint_c if r.room_id in setpoint_map else None,
            predicted_temp_c=setpoint_map[r.room_id].predicted_temp_c if r.room_id in setpoint_map else None,
            energy_kwh_24h=energy_map.get(r.room_id, (0.0, 0.0))[0],
            carbon_gco2_24h=energy_map.get(r.room_id, (0.0, 0.0))[1],
            has_open_anomaly=r.room_id in open_rooms,
        )
        for r, level in rooms
    ]


def fetch_latest_applied_action_decision(engine: Engine, room_id: str) -> dict[str, Any] | None:
    """Latest 'applied' action decision for a room (from diagnostic_agent's
    action_decisions table -- both agents share the same database)."""
    with Session(engine) as session:
        row = session.exec(
            text(
                """
                SELECT id, anomaly_id, diagnosis_id, room_id, decision, action_type, delta_c, decided_by, decided_at
                FROM action_decisions
                WHERE room_id = :room_id AND decision = 'applied'
                ORDER BY decided_at DESC
                LIMIT 1
                """
            ).bindparams(room_id=room_id)
        ).first()
    if row is None:
        return None
    return {
        "id": row.id,
        "anomaly_id": row.anomaly_id,
        "diagnosis_id": row.diagnosis_id,
        "room_id": row.room_id,
        "decision": row.decision,
        "action_type": row.action_type,
        "delta_c": row.delta_c,
        "decided_by": row.decided_by,
        "decided_at": row.decided_at,
    }
