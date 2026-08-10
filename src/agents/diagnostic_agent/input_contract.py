from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Engine

from . import db


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
    duration_min = max((end - anomaly.opened_at).total_seconds() / 60.0, 0.0)
    return {
        "anomaly_id": anomaly.id,
        "room_id": anomaly.room_id,
        "detected_at": anomaly.opened_at.isoformat(),
        "type": classify_anomaly_type(residual_c, trace, hvac_running),
        "anomaly_type": classify_anomaly_type(residual_c, trace, hvac_running),
        "residual_c": residual_c,
        "threshold_c": anomaly.threshold_c,
        "duration_min": round(duration_min, 2),
        "duration_hours": round(duration_min / 60.0, 2),
        "hvac_running": hvac_running,
    }
