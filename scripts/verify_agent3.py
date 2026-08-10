"""End-to-end verification of Agent 3 (LangGraph diagnostic agent) against the
real Supabase DB and a real Groq API key.

Usage (from the repo root):

    $env:PYTHONPATH="src"; python scripts/verify_agent3.py --anomaly-id 6
    $env:PYTHONPATH="src"; python scripts/verify_agent3.py --anomaly-id 6 --reset

``--reset`` wipes prior diagnoses/alerts/audit rows for the anomaly and its
checkpoint thread before re-running, so the verification is reproducible.
Exits non-zero if any persistence check fails.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "src"))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

from sqlalchemy import Engine, text

from agents.diagnostic_agent import db, diagnose, graph


def _reset(engine: Engine, anomaly_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM audit_log WHERE anomaly_id = :a"), {"a": anomaly_id})
        conn.execute(
            text("DELETE FROM alerts WHERE diagnosis_id IN (SELECT id FROM diagnoses WHERE anomaly_id = :a)"),
            {"a": anomaly_id},
        )
        conn.execute(text("DELETE FROM diagnoses WHERE anomaly_id = :a"), {"a": anomaly_id})
        conn.execute(text("UPDATE anomalies SET diagnosed = false WHERE id = :a"), {"a": anomaly_id})
    _delete_checkpoint_thread(anomaly_id)
    print(f"reset: diagnoses/alerts/audit_log + checkpoints for anomaly {anomaly_id} wiped")


def _delete_checkpoint_thread(anomaly_id: int) -> None:
    """SqliteSaver.adelete_thread raises NotImplementedError in
    langgraph-checkpoint-sqlite, so delete the thread rows directly."""
    from agents.diagnostic_agent.checkpointer import get_default_checkpoint_path

    thread_id = graph.thread_config(anomaly_id)["configurable"]["thread_id"]
    path = get_default_checkpoint_path()
    if not path.exists():
        return
    conn = sqlite3.connect(path)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            if "thread_id" not in [c[1] for c in conn.execute(f"PRAGMA table_info({table})")]:
                continue
            conn.execute(f"DELETE FROM {table} WHERE thread_id = ?", (thread_id,))
        conn.commit()
    finally:
        conn.close()


def _print_report(result: diagnose.DiagnosisRunResult) -> None:
    print("\n=== run report ===")
    print("node_trace   :", " -> ".join(result.node_trace))
    print("nb tools     :", len(result.tool_calls_made))
    for call in result.tool_calls_made:
        print("  -", call["tool"], "| ok:", call["ok"], "|", call["result_summary"][:130])
    print("fallback     :", result.fallback_used)
    print("cause        :", result.validated_output["cause"])
    print("confidence   :", result.validated_output["cause_confidence"])
    print("proposed     :", result.validated_output["proposed_action"])
    print("energy       :", result.validated_output["energy_wasted_kwh"], "kWh |", result.validated_output["energy_wasted_basis"])
    print("decision     :", result.supervisor_decision.decision, "->", result.supervisor_decision.reason)
    print("diagnosis_id :", result.diagnosis_id, "| audit_log_id:", result.audit_log_id)


def _verify_persistence(engine: Engine, result: diagnose.DiagnosisRunResult) -> bool:
    ok = True

    with engine.connect() as conn:
        diagnosis = conn.execute(
            text("SELECT cause, cause_confidence, supervisor_decision FROM diagnoses WHERE id = :i"),
            {"i": result.diagnosis_id},
        ).first()
        audit = conn.execute(
            text("SELECT tool_calls, model_output, supervisor_decision FROM audit_log WHERE id = :i"),
            {"i": result.audit_log_id},
        ).first()
        anomaly = conn.execute(
            text("SELECT diagnosed FROM anomalies WHERE id = :a"),
            {"a": result.anomaly_id},
        ).first()

    print("\n=== persistence check ===")
    checks = {
        "diagnosis row": diagnosis is not None,
        "audit_log row": audit is not None,
        "anomaly marked diagnosed": bool(anomaly and anomaly.diagnosed),
    }
    if diagnosis is not None:
        checks["diagnosis.cause matches"] = diagnosis.cause == result.validated_output["cause"]
        checks["diagnosis.gate matches"] = diagnosis.supervisor_decision == result.supervisor_decision.decision
    if audit is not None:
        model_output = audit.model_output if isinstance(audit.model_output, dict) else json.loads(audit.model_output)
        trace = model_output.get("_trace", {})
        checks["audit.tool_calls recorded"] = bool(audit.tool_calls)
        checks["audit.node_trace recorded"] = bool(trace.get("node_trace"))
        checks["audit.timestamps recorded"] = bool(trace.get("timestamps"))

    for label, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {label}")
        ok = ok and passed
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="End-to-end verify Agent 3 diagnostic agent.")
    parser.add_argument("--anomaly-id", type=int, required=True, help="anomalies.id to diagnose")
    parser.add_argument("--reset", action="store_true", help="wipe prior diagnosis state before running")
    args = parser.parse_args(argv)

    api_key = os.getenv("DIAGNOSTIC_GROQ_API_KEY")
    if not api_key:
        print("FAIL: DIAGNOSTIC_GROQ_API_KEY is not set in .env")
        return 1

    engine = db.get_engine()
    anomaly = db.fetch_anomaly(engine, args.anomaly_id)
    if anomaly is None:
        print(f"FAIL: anomaly {args.anomaly_id} not found")
        return 1
    print(f"anomaly {anomaly.id}: room={anomaly.room_id} type={anomaly.anomaly_type} residual={anomaly.residual_c} C")

    if args.reset:
        _reset(engine, args.anomaly_id)

    result = diagnose.diagnose_anomaly(engine, args.anomaly_id, api_key=api_key)
    _print_report(result)
    ok = _verify_persistence(engine, result)

    print(f"\n{'ALL CHECKS PASSED' if ok else 'SOME CHECKS FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
