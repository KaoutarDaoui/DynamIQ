from __future__ import annotations

"""Deterministic verification of Agent 3 cause->action->gate mapping.

For each expected cause, feeds the real (perturbed) evidence through the
deterministic evidence layer + supervisor and asserts the expected
confidence / action type / gate decision. This is the stable contract --
independent of the LLM's free-form cause pick.

Usage:
    python dev/verify_cause_paths.py
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.thermal_agent.db import get_engine
from agents.diagnostic_agent import constants, db as ddb, evidence, supervisor

ROOM = "djezzy-hq-floor-1-room-01"

# expected cause -> (action_type, gate, min_confidence)
EXPECTATIONS: dict[str, tuple[str, str, str]] = {
    "sensor_failure": ("inspection_required", "human_alert", "low"),
    "hvac_underperformance": ("setpoint_change", "autonomous", "low"),
    "window_open_occupancy_gain": ("setpoint_change", "autonomous", "low"),
    "unmodelled_internal_gain": ("inspection_required", "human_alert", "low"),
    "calibration_drift": ("schedule_correction", "autonomous", "low"),
    "scheduling_error": ("schedule_correction", "autonomous", "low"),
    "unknown": ("inspection_required", "human_alert", "undetermined"),
}


def main() -> None:
    anomaly_id = int(sys.argv[1]) if len(sys.argv) > 1 else None
    expected_cause = sys.argv[2] if len(sys.argv) > 2 else None
    engine = get_engine()

    anomalies = []
    if anomaly_id is not None:
        a = ddb.fetch_anomaly(engine, anomaly_id)
        if a is None:
            raise SystemExit(f"anomaly {anomaly_id} not found")
        anomalies = [a]
    else:
        from sqlalchemy import text
        with engine.connect() as c:
            ids = [r[0] for r in c.execute(text("SELECT id FROM anomalies WHERE room_id = :r ORDER BY id"), {"r": ROOM}).fetchall()]
        for i in ids:
            a = ddb.fetch_anomaly(engine, i)
            if a is not None:
                anomalies.append(a)

    results = []
    for anomaly in anomalies:
        ev = evidence.gather_evidence(engine, anomaly)
        # use the expected cause when provided (deterministic contract check);
        # otherwise take the strongest non-undetermined cause as the default
        if expected_cause is not None:
            cause = expected_cause
        else:
            scored = {c: evidence.score_cause_confidence(c, ev) for c in constants.VALID_CAUSES}
            cause = max(scored, key=lambda c: (scored[c] != "undetermined", scored[c]))
        validated = {
            "cause": cause,
            "evidence": evidence._corroborating_signals(cause, ev),
            "message": "deterministic check",
            "cause_confidence": "low",
        }
        out = evidence.finalize_diagnosis(engine, anomaly, validated)
        bounds = supervisor.get_comfort_bounds_delta_c({"config_json": {"diagnostic": {"comfort_bounds_delta_c": 2.0}}})
        decision = supervisor.decide(out, bounds, [], datetime.now(timezone.utc))
        action_type = out["proposed_action"]["type"]
        results.append(
            {
                "anomaly_id": anomaly.id,
                "cause": cause,
                "confidence": out["cause_confidence"],
                "signals": out["confidence_signals"],
                "action": action_type,
                "decision": decision.decision,
            }
        )

    print(f"{'anom':>4} {'cause':<28} {'conf':<12} {'action':<22} {'gate':<11}")
    print("-" * 80)
    ok = 0
    for r in results:
        cause = r["cause"]
        exp_action, exp_gate, min_conf = EXPECTATIONS.get(cause, (None, None, None))
        match_action = (exp_action is None) or (r["action"] == exp_action)
        match_gate = (exp_gate is None) or (r["decision"] == exp_gate)
        conf_ok = r["confidence"] != "undetermined" or min_conf == "undetermined"
        mark = "OK" if (match_action and match_gate and conf_ok) else "MISMATCH"
        if mark == "OK":
            ok += 1
        print(
            f"{r['anomaly_id']:>4} {cause:<28} {r['confidence']:<12} {r['action']:<22} {r['decision']:<11} {mark}"
        )
        if r["signals"]:
            print(f"      signals: {', '.join(r['signals'])}")
    print("-" * 80)
    print(f"{ok}/{len(results)} anomalies matched the deterministic cause->action->gate contract")


if __name__ == "__main__":
    main()