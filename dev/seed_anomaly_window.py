from __future__ import annotations

"""Scenario 1: hvac_underperformance.

Perturbs the last `hours` of djezzy-hq-floor-1-room-01: measurement climbs
steeply (overheating) while q_hvac_w < 0 (cooling is called but fails), then
inserts a thermal_anomaly (diagnosed=false) over exactly that window.

The anomaly window ends at the newest reading, so the LLM's now-relative
tool windows (get_sensor_history/get_hvac_logs ~ now-4h) contain the
perturbed data. Evidence layer uses the anomaly window -> corroborating
signals: hvac_running, overheating + rising trend.

Usage:
    python dev/seed_anomaly_window.py hvac_underperformance [hours]
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

SCENARIOS: dict[str, dict] = {
    "hvac_underperformance": {
        "label": "hvac_underperformance",
        "perturb": "rise_while_cooling",
        "step_delta": 0.25,
        "hvac_w": -1500.0,
        "occ_w": 0.0,
    },
    "window_open_occupancy_gain": {
        "label": "window_open_occupancy_gain",
        "perturb": "stable_high_occupied",
        "step_delta": 4.0,
        "hvac_w": -1500.0,
        "occ_w": 1500.0,
    },
    "unmodelled_internal_gain": {
        "label": "unmodelled_internal_gain",
        "perturb": "rise_no_hvac",
        "step_delta": 0.25,
        "hvac_w": 0.0,
        "occ_w": 1500.0,
    },
    "sensor_failure": {
        "label": "sensor_failure",
        "perturb": "delete_window",
        "step_delta": 0.0,
        "hvac_w": None,
        "occ_w": None,
    },
    "scheduling_error": {
        "label": "scheduling_error",
        "perturb": "cool_empty_room",
        "step_delta": -0.25,
        "hvac_w": -1500.0,
        "occ_w": 0.0,
    },
}


def _run() -> None:
    room_id = "djezzy-hq-floor-1-room-01"
    scenario_name = sys.argv[1] if len(sys.argv) > 1 else "hvac_underperformance"
    hours = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
    changes_per_hour = 4  # 15-min steps
    n_steps = int(hours * changes_per_hour)

    engine = get_engine()
    room = fetch_room(engine, room_id)
    model = fetch_active_rc_model_params(engine, room_id)
    if model is None:
        raise SystemExit("no active rc_model_params -- run thermal agent first")

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w "
                "FROM sensor_readings WHERE room_id = :room AND ts >= :start AND ts <= :end "
                "ORDER BY ts ASC"
            ),
            {"room": room_id, "start": start, "end": now},
        ).fetchall()

    if not rows:
        raise SystemExit(f"no readings in window {start}..{now}")

    scenario = SCENARIOS[scenario_name]
    mode = scenario["perturb"]
    hvac_w = scenario["hvac_w"]
    occ_w = scenario["occ_w"]

    base_temp = float(rows[0].temp_measured_c)
    if mode == "delete_window":
        if rows:
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM sensor_readings WHERE room_id = :room AND ts BETWEEN :s AND :e"),
                    {"room": room_id, "s": rows[0].ts, "e": rows[-1].ts},
                )
                print(f"deleted {len(rows)} readings in window {rows[0].ts}..{rows[-1].ts}")
        opened = rows[0].ts
        closed = rows[-1].ts
        residual = abs(float(rows[-1].temp_measured_c) - float(rows[0].temp_measured_c))
        threshold = model.anomaly_threshold_c
        version = model.version
        trace = [{"ts": r.ts.isoformat(), "residual_c": None} for r in rows[-3:]]
        anomaly_id = insert_anomaly(engine, room_id, "thermal_anomaly", opened, closed, residual, trace, threshold, version)
        print(f"INSERTED anomaly id={anomaly_id} window={opened}..{closed} residual={residual:.2f} threshold={threshold:.3f}")
        return
    if mode == "rise_while_cooling":
        step_delta = scenario["step_delta"]
        target_temp = lambda k: base_temp + step_delta * (k + 1)  # noqa: E731
    elif mode == "stable_high_occupied":
        target_temp = lambda k: base_temp + scenario["step_delta"]  # noqa: E731
    elif mode == "rise_no_hvac":
        step_delta = scenario["step_delta"]
        target_temp = lambda k: base_temp + step_delta * (k + 1)  # noqa: E731
    elif mode == "cool_empty_room":
        step_delta = scenario["step_delta"]
        target_temp = lambda k: base_temp + step_delta * (k + 1)  # noqa: E731
    else:
        raise SystemExit(f"unknown perturb mode {mode!r}")

    updates: list[tuple[float, str]] = []
    for k, r in enumerate(rows):
        meas = target_temp(k)
        updates.append((meas, r.ts.isoformat()))
        if k == 0:
            print(f"Perturbing {len(rows)} readings from {rows[0].ts} .. {rows[-1].ts} [{mode}]:")
            print(f"  temp base {rows[0].temp_measured_c:.2f} -> ~{updates[-1][0]:.2f} C, HVAC {hvac_w} W, occ {occ_w} W")

    sql = (
        "UPDATE sensor_readings SET "
        "temp_measured_c = CASE ts "
        + " ".join(f"WHEN :t{k}_ts THEN :t{k}_v" for k in range(len(updates)))
        + " ELSE temp_measured_c END, "
        "q_hvac_w = CASE WHEN ts BETWEEN :s AND :e THEN :hvac ELSE q_hvac_w END, "
        "q_occ_w = CASE WHEN ts BETWEEN :s AND :e THEN :occ ELSE q_occ_w END "
        "WHERE room_id = :room AND ts BETWEEN :s AND :e"
    )
    params = {"room": room_id, "s": start, "e": now, "hvac": hvac_w, "occ": occ_w}
    for k, (val, ts) in enumerate(updates):
        params[f"t{k}_ts"] = ts
        params[f"t{k}_v"] = val

    with engine.begin() as conn:
        done = conn.execute(text(sql), params).rowcount
        print(f"updated {done} rows")

    opened = rows[0].ts
    closed = rows[-1].ts
    residual = float(updates[-1][0]) - float(rows[0].temp_measured_c)
    threshold = model.anomaly_threshold_c
    version = model.version
    trace = [{"ts": r.ts.isoformat(), "residual_c": float(r.temp_measured_c)} for r in rows[-3:]]
    anomaly_id = insert_anomaly(
        engine,
        room_id,
        "thermal_anomaly",
        opened,
        closed,
        residual,
        trace,
        threshold,
        version,
    )
    print(f"INSERTED anomaly id={anomaly_id} window={opened}..{closed} residual={residual:.2f} threshold={threshold:.3f}")


if __name__ == "__main__":
    _run()