from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sqlalchemy import Engine

from agents.diagnostic_agent import diagnose as diagnostic_diagnose
from agents.thermal_agent import calibrate as thermal_calibrate
from agents.thermal_agent import handler as thermal_handler

from . import channels, constants, db

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OrchestrationCycleResult:
    building_id: str
    fast_loop_results: list[Any]
    diagnosis_results: list[diagnostic_diagnose.DiagnosisRunResult]
    calibration_results: list[Any] | None
    alerts_dispatched: list[dict[str, Any]]


def run_diagnosis_cycle(
    engine: Engine,
    building_id: str,
    alert_channels: list[channels.AlertChannel] | None = None,
) -> list[diagnostic_diagnose.DiagnosisRunResult]:
    anomaly_ids = db.fetch_undiagnosed_anomaly_ids(engine, building_id)
    results = []
    # Prefer real account emails (people who can actually log in and act on
    # this) over the organisation's generic contact address, which is only a
    # fallback for orgs that don't have a user account set up yet.
    user_emails = db.fetch_org_user_emails(engine, building_id)
    alert_email = ", ".join(user_emails) if user_emails else db.fetch_org_alert_email(engine, building_id)
    for anomaly_id in anomaly_ids:
        result = diagnostic_diagnose.diagnose_anomaly(engine, anomaly_id)
        results.append(result)
        if result.supervisor_decision.decision == "human_alert":
            channels.dispatch(
                {
                    "anomaly_id": result.anomaly_id,
                    "room_id": result.room_id,
                    "diagnosis_id": result.diagnosis_id,
                    "cause": result.validated_output["cause"],
                    "cause_confidence": result.validated_output["cause_confidence"],
                    "message": result.validated_output["message"],
                    "proposed_action": result.validated_output["proposed_action"],
                    "supervisor_reason": result.supervisor_decision.reason,
                    "alert_email": alert_email,
                },
                alert_channels,
            )
    return results


def run_calibration_cycle_if_due(engine: Engine, building_id: str, now: datetime | None = None, force_accept: bool = False) -> list[Any] | None:
    now = now or datetime.now(timezone.utc)
    last = db.fetch_last_calibration_time(engine, building_id)
    if last is not None and (now - last) < timedelta(hours=constants.CALIBRATION_INTERVAL_HOURS):
        return None
    return thermal_calibrate.run_calibration_sweep(engine, building_id, force_accept=force_accept)


def run_fast_loop_cycle(
    engine: Engine,
    building_id: str,
    occupied_by_room: dict[str, np.ndarray],
    now: datetime | None = None,
    offline: bool = False,
) -> list[Any]:
    return thermal_handler.run_fast_loop_for_building(engine, building_id, occupied_by_room, now=now, offline=offline)


def run_full_cycle(
    engine: Engine,
    building_id: str,
    occupied_by_room: dict[str, np.ndarray],
    now: datetime | None = None,
    offline: bool = False,
    force_calibration: bool = False,
    force_accept: bool = False,
    run_fast_loop: bool = True,
) -> OrchestrationCycleResult:
    now = now or datetime.now(timezone.utc)

    calibration_results = (
        thermal_calibrate.run_calibration_sweep(engine, building_id, force_accept=force_accept)
        if force_calibration
        else run_calibration_cycle_if_due(engine, building_id, now, force_accept=force_accept)
    )
    fast_loop_results = run_fast_loop_cycle(engine, building_id, occupied_by_room, now=now, offline=offline) if run_fast_loop else []
    diagnosis_results = run_diagnosis_cycle(engine, building_id)

    alerts_dispatched = [
        {"anomaly_id": r.anomaly_id, "decision": r.supervisor_decision.decision}
        for r in diagnosis_results
        if r.supervisor_decision.decision == "human_alert"
    ]

    logger.info(
        "full cycle building=%s calibration=%s fast_loop=%d diagnoses=%d alerts=%d",
        building_id,
        len(calibration_results) if calibration_results else "none",
        len(fast_loop_results),
        len(diagnosis_results),
        len(alerts_dispatched),
    )

    _record_cycle(engine, building_id, now, calibration_results, fast_loop_results, diagnosis_results, alerts_dispatched)

    return OrchestrationCycleResult(
        building_id=building_id,
        fast_loop_results=fast_loop_results,
        diagnosis_results=diagnosis_results,
        calibration_results=calibration_results,
        alerts_dispatched=alerts_dispatched,
    )


def _record_cycle(
    engine: Engine,
    building_id: str,
    now: datetime,
    calibration_results: list[Any] | None,
    fast_loop_results: list[Any],
    diagnosis_results: list[diagnostic_diagnose.DiagnosisRunResult],
    alerts_dispatched: list[dict[str, Any]],
) -> None:
    try:
        db.ensure_orchestration_runs_table(engine)
        db.insert_orchestration_run(
            engine,
            {
                "building_id": building_id,
                "ran_at": now,
                "calibration_count": len(calibration_results or []),
                "fast_loop_count": len(fast_loop_results),
                "diagnoses_count": len(diagnosis_results),
                "alerts_dispatched": alerts_dispatched,
                "fast_loop_detail": [
                    {
                        "room_id": r.room_id,
                        "ran_control": r.ran_control,
                        "reason": r.reason,
                        "mpc_status": r.mpc_status,
                        "comfort_violated": r.comfort_violated,
                        "anomaly_stage": r.anomaly.stage if r.anomaly else None,
                    }
                    for r in fast_loop_results
                ],
                "diagnosis_detail": [
                    {
                        "anomaly_id": d.anomaly_id,
                        "room_id": d.room_id,
                        "diagnosis_id": d.diagnosis_id,
                        "decision": d.supervisor_decision.decision,
                        "reason": d.supervisor_decision.reason,
                        "cause": d.validated_output["cause"],
                    }
                    for d in diagnosis_results
                ],
                "calibration_detail": [
                    {
                        "room_id": c.room_id if hasattr(c, "room_id") else None,
                        "accepted": c.accepted if hasattr(c, "accepted") else None,
                        "reason": c.reason if hasattr(c, "reason") else None,
                        "version": c.version if hasattr(c, "version") else None,
                    }
                    for c in (calibration_results or [])
                ],
            },
        )
    except Exception:
        logger.exception("Failed to record orchestration_run for building=%s", building_id)
