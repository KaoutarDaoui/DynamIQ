"""Synthetic sensor-history backfill for rooms that don't have enough real
history yet for a first RC calibration (calibrate_room needs at least
CALIBRATION_MIN_SAMPLES readings within a WINDOW_DAYS window).

Shared by scripts/backfill_room_history.py (manual, one-off) and
run_orchestration_loop.py (automatic: called every cycle so a newly added
room -- e.g. from onboarding a new building or floor -- gets a realistic
history and its first calibration on its own, no manual step needed).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import Engine, text

from . import constants
from .db import count_sensor_readings, fetch_building, fetch_floor, fetch_room, fetch_room_adjacencies
from .rc import generate_synthetic_scenario
from .zone_model import build_zone_model

WINDOW_DAYS = 21


def needs_history_backfill(engine: Engine, room_id: str, now: datetime, window_days: int = WINDOW_DAYS) -> bool:
    window_start = now - timedelta(days=window_days)
    n = count_sensor_readings(engine, room_id, window_start, now)
    return n < constants.CALIBRATION_MIN_SAMPLES


def backfill_room_history(engine: Engine, room_id: str, now: datetime, window_days: int = WINDOW_DAYS) -> int:
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)
    model = build_zone_model(room, floor, building, adjacencies)
    scenario = generate_synthetic_scenario(
        model.r_lumped_k_per_w, model.c_lumped_j_per_k, days=window_days, seed=hash(room_id) % (2**31)
    )
    # End the synthetic window a bit before "now" so it doesn't collide with
    # readings the live simulator may already be writing for this room.
    end = now - timedelta(minutes=5)
    start = end - timedelta(days=window_days)
    n = len(scenario.t_ext_c)
    timestamps = [start + timedelta(seconds=900 * k) for k in range(n + 1)]
    rows = [
        {
            "room_id": room_id,
            "ts": timestamps[k],
            "temp_measured_c": float(scenario.t_measured_c[k]),
            "temp_ext_c": float(scenario.t_ext_c[k]) if k < n else float(scenario.t_ext_c[-1]),
            "q_solar_w": float(scenario.q_solar_w[k]) if k < n else float(scenario.q_solar_w[-1]),
            "q_occ_w": float(scenario.q_occ_w[k]) if k < n else float(scenario.q_occ_w[-1]),
            "q_hvac_w": float(scenario.q_hvac_w[k]) if k < n else float(scenario.q_hvac_w[-1]),
        }
        for k in range(n + 1)
    ]
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO sensor_readings (room_id, ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w) "
                "VALUES (:room_id, :ts, :temp_measured_c, :temp_ext_c, :q_solar_w, :q_occ_w, :q_hvac_w)"
            ),
            rows,
        )
    return len(rows)
