from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Engine, create_engine, text

load_dotenv()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set (see .env.example)")
    return create_engine(database_url)


def _parse_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return json.loads(value)
    return value


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
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT id, room_id, anomaly_type, opened_at, closed_at, residual_c, "
                "residual_trace, threshold_c, model_version, diagnosed "
                "FROM anomalies WHERE id = :id"
            ),
            {"id": anomaly_id},
        ).mappings().first()
    if row is None:
        return None
    d = dict(row)
    d["residual_trace"] = _parse_json(d["residual_trace"])
    return AnomalyRow(**d)


def mark_anomaly_diagnosed(engine: Engine, anomaly_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(text("UPDATE anomalies SET diagnosed = true WHERE id = :id"), {"id": anomaly_id})


def fetch_sensor_history(engine: Engine, room_id: str, hours: int) -> list[dict[str, Any]]:
    start = datetime.utcnow() - timedelta(hours=hours)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT ts, temp_measured_c, temp_ext_c, q_occ_w, q_hvac_w "
                "FROM sensor_readings WHERE room_id = :room_id AND ts >= :start ORDER BY ts ASC"
            ),
            {"room_id": room_id, "start": start},
        ).mappings().all()
    return [dict(r) for r in rows]


def fetch_occupancy_pattern(engine: Engine, room_id: str, days: int) -> list[dict[str, Any]]:
    start = datetime.utcnow() - timedelta(days=days)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT ts, q_occ_w FROM sensor_readings "
                "WHERE room_id = :room_id AND ts >= :start ORDER BY ts ASC"
            ),
            {"room_id": room_id, "start": start},
        ).mappings().all()
    return [dict(r) for r in rows]


def fetch_mpc_trajectory(engine: Engine, room_id: str) -> list[dict[str, Any]]:
    with engine.connect() as conn:
        latest_solved_at = conn.execute(
            text("SELECT max(solved_at) FROM mpc_schedules WHERE room_id = :room_id"),
            {"room_id": room_id},
        ).scalar_one_or_none()
        if latest_solved_at is None:
            return []
        rows = conn.execute(
            text(
                "SELECT slot_ts, setpoint_c, predicted_temp_c, predicted_kwh, predicted_gco2, model_version "
                "FROM mpc_schedules WHERE room_id = :room_id AND solved_at = :solved_at ORDER BY slot_ts ASC"
            ),
            {"room_id": room_id, "solved_at": latest_solved_at},
        ).mappings().all()
    return [dict(r) for r in rows]


def fetch_hvac_power_history(engine: Engine, room_id: str, hours: int) -> list[dict[str, Any]]:
    start = datetime.utcnow() - timedelta(hours=hours)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT ts, q_hvac_w FROM sensor_readings "
                "WHERE room_id = :room_id AND ts >= :start ORDER BY ts ASC"
            ),
            {"room_id": room_id, "start": start},
        ).mappings().all()
    return [dict(r) for r in rows]


def fetch_similar_anomalies(engine: Engine, room_id: str, days: int, exclude_anomaly_id: int | None = None) -> list[dict[str, Any]]:
    start = datetime.utcnow() - timedelta(days=days)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT a.id, a.opened_at, a.closed_at, a.residual_c, a.threshold_c, "
                "d.cause, d.cause_confidence "
                "FROM anomalies a LEFT JOIN diagnoses d ON d.anomaly_id = a.id "
                "WHERE a.room_id = :room_id AND a.anomaly_type = 'thermal_anomaly' "
                "AND a.opened_at >= :start AND (:exclude_id IS NULL OR a.id != :exclude_id) "
                "ORDER BY a.opened_at DESC"
            ),
            {"room_id": room_id, "start": start, "exclude_id": exclude_anomaly_id},
        ).mappings().all()
    return [dict(r) for r in rows]


def fetch_building_context(engine: Engine, room_id: str) -> dict[str, Any] | None:
    with engine.connect() as conn:
        room = conn.execute(
            text(
                "SELECT r.room_id, r.room_label, r.room_type, r.area_m2, r.volume_m3, "
                "r.primary_orientation, r.r_wall, r.c_zone, r.config_json, "
                "f.level AS floor_level, b.total_floors, b.name AS building_name "
                "FROM rooms r JOIN floors f ON f.floor_id = r.floor_id "
                "JOIN buildings b ON b.building_id = r.building_id WHERE r.room_id = :room_id"
            ),
            {"room_id": room_id},
        ).mappings().first()
        if room is None:
            return None
        model = conn.execute(
            text(
                "SELECT version, r_lumped, c_lumped, rmse_validation, anomaly_threshold_c "
                "FROM rc_model_params WHERE room_id = :room_id AND is_active = true"
            ),
            {"room_id": room_id},
        ).mappings().first()
    result = dict(room)
    result["config_json"] = _parse_json(result["config_json"])
    result["active_model"] = dict(model) if model is not None else None
    return result


def fetch_neighboring_zones(engine: Engine, room_id: str) -> list[dict[str, Any]]:
    with engine.connect() as conn:
        adjacency_rows = conn.execute(
            text("SELECT adjacent_room_id, direction, wall_type FROM room_adjacencies WHERE room_id = :room_id"),
            {"room_id": room_id},
        ).mappings().all()
        neighbors = []
        for row in adjacency_rows:
            latest = conn.execute(
                text(
                    "SELECT temp_measured_c, ts FROM sensor_readings "
                    "WHERE room_id = :room_id ORDER BY ts DESC LIMIT 1"
                ),
                {"room_id": row["adjacent_room_id"]},
            ).mappings().first()
            neighbors.append(
                {
                    "room_id": row["adjacent_room_id"],
                    "direction": row["direction"],
                    "wall_type": row["wall_type"],
                    "latest_temp_c": latest["temp_measured_c"] if latest else None,
                    "latest_ts": latest["ts"] if latest else None,
                }
            )
    return neighbors


def insert_diagnosis(engine: Engine, record: dict[str, Any]) -> int:
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "INSERT INTO diagnoses (anomaly_id, room_id, cause, cause_confidence, evidence, "
                "energy_wasted_kwh, energy_wasted_basis, proposed_action, recurrence, message, "
                "supervisor_decision) "
                "VALUES (:anomaly_id, :room_id, :cause, :cause_confidence, :evidence, "
                ":energy_wasted_kwh, :energy_wasted_basis, :proposed_action, :recurrence, :message, "
                ":supervisor_decision) RETURNING id"
            ),
            {
                **record,
                "evidence": json.dumps(record["evidence"]),
                "proposed_action": json.dumps(record["proposed_action"]),
                "recurrence": json.dumps(record["recurrence"]),
            },
        )
        return result.scalar_one()


def insert_alert(engine: Engine, diagnosis_id: int, room_id: str, channel: str, recipient: str, payload: dict[str, Any]) -> int:
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "INSERT INTO alerts (diagnosis_id, room_id, channel, recipient, payload) "
                "VALUES (:diagnosis_id, :room_id, :channel, :recipient, :payload) RETURNING id"
            ),
            {"diagnosis_id": diagnosis_id, "room_id": room_id, "channel": channel, "recipient": recipient, "payload": json.dumps(payload)},
        )
        return result.scalar_one()


def insert_audit_log(engine: Engine, record: dict[str, Any]) -> int:
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "INSERT INTO audit_log (anomaly_id, room_id, invoked_at, tool_calls, model_output, "
                "supervisor_decision, diagnosis_id) "
                "VALUES (:anomaly_id, :room_id, :invoked_at, :tool_calls, :model_output, "
                ":supervisor_decision, :diagnosis_id) RETURNING id"
            ),
            {
                **record,
                "tool_calls": json.dumps(record["tool_calls"]),
                "model_output": json.dumps(record["model_output"]),
                "supervisor_decision": json.dumps(record["supervisor_decision"]),
            },
        )
        return result.scalar_one()


def fetch_recent_diagnoses_for_cooldown(engine: Engine, room_id: str, cause: str, days: int) -> list[dict[str, Any]]:
    start = datetime.utcnow() - timedelta(days=days)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id, created_at, supervisor_decision FROM diagnoses "
                "WHERE room_id = :room_id AND cause = :cause AND created_at >= :start "
                "ORDER BY created_at DESC"
            ),
            {"room_id": room_id, "cause": cause, "start": start},
        ).mappings().all()
    return [dict(r) for r in rows]
