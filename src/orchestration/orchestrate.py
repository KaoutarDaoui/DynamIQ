from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sqlalchemy import Engine

from agents.diagnostic_agent import diagnose as diagnostic_diagnose
from agents.thermal_agent import calibrate as thermal_calibrate
from agents.thermal_agent import handler as thermal_handler

from . import channels, constants, db


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
                },
                alert_channels,
            )
    return results


def run_calibration_cycle_if_due(engine: Engine, building_id: str, now: datetime | None = None) -> list[Any] | None:
    now = now or datetime.now(timezone.utc)
    last = db.fetch_last_calibration_time(engine, building_id)
    if last is not None and (now - last) < timedelta(hours=constants.CALIBRATION_INTERVAL_HOURS):
        return None
    return thermal_calibrate.run_calibration_sweep(engine, building_id)


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
) -> OrchestrationCycleResult:
    now = now or datetime.now(timezone.utc)

    calibration_results = (
        thermal_calibrate.run_calibration_sweep(engine, building_id)
        if force_calibration
        else run_calibration_cycle_if_due(engine, building_id, now)
    )
    fast_loop_results = run_fast_loop_cycle(engine, building_id, occupied_by_room, now=now, offline=offline)
    diagnosis_results = run_diagnosis_cycle(engine, building_id)

    return OrchestrationCycleResult(
        building_id=building_id,
        fast_loop_results=fast_loop_results,
        diagnosis_results=diagnosis_results,
        calibration_results=calibration_results,
        alerts_dispatched=[
            {"anomaly_id": r.anomaly_id, "decision": r.supervisor_decision.decision}
            for r in diagnosis_results
            if r.supervisor_decision.decision == "human_alert"
        ],
    )
