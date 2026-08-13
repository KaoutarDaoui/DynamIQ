from __future__ import annotations

"""Regenerate clean synthetic sensor readings for one room.

Deletes the room's existing sensor_readings and writes 21 days of
model-consistent ("normal") data ending NOW, so the LLM's now-relative
tool windows contain readings. Deterministic: seed=42.

Usage:
    python dev/seed_clean_readings.py <room_id> [days]
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.thermal_agent.db import (
    fetch_building,
    fetch_floor,
    fetch_room,
    fetch_room_adjacencies,
    get_engine,
)
from agents.thermal_agent.rc import generate_synthetic_scenario
from agents.thermal_agent.zone_model import build_zone_model


def _sql_literal(value):
    if isinstance(value, datetime):
        return "'" + value.isoformat() + "'"
    return repr(float(value))


def main() -> None:
    room_id = sys.argv[1] if len(sys.argv) > 1 else "djezzy-hq-floor-1-room-01"
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 21

    engine = get_engine()
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)
    model = build_zone_model(room, floor, building, adjacencies)

    print(f"Generating {days}d clean history for {room_id}:")
    print(
        f"  R_true={model.r_lumped_k_per_w:.5f} K/W  "
        f"C_true={model.c_lumped_j_per_k:,.0f} J/K  tau={model.tau_hours:.2f}h"
    )

    scenario = generate_synthetic_scenario(
        model.r_lumped_k_per_w, model.c_lumped_j_per_k, days=days, seed=42
    )
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    n = len(scenario.t_ext_c)
    timestamps = [start + timedelta(seconds=900 * k) for k in range(n + 1)]

    def field(k, arr):
        return float(arr[k]) if k < n else float(arr[-1])

    rows_sql = []
    for k in range(n + 1):
        room_esc = room_id.replace("'", "''")
        ts = timestamps[k]
        t = float(scenario.t_measured_c[k])
        te = field(k, scenario.t_ext_c)
        qs = field(k, scenario.q_solar_w)
        qo = field(k, scenario.q_occ_w)
        qh = field(k, scenario.q_hvac_w)
        rows_sql.append(
            f"('{room_esc}', {_sql_literal(ts)}, {t!r}, {te!r}, {qs!r}, {qo!r}, {qh!r})"
        )

    with engine.begin() as conn:
        deleted = conn.execute(
            text("DELETE FROM sensor_readings WHERE room_id = :room_id"),
            {"room_id": room_id},
        ).rowcount
        print(f"Deleted {deleted} existing readings.")
        batch = 500
        for i in range(0, len(rows_sql), batch):
            chunk = rows_sql[i : i + batch]
            sql = (
                "INSERT INTO sensor_readings (room_id, ts, temp_measured_c, "
                "temp_ext_c, q_solar_w, q_occ_w, q_hvac_w) VALUES "
                + ",".join(chunk)
            )
            conn.execute(text(sql))
            print(f"  inserted {len(chunk)} rows (batch {i // batch + 1})")

    print(f"DONE: {len(rows_sql)} readings, {timestamps[0]} .. {timestamps[-1]}")


if __name__ == "__main__":
    main()
