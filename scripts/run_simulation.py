from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import numpy as np
from sqlalchemy import text

from agents.supervisor.db import fetch_undiagnosed_anomaly_ids
from agents.supervisor.orchestrate import run_diagnosis_cycle
from agents.thermal_agent.db import (
    fetch_active_rc_model_params,
    fetch_building,
    fetch_floor,
    fetch_room,
    fetch_room_adjacencies,
    get_engine,
)
from agents.thermal_agent.handler import run_fast_loop_for_room
from agents.thermal_agent.rc import generate_synthetic_scenario
from agents.thermal_agent.zone_model import build_zone_model

BUILDING_ID = "1"
ROOM_ID = "1-floor-2-room-16"
SCENARIO = (
    "A window is left open in a warm classroom during occupied hours. "
    "The room runs progressively warmer than the thermal model predicts, "
    "even though the HVAC is running -- the classic 'HVAC underperforming / "
    "unmodelled gain' signature the spec's own anomaly.py docstring describes."
)

RUNS_DIR = Path(__file__).resolve().parent / "simulation_runs"


class Trace:
    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []

    def log(self, agent: str, action: str, details: Any = None, result: Any = None) -> None:
        self.steps.append(
            {
                "step": len(self.steps) + 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "agent": agent,
                "action": action,
                "details": details,
                "result": result,
            }
        )
        label = f"[{len(self.steps):02d}] {agent:22s} {action}"
        print(label)


def _refresh_sensor_history(engine, trace: Trace, room_id: str, days: int = 7) -> None:
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)
    model = build_zone_model(room, floor, building, adjacencies)

    active = fetch_active_rc_model_params(engine, room_id)
    r_true = active.r_lumped if active is not None else model.r_lumped_k_per_w
    c_true = active.c_lumped if active is not None else model.c_lumped_j_per_k

    scenario = generate_synthetic_scenario(r_true, c_true, days=days, seed=int(datetime.now().timestamp()) % 1000)
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    n = len(scenario.t_ext_c)
    timestamps = [start + timedelta(seconds=900 * k) for k in range(n + 1)]

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM sensor_readings WHERE room_id = :r"), {"r": room_id})
        rows = [
            {
                "room_id": room_id,
                "ts": timestamps[k],
                "temp_measured_c": float(scenario.t_measured_c[k]),
                "temp_ext_c": float(scenario.t_ext_c[k] if k < n else scenario.t_ext_c[-1]),
                "q_solar_w": float(scenario.q_solar_w[k] if k < n else scenario.q_solar_w[-1]),
                "q_occ_w": float(scenario.q_occ_w[k] if k < n else scenario.q_occ_w[-1]),
                "q_hvac_w": float(scenario.q_hvac_w[k] if k < n else scenario.q_hvac_w[-1]),
            }
            for k in range(n + 1)
        ]
        conn.execute(
            text(
                "INSERT INTO sensor_readings (room_id, ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w) "
                "VALUES (:room_id, :ts, :temp_measured_c, :temp_ext_c, :q_solar_w, :q_occ_w, :q_hvac_w)"
            ),
            rows,
        )
    trace.log(
        "simulation_harness",
        "refresh_sensor_history",
        {"room_id": room_id, "days": days, "r_used": r_true, "c_used": c_true},
        {"rows_written": len(rows), "window_start": timestamps[0].isoformat(), "window_end": timestamps[-1].isoformat()},
    )


def _inject_window_left_open(engine, trace: Trace, room_id: str) -> None:
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT ts, temp_measured_c FROM sensor_readings WHERE room_id = :r ORDER BY ts DESC LIMIT 5"),
            {"r": room_id},
        ).all()
        before = [dict(ts=r[0].isoformat(), temp_measured_c=r[1]) for r in reversed(rows)]

        baseline_c = rows[0][1]
        max_addition = max(3.0, min(6.0, 44.0 - baseline_c))
        ramp = [round(max_addition * f, 2) for f in (0.2, 0.4, 0.6, 0.8, 1.0)]
        for (ts, _temp), offset in zip(reversed(rows), ramp):
            conn.execute(
                text("UPDATE sensor_readings SET temp_measured_c = temp_measured_c + :o WHERE room_id = :r AND ts = :ts"),
                {"o": offset, "r": room_id, "ts": ts},
            )
        rows_after = conn.execute(
            text("SELECT ts, temp_measured_c FROM sensor_readings WHERE room_id = :r ORDER BY ts DESC LIMIT 5"),
            {"r": room_id},
        ).all()
        after = [dict(ts=r[0].isoformat(), temp_measured_c=r[1]) for r in reversed(rows_after)]
    trace.log(
        "simulation_harness",
        "inject_window_left_open",
        {"room_id": room_id, "ramp_offsets_c": ramp, "readings_before": before},
        {"readings_after": after},
    )


def main() -> None:
    trace = Trace()
    engine = get_engine()

    trace.log("simulation_harness", "scenario_start", {"building_id": BUILDING_ID, "room_id": ROOM_ID, "scenario": SCENARIO})

    _refresh_sensor_history(engine, trace, ROOM_ID, days=7)
    _inject_window_left_open(engine, trace, ROOM_ID)

    now = datetime.now(timezone.utc)
    timestamps = [now + timedelta(seconds=900 * k) for k in range(96)]
    occupied = np.array([8 <= t.hour < 16 for t in timestamps], dtype=bool)

    trace.log("agent2_thermal", "run_fast_loop_for_room", {"room_id": ROOM_ID, "occupied_now": bool(occupied[0])})
    fast_loop_result = run_fast_loop_for_room(engine, ROOM_ID, occupied, now=now, offline=True)
    trace.log(
        "agent2_thermal",
        "fast_loop_result",
        None,
        {
            "ran_control": fast_loop_result.ran_control,
            "reason": fast_loop_result.reason,
            "mpc_status": fast_loop_result.mpc_status,
            "comfort_violated": fast_loop_result.comfort_violated,
            "anomaly_stage": fast_loop_result.anomaly.stage if fast_loop_result.anomaly else None,
            "anomaly_detail": fast_loop_result.anomaly.detail if fast_loop_result.anomaly else None,
            "anomaly_id": fast_loop_result.anomaly.anomaly_id if fast_loop_result.anomaly else None,
        },
    )

    if fast_loop_result.anomaly is None or fast_loop_result.anomaly.stage != "thermal_anomaly":
        trace.log(
            "simulation_harness",
            "scenario_outcome",
            None,
            {"raised_anomaly": False, "note": "The injected deviation did not trigger a thermal_anomaly this run -- see the fast_loop_result step above for what Agent 2 actually found instead."},
        )
        _write_trace(trace, success=False)
        return

    trace.log("agent4_supervisor", "poll_undiagnosed_anomalies", {"building_id": BUILDING_ID})
    pending_before = fetch_undiagnosed_anomaly_ids(engine, BUILDING_ID)
    trace.log("agent4_supervisor", "undiagnosed_anomalies_found", None, {"anomaly_ids": pending_before})

    trace.log("agent4_supervisor", "run_diagnosis_cycle", {"building_id": BUILDING_ID})
    diagnosis_results = run_diagnosis_cycle(engine, BUILDING_ID)

    for result in diagnosis_results:
        trace.log(
            "agent3_diagnostic",
            "diagnose_anomaly",
            {"anomaly_id": result.anomaly_id, "room_id": result.room_id},
            {
                "fallback_used": result.fallback_used,
                "tool_calls_made": result.tool_calls_made,
                "cause": result.validated_output["cause"],
                "cause_confidence": result.validated_output["cause_confidence"],
                "evidence": result.validated_output["evidence"],
                "energy_wasted_kwh": result.validated_output["energy_wasted_kwh"],
                "proposed_action": result.validated_output["proposed_action"],
                "message": result.validated_output["message"],
            },
        )
        trace.log(
            "agent4_supervisor",
            "decide",
            {"anomaly_id": result.anomaly_id, "proposed_action": result.validated_output["proposed_action"]},
            {"decision": result.supervisor_decision.decision, "reason": result.supervisor_decision.reason},
        )
        if result.supervisor_decision.decision == "human_alert":
            trace.log(
                "agent4_supervisor",
                "dispatch_alert",
                {"anomaly_id": result.anomaly_id, "channels": "log (+ webhook if configured)"},
                {"dispatched": True},
            )

    trace.log("simulation_harness", "verify_persisted_state", {"building_id": BUILDING_ID})
    with engine.connect() as conn:
        diag_rows = conn.execute(
            text(
                "SELECT d.id, d.anomaly_id, d.room_id, d.cause, d.supervisor_decision "
                "FROM diagnoses d JOIN rooms r ON r.room_id = d.room_id WHERE r.building_id = :b ORDER BY d.id"
            ),
            {"b": BUILDING_ID},
        ).all()
        anomaly_rows = conn.execute(
            text(
                "SELECT a.id, a.room_id, a.diagnosed FROM anomalies a JOIN rooms r ON r.room_id = a.room_id "
                "WHERE r.building_id = :b ORDER BY a.id"
            ),
            {"b": BUILDING_ID},
        ).all()
    trace.log(
        "simulation_harness",
        "database_verification",
        None,
        {
            "diagnoses_rows": [dict(id=r[0], anomaly_id=r[1], room_id=r[2], cause=r[3], supervisor_decision=r[4]) for r in diag_rows],
            "anomalies_rows": [dict(id=r[0], room_id=r[1], diagnosed=r[2]) for r in anomaly_rows],
        },
    )

    _write_trace(trace, success=True)


def _write_trace(trace: Trace, success: bool) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = {
        "run_id": run_id,
        "building_id": BUILDING_ID,
        "room_id": ROOM_ID,
        "scenario": SCENARIO,
        "success": success,
        "step_count": len(trace.steps),
        "steps": trace.steps,
    }
    path = RUNS_DIR / f"run_{run_id}.json"
    path.write_text(json.dumps(output, indent=2, default=str), encoding="utf-8")
    latest_path = RUNS_DIR / "latest.json"
    latest_path.write_text(json.dumps(output, indent=2, default=str), encoding="utf-8")
    print()
    print(f"Wrote {len(trace.steps)} steps to {path}")
    print(f"Also updated {latest_path}")


if __name__ == "__main__":
    main()
