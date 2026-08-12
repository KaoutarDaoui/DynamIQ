"""Deterministic evidence layer for Agent 3.

The LLM decides *what* the problem is (a cause from the taxonomy) and explains
itself. Everything that can be calculated from real data is calculated here:

- cause_confidence    -- evidence-weighted, from corroborating signals
- energy_wasted_kwh   -- actual HVAC consumption minus MPC counterfactual
- proposed_action     -- exclusive cause -> action map
- delta_c             -- bounded setpoint correction derived from the residual

Nothing in this module calls an LLM. Every value is reproducible.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Engine

from . import constants, db


def gather_evidence(engine: Engine, anomaly: Any) -> dict[str, Any]:
    """Fetch the real, window-bounded evidence for the anomaly."""
    room_id = anomaly.room_id
    end = anomaly.closed_at or datetime.now(timezone.utc)
    start = anomaly.opened_at
    readings = db.fetch_sensor_readings_between(engine, room_id, start, end)
    mpc_slots = db.fetch_mpc_slots_between(engine, room_id, start, end)
    context = db.fetch_building_context(engine, room_id)
    similar = db.fetch_similar_anomalies(engine, room_id, constants.SIMILAR_ANOMALIES_DEFAULT_DAYS, exclude_anomaly_id=anomaly.id)

    active_model = (context or {}).get("active_model") or {}
    rmse = active_model.get("rmse_validation")

    temps = [r["temp_measured_c"] for r in readings if r["temp_measured_c"] is not None]
    cooling_w = [r["q_hvac_w"] for r in readings if r["q_hvac_w"] is not None and r["q_hvac_w"] < constants.HVAC_COOLING_POWER_W]
    occupied = any(r["q_occ_w"] is not None and r["q_occ_w"] > 0 for r in readings)
    prior_causes = [s.get("cause") for s in similar if s.get("cause")]

    return {
        "room_id": room_id,
        "anomaly_type": getattr(anomaly, "anomaly_type", None),
        "residual_c": anomaly.residual_c,
        "threshold_c": anomaly.threshold_c,
        "open_window_hours": (end - start).total_seconds() / 3600.0 if end and start else 0.0,
        "readings_count": len(readings),
        "temps": temps,
        "cooling_w": cooling_w,
        "occupied": occupied,
        "hvac_running": len(cooling_w) > 0,
        "mpc_slots": mpc_slots,
        "model_rmse": rmse,
        "model_threshold": active_model.get("anomaly_threshold_c"),
        "prior_causes": prior_causes,
    }


def _residual(evidence: dict[str, Any]) -> float:
    residual = evidence.get("residual_c")
    return float(residual) if isinstance(residual, (int, float)) else 0.0


def _model_unreliable(evidence: dict[str, Any]) -> bool:
    rmse = evidence.get("model_rmse")
    threshold = evidence.get("model_threshold")
    if rmse is None:
        return False
    return rmse > (threshold if threshold else 2.0)


def _recurring(evidence: dict[str, Any], cause: str) -> bool:
    return cause in evidence.get("prior_causes", [])


def _temperature_trend(evidence: dict[str, Any]) -> str:
    temps = evidence.get("temps") or []
    if len(temps) < 2:
        return "unknown"
    first, last = temps[0], temps[-1]
    if last > first + 0.3:
        return "rising"
    if first > last + 0.3:
        return "falling"
    return "stable"


def _corroborating_signals(cause: str, evidence: dict[str, Any]) -> list[str]:
    """Return the names of the signals that support ``cause`` for this evidence."""
    residual = _residual(evidence)
    overheating = residual > 0.0
    overcooling = residual < 0.0
    hvac = evidence.get("hvac_running", False)
    occupied = evidence.get("occupied", False)
    unreliable = _model_unreliable(evidence)
    trend = _temperature_trend(evidence)
    sparse = evidence.get("readings_count", 0) == 0
    recurring = _recurring(evidence, cause)

    signals: list[str] = []
    if cause == "sensor_failure":
        if sparse:
            signals.append("no_readings")
        if not hvac and (overheating or overcooling):
            signals.append("no_hvac_response")
        if trend == "stable":
            signals.append("flat_temperature")
        if _recurring(evidence, cause):
            signals.append("recurring")
    elif cause == "hvac_underperformance":
        if hvac and overheating:
            signals.append("cooling_failed")
        if hvac and trend == "rising":
            signals.append("temperature_rising_despite_cooling")
        if recurring:
            signals.append("recurring")
    elif cause == "window_open_occupancy_gain":
        if occupied and overheating:
            signals.append("occupied_overheating")
        if hvac:
            signals.append("hvac_compensating")
        if _recurring(evidence, cause):
            signals.append("recurring")
    elif cause == "unmodelled_internal_gain":
        if overheating:
            signals.append("overheating")
        if occupied:
            signals.append("occupied")
        if _recurring(evidence, cause):
            signals.append("recurring")
    elif cause == "calibration_drift":
        if unreliable:
            signals.append("model_unreliable")
        if trend == "rising" or trend == "falling":
            signals.append("consistent_bias")
        if _recurring(evidence, cause):
            signals.append("recurring")
    elif cause == "scheduling_error":
        if not occupied and overcooling:
            signals.append("cooling_empty_room")
        if not hvac and overheating and occupied:
            signals.append("no_cooling_when_occupied")
        if _recurring(evidence, cause):
            signals.append("recurring")
    return signals


def score_cause_confidence(cause: str, evidence: dict[str, Any]) -> str:
    """Map corroborating-signal count to a confidence level.

    ``unknown`` and 0 corroborating signals -> undetermined. Thresholds come
    from constants.CONFIDENCE_*_AT.
    """
    if cause == "unknown":
        return "undetermined"
    count = len(_corroborating_signals(cause, evidence))
    if count >= constants.CONFIDENCE_HIGH_AT:
        return "high"
    if count >= constants.CONFIDENCE_MEDIUM_AT:
        return "medium"
    if count >= constants.CONFIDENCE_LOW_AT:
        return "low"
    return "undetermined"


def compute_energy_wasted(evidence: dict[str, Any]) -> tuple[float | None, str]:
    """Actual cooling consumption minus the MPC counterfactual, in kWh.

    Returns (None, "no_sensor_data" | "no_mpc_counterfactual") when the real
    basis is missing -- we never fabricate a number.
    """
    readings = evidence.get("readings_count", 0)
    if readings == 0:
        return None, "no_sensor_data"
    mpc_slots = evidence.get("mpc_slots") or []
    if not mpc_slots:
        return None, "no_mpc_counterfactual"
    actual_kwh = sum(abs(w) / 1000.0 for w in evidence.get("cooling_w", []))
    expected_kwh = sum(s["predicted_kwh"] for s in mpc_slots if s.get("predicted_kwh") is not None)
    return max(0.0, actual_kwh - expected_kwh), "mpc_counterfactual"


def proposed_action_for_cause(cause: str) -> dict[str, Any]:
    """The exclusive action family for a cause."""
    action_type = constants.CAUSE_TO_ACTION.get(cause, "inspection_required")
    return {"type": action_type}


def compute_delta_c(cause: str, evidence: dict[str, Any]) -> float | None:
    """Bounded setpoint correction from the residual.

    Only meaningful for setpoint_change causes; clamped to the comfort band so
    an oversized correction would trip the human_alert at the gate.
    """
    if constants.CAUSE_TO_ACTION.get(cause) != "setpoint_change":
        return None
    residual = _residual(evidence)
    if residual == 0.0:
        return 0.0
    bound = constants.DEFAULT_COMFORT_BOUNDS_DELTA_C
    clamped = max(-bound, min(bound, residual * constants.DELTA_C_GAIN))
    return round(clamped, 2)


def finalize_diagnosis(engine: Engine, anomaly: Any, validated: dict[str, Any]) -> dict[str, Any]:
    """Combine the LLM's cause/message with Python-computed facts.

    Overwrites the LLM-guessed confidence, energy and action with deterministic
    values, and hard-enforces: undetermined confidence -> inspection_required.
    """
    cause = validated["cause"]
    evidence = gather_evidence(engine, anomaly)

    confidence = score_cause_confidence(cause, evidence)
    energy_wasted, basis = compute_energy_wasted(evidence)
    action = proposed_action_for_cause(cause)
    delta_c = compute_delta_c(cause, evidence)

    if confidence == "undetermined":
        action = {"type": "inspection_required"}
        delta_c = None

    if action["type"] == "setpoint_change" and delta_c is not None:
        action = {**action, "delta_c": delta_c}

    return {
        **validated,
        "cause_confidence": confidence,
        "energy_wasted_kwh": energy_wasted if energy_wasted is not None else 0.0,
        "energy_wasted_basis": basis,
        "proposed_action": action,
        "confidence_signals": _corroborating_signals(cause, evidence),
    }
