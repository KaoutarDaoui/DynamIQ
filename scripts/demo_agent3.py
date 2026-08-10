"""Live demo of Agent 3 (LangGraph diagnostic) for a supervisor/jury.

Streams the LangGraph investigation node-by-node against the real Supabase DB
and a real Groq key, prints the deterministic gate decision, and verifies the
persistence in Supabase.

Usage (from the repo root):

    $env:PYTHONPATH="src"; python scripts/demo_agent3.py --anomaly-id 6
    $env:PYTHONPATH="src"; python scripts/demo_agent3.py --anomaly-id 6 --reset
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "src"))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

from sqlalchemy import Engine, text

from agents.diagnostic_agent import constants, db, graph, supervisor, tools
from agents.diagnostic_agent.checkpointer import get_checkpointer, get_default_checkpoint_path


def _delete_checkpoint_thread(anomaly_id: int) -> None:
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
    print(f"reset: diagnoses/alerts/audit_log + checkpoints for anomaly {anomaly_id} wiped\n")


def _show_step(step: dict[str, dict]) -> None:
    for node, update in step.items():
        print(f"  > {node}")
        if node == "build_contract":
            c = update.get("contract", {})
            print(
                f"  | contrat : anomaly_type={c.get('anomaly_type')} ({c.get('type')}) | "
                f"residu {c.get('residual_c')} C / seuil {c.get('threshold_c')} C | "
                f"duree {c.get('duration_hours'):.2f} h | hvac_running={c.get('hvac_running')}"
            )
            print(f"  | budget : {update.get('budget_remaining')} appels d'outil")
        elif node == "llm_reason":
            raw = update.get("llm_raw_output") or ""
            print(f"  | sortie LLM : {raw[:240]}{'...' if len(raw) > 240 else ''}")
        elif node == "tool_executor":
            calls = update.get("tool_calls_made") or []
            last = calls[-1] if calls else {}
            print(f"  | outil : {last.get('tool')} | ok={last.get('ok')} | budget restant : {update.get('budget_remaining')}")
            print(f"  | resultat : {last.get('result_summary')}")
        elif node == "validate_output":
            vo = update.get("validated_output")
            if vo:
                print(f"  | VERDICT VALIDE (Pydantic DiagnosisContract) : cause={vo.get('cause')} | "
                      f"confiance={vo.get('cause_confidence')} | action={vo.get('proposed_action', {}).get('type')}")
            else:
                print(f"  | validation echouee : {update.get('validation_errors')}")
        elif node == "json_repair":
            print(f"  | tentative de reparation JSON #{update.get('repair_attempts')}")
        elif node == "fallback_node":
            print("  | fallback declenche (budget epuise / LLM hors-piste)")


def _run_stream(engine: Engine, anomaly_id: int, api_key: str, now: datetime) -> dict:
    compiled = graph.build_graph(engine, api_key, now=now, checkpointer=get_checkpointer())
    config = graph.thread_config(anomaly_id)
    resume = bool(compiled.get_state(config).next)

    print("=== Execution LangGraph (en direct, un noeud a la fois) ===")
    if resume:
        print("  (reprise depuis le checkpoint sauvegarde)\n")
        steps = compiled.stream(None, config=config, stream_mode="updates")
    else:
        steps = compiled.stream({"anomaly_id": anomaly_id}, config=config, stream_mode="updates")
    for step in steps:
        _show_step(step)
    return compiled.get_state(config).values


def _gate_and_persist(engine: Engine, anomaly_id: int, now: datetime, final: dict) -> None:
    validated = final["validated_output"]
    room_id = final["room_id"]
    tool_calls_made = final.get("tool_calls_made") or []
    node_trace = final.get("node_trace") or []
    timestamps = final.get("timestamps") or {}
    fallback_used = bool(final.get("fallback_used"))

    building_ctx = tools.get_building_context(engine, room_id).get("data")
    comfort = supervisor.get_comfort_bounds_delta_c(building_ctx)
    recent = db.fetch_recent_diagnoses_for_cooldown(engine, room_id, validated["cause"], constants.COOLDOWN_DAYS)
    decision = supervisor.decide(validated, comfort, recent, now)

    print("=== GATE deterministe (le LLM ne decide JAMAIS seul) ===")
    print(f"  verdict LLM        : cause={validated['cause']} | conf={validated['cause_confidence']} | "
          f"action={validated['proposed_action'].get('type')} delta_c={validated['proposed_action'].get('delta_c')}")
    print(f"  bornes confort     : +/-{comfort} C")
    print(f"  cooldown 30 jours  : {len(recent)} diagnostic(s) meme cause recents")
    print("  " + "-" * 52)
    print(f"  DECISION DU GATE   : {decision.decision.upper()}")
    print(f"  raison             : {decision.reason}")

    diagnosis_id = db.insert_diagnosis(
        engine,
        {
            "anomaly_id": anomaly_id,
            "room_id": room_id,
            "cause": validated["cause"],
            "cause_confidence": validated["cause_confidence"],
            "evidence": validated["evidence"],
            "energy_wasted_kwh": validated["energy_wasted_kwh"],
            "energy_wasted_basis": validated["energy_wasted_basis"],
            "proposed_action": validated["proposed_action"],
            "recurrence": validated["recurrence"],
            "message": validated["message"],
            "supervisor_decision": decision.decision,
        },
    )
    db.mark_anomaly_diagnosed(engine, anomaly_id)
    if decision.decision == "human_alert":
        db.insert_alert(engine, diagnosis_id, room_id, channel="log", recipient="facility_manager", payload=validated)
    audit_log_id = db.insert_audit_log(
        engine,
        {
            "anomaly_id": anomaly_id,
            "room_id": room_id,
            "invoked_at": now,
            "tool_calls": tool_calls_made,
            "model_output": {**validated, "_trace": {"node_trace": node_trace, "timestamps": timestamps, "fallback_used": fallback_used}},
            "supervisor_decision": {"decision": decision.decision, "reason": decision.reason},
            "diagnosis_id": diagnosis_id,
        },
    )
    _verify_persistence(engine, anomaly_id, diagnosis_id, audit_log_id, validated, node_trace, tool_calls_made)


def _verify_persistence(engine: Engine, anomaly_id: int, diagnosis_id: int, audit_log_id: int,
                        validated: dict, node_trace: list[str], tool_calls_made: list[dict]) -> None:
    with engine.connect() as conn:
        diagnosis = conn.execute(
            text("SELECT cause, cause_confidence, supervisor_decision FROM diagnoses WHERE id = :i"),
            {"i": diagnosis_id},
        ).first()
        audit = conn.execute(
            text("SELECT tool_calls, model_output, supervisor_decision FROM audit_log WHERE id = :i"),
            {"i": audit_log_id},
        ).first()
        anomaly = conn.execute(
            text("SELECT diagnosed FROM anomalies WHERE id = :a"),
            {"a": anomaly_id},
        ).first()

    print("\n=== Persistance verifiee dans Supabase ===")
    checks = {
        "diagnoses row (cause/conf/gate)": bool(diagnosis) and diagnosis.cause == validated["cause"],
        "audit_log row": bool(audit),
        "audit_log.node_trace (tracabilite)": bool(audit and node_trace),
        "audit_log.tool_calls": bool(audit and tool_calls_made),
        "anomaly marquee diagnosed": bool(anomaly and anomaly.diagnosed),
    }
    for label, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {label}")
    print(f"\n  node_trace : {' -> '.join(node_trace)}")
    print(f"  outils     : {[t.get('tool') for t in tool_calls_made]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Live demo of Agent 3 (LangGraph diagnostic).")
    parser.add_argument("--anomaly-id", type=int, default=6, help="anomalies.id to diagnose (default 6)")
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
    print(f"Anomalie {anomaly.id} : room={anomaly.room_id} | type={anomaly.anomaly_type} | "
          f"residu={anomaly.residual_c} C | ouverte le {anomaly.opened_at}\n")

    if args.reset:
        _reset(engine, args.anomaly_id)

    now = datetime.now(timezone.utc)
    final = _run_stream(engine, args.anomaly_id, api_key, now)
    _gate_and_persist(engine, args.anomaly_id, now, final)
    print("\nDemo terminee : enchainement investigation -> gate -> persistance OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
