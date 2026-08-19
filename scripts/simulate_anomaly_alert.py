"""Raise a real thermal anomaly end-to-end and confirm it reaches the alert
pipeline -- built to test that notifications land in the right inbox after
the switch to routing alerts by real user account email instead of the
static organisation contact.

What this actually exercises, all for real (no mocking):
  1. Writes a synthetic-but-physically-plausible sensor history for a room.
  2. Injects a sustained deviation (a "window left open" style ramp) so
     Agent 2's anomaly pipeline raises a real thermal_anomaly.
  3. Runs Agent 3 (diagnosis) + Agent 4 (the deterministic supervisor) via
     orchestration.orchestrate.run_diagnosis_cycle -- the exact function
     that resolves the alert recipient and dispatches it.
  4. Reports what actually happened: the diagnosis, the supervisor decision,
     which email address was resolved, whether the email channel is even
     configured, and whether a dispatch was logged.

Usage:
    python scripts/simulate_anomaly_alert.py
    python scripts/simulate_anomaly_alert.py --room-id djezzy-hq-floor-1-room-01
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import numpy as np
from sqlalchemy import text

from agents.thermal_agent.db import fetch_active_rc_model_params, fetch_building, fetch_floor, fetch_room, fetch_room_adjacencies, get_engine
from agents.thermal_agent.handler import run_fast_loop_for_room
from agents.thermal_agent.rc import generate_synthetic_scenario
from agents.thermal_agent.zone_model import build_zone_model
from orchestration import channels
from orchestration.db import fetch_org_alert_email, fetch_org_user_emails
from orchestration.orchestrate import run_diagnosis_cycle

ALERT_LOG_PATH = Path(__file__).resolve().parent.parent / "logs" / "alerts.jsonl"


def _reset_prior_anomalies(engine, room_id: str) -> None:
    # fetch_undiagnosed_anomaly_ids only ever returns anomalies with
    # diagnosed=False, so a leftover anomaly from an earlier test run of
    # this same script would silently never be picked up again. This
    # script already wipes the room's sensor_readings unconditionally on
    # every run (see below) -- clearing its thermal_anomaly history too
    # keeps that same "start fresh every run" behavior consistent.
    with engine.begin() as conn:
        anomaly_ids = [
            r[0]
            for r in conn.execute(
                text("SELECT id FROM anomalies WHERE room_id = :r AND anomaly_type = 'thermal_anomaly'"), {"r": room_id}
            ).all()
        ]
        if not anomaly_ids:
            return
        diagnosis_ids = [r[0] for r in conn.execute(text("SELECT id FROM diagnoses WHERE anomaly_id = ANY(:ids)"), {"ids": anomaly_ids}).all()]
        if diagnosis_ids:
            conn.execute(text("DELETE FROM alerts WHERE diagnosis_id = ANY(:ids)"), {"ids": diagnosis_ids})
            conn.execute(text("DELETE FROM diagnoses WHERE id = ANY(:ids)"), {"ids": diagnosis_ids})
        conn.execute(text("DELETE FROM anomalies WHERE id = ANY(:ids)"), {"ids": anomaly_ids})
    print(f"Cleared {len(anomaly_ids)} prior thermal_anomaly record(s) for {room_id} so this run starts fresh.")


def _seed_anomalous_history(engine, room_id: str, days: int = 7) -> None:
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

    # A window-left-open style ramp on the most recent readings -- large
    # enough, over enough consecutive samples, to clear anomaly.py's
    # "N consecutive residuals over threshold" gate rather than a one-off
    # blip. We deliberately run the fast loop with occupied=False (see
    # main()) so check_comfort_violation is skipped entirely and can't
    # short-circuit the pipeline before check_thermal_anomaly ever runs --
    # that let a fixed, generous ramp size work regardless of the room's
    # actual baseline temperature.
    active = fetch_active_rc_model_params(engine, room_id)
    threshold_c = active.anomaly_threshold_c if active is not None else 1.0
    step_increment_c = max(2.0, 2.5 * threshold_c)
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT ts, temp_measured_c FROM sensor_readings WHERE room_id = :r ORDER BY ts DESC LIMIT 5"),
            {"r": room_id},
        ).all()
        baseline_c = rows[0][1]
        max_total_c = max(step_increment_c, min(step_increment_c * 5, 44.0 - baseline_c))
        uncapped = [step_increment_c * (i + 1) for i in range(5)]
        scale = min(1.0, max_total_c / uncapped[-1])
        ramp = [round(o * scale, 2) for o in uncapped]
        for (ts, _temp), offset in zip(reversed(rows), ramp):
            conn.execute(
                text("UPDATE sensor_readings SET temp_measured_c = temp_measured_c + :o WHERE room_id = :r AND ts = :ts"),
                {"o": offset, "r": room_id, "ts": ts},
            )
    print(f"Seeded {days}d of sensor history for {room_id}; baseline {baseline_c:.2f}C, ramped the last 5 readings by up to {max(ramp):.2f}C (threshold={threshold_c:.2f}C)")


def _tail_alerts_log(since: datetime) -> list[dict]:
    if not ALERT_LOG_PATH.exists():
        return []
    entries = []
    for line in ALERT_LOG_PATH.read_text(encoding="utf-8").splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        sent_at = datetime.fromisoformat(record.get("sent_at", ""))
        if sent_at >= since:
            entries.append(record)
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--building-id", default="djezzy-hq")
    parser.add_argument("--room-id", default="djezzy-hq-floor-2-room-01")
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()

    engine = get_engine()
    run_started_at = datetime.now(timezone.utc)

    print(f"=== Simulating a thermal anomaly for {args.room_id} ===\n")

    print("--- Configured alert channels ---")
    configured = [c.name for c in channels.get_configured_channels()]
    print(f"  active: {configured}")
    if "email" not in configured:
        print("  NOTE: email channel is not active -- SUPERVISOR_ALERT_EMAIL_SMTP_HOST/USER/PASSWORD aren't all set in .env.")
    user_emails = fetch_org_user_emails(engine, args.building_id)
    org_email = fetch_org_alert_email(engine, args.building_id)
    resolved = ", ".join(user_emails) if user_emails else org_email
    print(f"  will resolve to: {resolved!r} ({'real account email(s)' if user_emails else 'organisation fallback' if org_email else 'no recipient configured'})\n")

    _reset_prior_anomalies(engine, args.room_id)

    print("--- Step 1: seeding anomalous sensor history ---")
    _seed_anomalous_history(engine, args.room_id, days=args.days)

    print("\n--- Step 2: running Agent 2 (thermal fast loop + anomaly pipeline) ---")
    now = datetime.now(timezone.utc)
    timestamps = [now + timedelta(seconds=900 * k) for k in range(96)]
    # occupied[0] deliberately forced False: check_comfort_violation only
    # runs when occupied, and it would otherwise short-circuit before
    # check_thermal_anomaly ever sees the injected ramp (see the comment in
    # _seed_anomalous_history). The rest of the horizon's occupancy doesn't
    # matter for this test -- we're not evaluating MPC schedule quality.
    occupied = np.array([8 <= t.hour < 16 for t in timestamps], dtype=bool)
    occupied[0] = False
    fast_loop_result = run_fast_loop_for_room(engine, args.room_id, occupied, now=now, offline=True)
    anomaly = fast_loop_result.anomaly
    if anomaly is None or anomaly.stage != "thermal_anomaly":
        print(f"  No thermal_anomaly raised this run (stage={anomaly.stage if anomaly else None}). Re-run the script -- ")
        print("  the injected deviation is randomized each time via the synthetic scenario seed.")
        return
    print(f"  Anomaly raised: id={anomaly.anomaly_id} detail={anomaly.detail}")

    print("\n--- Step 3: running Agent 3 (diagnosis) + Agent 4 (supervisor + alert dispatch) ---")
    results = run_diagnosis_cycle(engine, args.building_id)
    matching = [r for r in results if r.anomaly_id == anomaly.anomaly_id]
    if not matching:
        print("  Anomaly was not picked up by this diagnosis cycle (already diagnosed, or queued behind others).")
        return
    result = matching[0]
    print(f"  cause: {result.validated_output['cause']} (confidence: {result.validated_output['cause_confidence']})")
    print(f"  proposed action: {result.validated_output['proposed_action']}")
    print(f"  supervisor decision: {result.supervisor_decision.decision} -- {result.supervisor_decision.reason}")

    print("\n--- Step 4: alert dispatch outcome ---")
    if result.supervisor_decision.decision != "human_alert":
        print(f"  Decision was {result.supervisor_decision.decision!r}, not human_alert -- no email was sent this run.")
        print("  This is the real deterministic supervisor's call, not a bug -- re-run to get a different LLM diagnosis,")
        print("  or check src/agents/diagnostic_agent/constants.py's HUMAN_ALERT_ACTION_TYPES for what forces one.")
        return
    print(f"  human_alert reached -- dispatched to: {resolved!r}")
    entries = _tail_alerts_log(run_started_at)
    if entries:
        print(f"  Confirmed in {ALERT_LOG_PATH}: {len(entries)} alert(s) logged this run.")
    else:
        print(f"  WARNING: expected a new line in {ALERT_LOG_PATH} but found none -- dispatch may have failed silently.")
    if "email" in configured:
        print("  Email channel was active -- check the inbox above for the actual message.")
    else:
        print("  Email channel was NOT active, so only the log/webhook channels fired -- see the .env setup from before.")


if __name__ == "__main__":
    main()
