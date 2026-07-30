from __future__ import annotations
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any
import numpy as np
from dotenv import load_dotenv
from sqlalchemy import Engine, create_engine, text
load_dotenv()

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

def _parse_config_json(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, str):
        return json.loads(value)
    return dict(value)

@lru_cache(maxsize=1)
def get_engine() -> Engine:
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise RuntimeError('DATABASE_URL must be set (see .env.example)')
    return create_engine(database_url)
_ROOM_CONTEXT_QUERY = text('\n    SELECT\n        r.room_id, r.floor_id, r.building_id, r.room_label, r.room_type,\n        r.area_m2, r.volume_m3, r.primary_orientation, r.r_wall, r.c_zone,\n        r.sensor_id, r.config_json,\n        f.level AS floor_level, f.name AS floor_name,\n        b.name AS building_name, b.latitude, b.longitude,\n        b.total_floors, b.country_code\n    FROM rooms r\n    JOIN floors f ON f.floor_id = r.floor_id\n    JOIN buildings b ON b.building_id = r.building_id\n    WHERE r.room_id = :room_id\n    ')

def fetch_room(engine: Engine, room_id: str) -> RoomRecord:
    with engine.connect() as conn:
        row = conn.execute(_ROOM_CONTEXT_QUERY, {'room_id': room_id}).mappings().first()
    if row is None:
        raise LookupError(f'Room not found: {room_id}')
    return RoomRecord(room_id=row['room_id'], floor_id=row['floor_id'], building_id=row['building_id'], room_label=row['room_label'], room_type=row['room_type'], area_m2=row['area_m2'], volume_m3=row['volume_m3'], primary_orientation=row['primary_orientation'], r_wall=row['r_wall'], c_zone=row['c_zone'], sensor_id=row['sensor_id'], config_json=_parse_config_json(row['config_json']))

def fetch_floor(engine: Engine, floor_id: str) -> FloorRecord:
    with engine.connect() as conn:
        row = conn.execute(text('SELECT floor_id, building_id, level, name FROM floors WHERE floor_id = :floor_id'), {'floor_id': floor_id}).mappings().first()
    if row is None:
        raise LookupError(f'Floor not found: {floor_id}')
    return FloorRecord(floor_id=row['floor_id'], building_id=row['building_id'], level=row['level'], name=row['name'])

def fetch_building(engine: Engine, building_id: str) -> BuildingRecord:
    with engine.connect() as conn:
        row = conn.execute(text('SELECT building_id, name, latitude, longitude, total_floors, country_code FROM buildings WHERE building_id = :building_id'), {'building_id': building_id}).mappings().first()
    if row is None:
        raise LookupError(f'Building not found: {building_id}')
    return BuildingRecord(building_id=row['building_id'], name=row['name'], latitude=row['latitude'], longitude=row['longitude'], total_floors=row['total_floors'], country_code=row['country_code'])

def fetch_room_adjacencies(engine: Engine, room_id: str) -> list[AdjacencyRecord]:
    with engine.connect() as conn:
        rows = conn.execute(text('SELECT room_id, adjacent_room_id, direction, wall_type FROM room_adjacencies WHERE room_id = :room_id'), {'room_id': room_id}).mappings().all()
    return [AdjacencyRecord(room_id=row['room_id'], adjacent_room_id=row['adjacent_room_id'], direction=row['direction'], wall_type=row['wall_type']) for row in rows]

@dataclass(frozen=True)
class SensorReadingsWindow:
    ts: list[datetime]
    temp_measured_c: np.ndarray
    temp_ext_c: np.ndarray
    q_solar_w: np.ndarray
    q_occ_w: np.ndarray
    q_hvac_w: np.ndarray

def fetch_sensor_readings(engine: Engine, room_id: str, start: datetime, end: datetime) -> SensorReadingsWindow:
    with engine.connect() as conn:
        rows = conn.execute(text('SELECT ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w FROM sensor_readings WHERE room_id = :room_id AND ts >= :start AND ts <= :end ORDER BY ts ASC'), {'room_id': room_id, 'start': start, 'end': end}).mappings().all()
    return SensorReadingsWindow(ts=[row['ts'] for row in rows], temp_measured_c=np.array([row['temp_measured_c'] for row in rows], dtype=float), temp_ext_c=np.array([row['temp_ext_c'] for row in rows], dtype=float), q_solar_w=np.array([row['q_solar_w'] for row in rows], dtype=float), q_occ_w=np.array([row['q_occ_w'] for row in rows], dtype=float), q_hvac_w=np.array([row['q_hvac_w'] for row in rows], dtype=float))

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
    with engine.connect() as conn:
        row = conn.execute(text('SELECT id, room_id, version, r_lumped, c_lumped, rmse_validation, anomaly_threshold_c, data_window_start, data_window_end, is_active, created_at FROM rc_model_params WHERE room_id = :room_id AND is_active = true'), {'room_id': room_id}).mappings().first()
    if row is None:
        return None
    return RcModelParamsRecord(**dict(row))

def insert_rc_model_params(engine: Engine, room_id: str, version: int, r_lumped: float, c_lumped: float, rmse_validation: float, anomaly_threshold_c: float, data_window_start: datetime, data_window_end: datetime) -> None:
    with engine.begin() as conn:
        conn.execute(text('UPDATE rc_model_params SET is_active = false WHERE room_id = :room_id AND is_active = true'), {'room_id': room_id})
        conn.execute(text('INSERT INTO rc_model_params (room_id, version, r_lumped, c_lumped, rmse_validation, anomaly_threshold_c, data_window_start, data_window_end, is_active) VALUES (:room_id, :version, :r_lumped, :c_lumped, :rmse_validation, :anomaly_threshold_c, :data_window_start, :data_window_end, true)'), {'room_id': room_id, 'version': version, 'r_lumped': r_lumped, 'c_lumped': c_lumped, 'rmse_validation': rmse_validation, 'anomaly_threshold_c': anomaly_threshold_c, 'data_window_start': data_window_start, 'data_window_end': data_window_end})

def fetch_latest_sensor_readings(engine: Engine, room_id: str, n: int) -> SensorReadingsWindow:
    with engine.connect() as conn:
        rows = conn.execute(text('SELECT ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w FROM sensor_readings WHERE room_id = :room_id ORDER BY ts DESC LIMIT :n'), {'room_id': room_id, 'n': n}).mappings().all()
    rows = list(reversed(rows))
    return SensorReadingsWindow(ts=[row['ts'] for row in rows], temp_measured_c=np.array([row['temp_measured_c'] for row in rows], dtype=float), temp_ext_c=np.array([row['temp_ext_c'] for row in rows], dtype=float), q_solar_w=np.array([row['q_solar_w'] for row in rows], dtype=float), q_occ_w=np.array([row['q_occ_w'] for row in rows], dtype=float), q_hvac_w=np.array([row['q_hvac_w'] for row in rows], dtype=float))

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
    with engine.connect() as conn:
        row = conn.execute(text('SELECT id, room_id, anomaly_type, opened_at, closed_at, residual_c, residual_trace, threshold_c, model_version, diagnosed FROM anomalies WHERE room_id = :room_id AND anomaly_type = :anomaly_type AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1'), {'room_id': room_id, 'anomaly_type': anomaly_type}).mappings().first()
    if row is None:
        return None
    return AnomalyRecord(**dict(row))

def insert_anomaly(engine: Engine, room_id: str, anomaly_type: str, opened_at: datetime, closed_at: datetime | None, residual_c: float | None, residual_trace: Any, threshold_c: float | None, model_version: int | None) -> int:
    with engine.begin() as conn:
        result = conn.execute(text('INSERT INTO anomalies (room_id, anomaly_type, opened_at, closed_at, residual_c, residual_trace, threshold_c, model_version, diagnosed) VALUES (:room_id, :anomaly_type, :opened_at, :closed_at, :residual_c, :residual_trace, :threshold_c, :model_version, false) RETURNING id'), {'room_id': room_id, 'anomaly_type': anomaly_type, 'opened_at': opened_at, 'closed_at': closed_at, 'residual_c': residual_c, 'residual_trace': json.dumps(residual_trace) if residual_trace is not None else None, 'threshold_c': threshold_c, 'model_version': model_version})
        return result.scalar_one()

def close_anomaly(engine: Engine, anomaly_id: int, closed_at: datetime) -> None:
    with engine.begin() as conn:
        conn.execute(text('UPDATE anomalies SET closed_at = :closed_at WHERE id = :id'), {'id': anomaly_id, 'closed_at': closed_at})

def insert_mpc_schedule_rows(engine: Engine, room_id: str, solved_at: datetime, model_version: int, slot_ts: list[datetime], setpoint_c: np.ndarray, predicted_temp_c: np.ndarray, predicted_kwh: np.ndarray, predicted_gco2: np.ndarray) -> None:
    rows = [{'room_id': room_id, 'solved_at': solved_at, 'slot_ts': slot_ts[k], 'setpoint_c': float(setpoint_c[k]), 'predicted_temp_c': float(predicted_temp_c[k]), 'predicted_kwh': float(predicted_kwh[k]), 'predicted_gco2': float(predicted_gco2[k]), 'model_version': model_version} for k in range(len(slot_ts))]
    with engine.begin() as conn:
        conn.execute(text('INSERT INTO mpc_schedules (room_id, solved_at, slot_ts, setpoint_c, predicted_temp_c, predicted_kwh, predicted_gco2, model_version) VALUES (:room_id, :solved_at, :slot_ts, :setpoint_c, :predicted_temp_c, :predicted_kwh, :predicted_gco2, :model_version)'), rows)

def fetch_instrumented_room_ids(engine: Engine, building_id: str) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(text('SELECT room_id FROM rooms WHERE building_id = :building_id AND sensor_id IS NOT NULL'), {'building_id': building_id}).all()
    return [row[0] for row in rows]
