from __future__ import annotations

"""Scenario 5: calibration_drift.

Phases:
  1. perturb (default): add a linear upward drift to sensor temp over 24h
     AND inflate the active model's RMSE above its anomaly threshold so the
     evidence layer sees model_unreliable + consistent_bias.
  2. restore: put the model's RMSE back.

Usage:
    python dev/seed_calibration_drift.py perturb [--now]
    python dev/seed_calibration_drift.py restore
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.thermal_agent.db import (
    fetch_active_rc_model_params,
    fetch_room,
    get_engine,
    insert_anomaly,
)

ROOM_ID = "djezzy-hq-floor-1-room-01"
HOURS = 24.0
_log = []


def perturb() -> None:
    engine = get_engine()
    fetch_room(engine, ROOM_ID)
    model = fetch_active_rc_model_params(engine, ROOM_ID)
    print(f"active model version={model.version} rmse={model.rmse_validation:.3f} threshold={model.anomaly_threshold_c:.3f}")

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=HOURS)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT ts, temp_measured_c FROM sensor_readings WHERE room_id = :room "
                "AND ts >= :start AND ts <= :end ORDER BY ts ASC"
            ),
            {"room": ROOM_ID, "start": start, "end": now},
        ).fetchall()
    if not rows:
        raise SystemExit("no readings in window")
    print(f"{len(rows)} readings in {start:%m-%d %H:%M}..{now:%m-%d %H:%M}")

    updates: list[str] = []
    for k, r in enumerate(rows):
        bias = 0.04 * (k + 1)
        meas = float(r.temp_measured_c) + bias
        updates.append(f"WHEN '{r.ts.isoformat()}' THEN {meas!r}")

    sql = (
        "UPDATE sensor_readings SET temp_measured_c = CASE ts "
        + " ".join(updates)
        + f" ELSE temp_measured_c END WHERE room_id = :room AND ts BETWEEN :s AND :e"
    )
    bloated = round(model.rmse_validation * 12.0, 3)

    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE sensor_readings SET q_occ_w = 0, q_hvac_w = 0 "
                "WHERE room_id = :room AND ts BETWEEN :s AND :e"
            ),
            {"room": ROOM_ID, "s": start, "e": now},
        )
        conn.execute(text(sql), {"room": ROOM_ID, "s": start, "e": now})
        _log.append({"prev_rmse": model.rmse_validation, "model_id": model.id})
        conn.execute(
            text("UPDATE rc_model_params SET rmse_validation = :rmse WHERE id = :id"),
            {"rmse": bloated, "id": model.id},
        )
    opened = rows[0].ts
    closed = rows[-1].ts
    residual = float(rows[-1].temp_measured_c) + 0.04 * len(rows) - float(rows[0].temp_measured_c)
    trace = [{"ts": r.ts.isoformat(), "residual_c": 0.04 * (k + 1)} for k, r in enumerate(rows[-3:])]
    aid = insert_anomaly(engine, ROOM_ID, "thermal_anomaly", opened, closed, residual, trace, model.anomaly_threshold_c, model.version)
    print(f"ANOMALY {aid} window={opened:%m-%d %H:%M}..{closed:%m-%d %H:%M} residual={residual:.2f} drift, model rmse -> {bloated}")
    print(f"NEXT: run diagnosis, then 'python dev/seed_calibration_drift.py restore'")


def restore() -> None:
    engine = get_engine()
    with engine.connect() as conn:
        fixed = conn.execute(
            text("SELECT id, r_lumped, c_lumped FROM rc_model_params WHERE is_active = true")
        ).first()
        print("active model:", fixed.id, "r=", fixed.r_lumped, "c=", fixed.c_lumped)

    model = fetch_active_rc_model_params(engine, ROOM_ID)
    if _log:
        prev = _log[0]["prev_rmse"]
    else:
        prev = None

    if prev is not None:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE rc_model_params SET rmse_validation = :rmse WHERE id = :id"),
                {"rmse": prev, "id": _log[0]["model_id"]},
            )
        print(f"restored model rmse to {prev}")
    else:
        print("NOTE: no in-memory prev_rmse; use a level-appropriate value manually.")

    # re-run good calibration if needed? no -- just report
    print("done.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "perturb"
    if cmd == "perturb":
        perturb()
    elif cmd == "restore":
        restore()
    else:
        raise SystemExit(f"unknown cmd {cmd!r} (use perturb|restore)")