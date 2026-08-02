from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Engine, text


def fetch_undiagnosed_anomaly_ids(engine: Engine, building_id: str) -> list[int]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT a.id FROM anomalies a JOIN rooms r ON r.room_id = a.room_id "
                "WHERE r.building_id = :building_id AND a.anomaly_type = 'thermal_anomaly' "
                "AND a.diagnosed = false ORDER BY a.opened_at ASC"
            ),
            {"building_id": building_id},
        ).all()
    return [row[0] for row in rows]


def fetch_last_calibration_time(engine: Engine, building_id: str) -> datetime | None:
    with engine.connect() as conn:
        result = conn.execute(
            text(
                "SELECT max(p.created_at) FROM rc_model_params p JOIN rooms r ON r.room_id = p.room_id "
                "WHERE r.building_id = :building_id"
            ),
            {"building_id": building_id},
        ).scalar_one_or_none()
    if result is not None and result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result
