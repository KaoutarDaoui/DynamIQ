from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from agents.diagnostic_agent import constants, evidence

NOW = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)


class _Anomaly:
    def __init__(self, residual_c=3.0, threshold_c=1.5, anomaly_type="thermal_anomaly"):
        self.id = 7
        self.room_id = "room-101"
        self.anomaly_type = anomaly_type
        self.opened_at = NOW - timedelta(hours=2)
        self.closed_at = None
        self.residual_c = residual_c
        self.threshold_c = threshold_c


def _evidence(**overrides):
    base = {
        "room_id": "room-101",
        "anomaly_type": "thermal_anomaly",
        "residual_c": 3.0,
        "threshold_c": 1.5,
        "open_window_hours": 2.0,
        "readings_count": 8,
        "temps": [24.0, 25.0, 26.0, 27.0, 28.0, 29.0, 30.0, 31.0],
        "cooling_w": [-500.0, -500.0, -500.0, -500.0],
        "occupied": True,
        "hvac_running": True,
        "mpc_slots": [{"predicted_kwh": 0.5}, {"predicted_kwh": 0.5}, {"predicted_kwh": 0.5}, {"predicted_kwh": 0.5}],
        "model_rmse": 0.3,
        "model_threshold": 1.5,
        "prior_causes": [],
    }
    base.update(overrides)
    return base


class TestScoreCauseConfidence:
    def test_unknown_is_always_undetermined(self) -> None:
        assert evidence.score_cause_confidence("unknown", _evidence()) == "undetermined"

    def test_hvac_underperformance_with_strong_evidence_is_high(self) -> None:
        e = _evidence(hvac_running=True, cooling_w=[-500.0] * 4, temps=[24.0, 26.0, 28.0, 30.0], residual_c=3.0, model_rmse=0.3, prior_causes=["hvac_underperformance"])
        assert evidence.score_cause_confidence("hvac_underperformance", e) == "high"

    def test_hvac_underperformance_with_weak_evidence_is_medium_or_low(self) -> None:
        e = _evidence(hvac_running=True, temps=[24.0, 24.1, 24.2, 24.3], residual_c=0.4, model_rmse=0.3)
        assert evidence.score_cause_confidence("hvac_underperformance", e) in ("medium", "low", "undetermined")

    def test_no_corroborating_signals_is_undetermined(self) -> None:
        e = _evidence(hvac_running=False, cooling_w=[], occupied=False, temps=[24.0, 24.1], residual_c=0.2, readings_count=2)
        assert evidence.score_cause_confidence("hvac_underperformance", e) == "undetermined"

    def test_sensor_failure_with_no_readings_is_high(self) -> None:
        e = _evidence(readings_count=0, temps=[], hvac_running=False, cooling_w=[], residual_c=3.0, prior_causes=["sensor_failure"])
        assert evidence.score_cause_confidence("sensor_failure", e) == "high"

    def test_calibration_drift_with_unreliable_model_is_high(self) -> None:
        e = _evidence(model_rmse=5.0, model_threshold=1.5, temps=[24.0, 25.0, 26.0, 27.0], prior_causes=["calibration_drift"])
        assert evidence.score_cause_confidence("calibration_drift", e) == "high"

    def test_recurring_cause_boosts_confidence(self) -> None:
        e = _evidence(prior_causes=["hvac_underperformance"])
        assert evidence.score_cause_confidence("hvac_underperformance", e) == "high"


class TestComputeEnergyWasted:
    def test_energy_is_actual_minus_mpc_counterfactual(self) -> None:
        e = _evidence(cooling_w=[-1000.0] * 4, mpc_slots=[{"predicted_kwh": 0.5}] * 4)
        actual_kwh = 4 * 1000.0 / 1000.0  # 4 kWh
        expected_kwh = 4 * 0.5  # 2 kWh
        kwh, basis = evidence.compute_energy_wasted(e)
        assert kwh == pytest.approx(actual_kwh - expected_kwh)
        assert basis == "mpc_counterfactual"

    def test_energy_clamped_at_zero(self) -> None:
        e = _evidence(cooling_w=[-100.0], mpc_slots=[{"predicted_kwh": 5.0}])
        kwh, basis = evidence.compute_energy_wasted(e)
        assert kwh == 0.0
        assert basis == "mpc_counterfactual"

    def test_no_sensor_data_returns_none(self) -> None:
        kwh, basis = evidence.compute_energy_wasted(_evidence(readings_count=0))
        assert kwh is None
        assert basis == "no_sensor_data"

    def test_no_mpc_slots_returns_none_honest_basis(self) -> None:
        kwh, basis = evidence.compute_energy_wasted(_evidence(mpc_slots=[]))
        assert kwh is None
        assert basis == "no_mpc_counterfactual"


class TestProposedActionForCause:
    def test_exclusive_mapping(self) -> None:
        assert evidence.proposed_action_for_cause("sensor_failure")["type"] == "inspection_required"
        assert evidence.proposed_action_for_cause("hvac_underperformance")["type"] == "setpoint_change"
        assert evidence.proposed_action_for_cause("window_open_occupancy_gain")["type"] == "setpoint_change"
        assert evidence.proposed_action_for_cause("unmodelled_internal_gain")["type"] == "inspection_required"
        assert evidence.proposed_action_for_cause("calibration_drift")["type"] == "schedule_correction"
        assert evidence.proposed_action_for_cause("scheduling_error")["type"] == "schedule_correction"
        assert evidence.proposed_action_for_cause("unknown")["type"] == "inspection_required"


class TestComputeDeltaC:
    def test_delta_c_bounded_by_comfort_band(self) -> None:
        e = _evidence(residual_c=5.0)
        delta = evidence.compute_delta_c("hvac_underperformance", e)
        assert delta is not None
        assert abs(delta) <= constants.DEFAULT_COMFORT_BOUNDS_DELTA_C

    def test_delta_c_none_for_inspection_causes(self) -> None:
        assert evidence.compute_delta_c("sensor_failure", _evidence(residual_c=3.0)) is None

    def test_delta_c_scales_with_residual(self) -> None:
        small = evidence.compute_delta_c("hvac_underperformance", _evidence(residual_c=1.0))
        large = evidence.compute_delta_c("hvac_underperformance", _evidence(residual_c=4.0))
        assert small == 1.0
        assert large == constants.DEFAULT_COMFORT_BOUNDS_DELTA_C


class TestFinalizeDiagnosis:
    def test_finalize_overwrites_llm_guesses(self, monkeypatch) -> None:
        validated = {
            "cause": "hvac_underperformance",
            "cause_confidence": "high",
            "energy_wasted_kwh": 99.0,
            "energy_wasted_basis": "llm_guess",
            "proposed_action": {"type": "lockout", "delta_c": -9.0},
            "message": "The AC struggled all afternoon.",
        }
        anomaly = _Anomaly(residual_c=3.0)
        monkeypatch.setattr(evidence, "gather_evidence", lambda engine, a: _evidence(prior_causes=["hvac_underperformance"]))
        out = evidence.finalize_diagnosis(object(), anomaly, validated)

        assert out["cause"] == "hvac_underperformance"
        assert out["cause_confidence"] == "high"
        assert out["energy_wasted_basis"] == "mpc_counterfactual"
        assert out["proposed_action"]["type"] == "setpoint_change"
        assert abs(out["proposed_action"]["delta_c"]) <= constants.DEFAULT_COMFORT_BOUNDS_DELTA_C
        assert "confidence_signals" in out

    def test_finalize_undetermined_confidence_forces_inspection(self, monkeypatch) -> None:
        validated = {"cause": "hvac_underperformance", "cause_confidence": "high", "message": "x"}
        anomaly = _Anomaly(residual_c=0.0)
        monkeypatch.setattr(evidence, "gather_evidence", lambda engine, a: _evidence(hvac_running=False, cooling_w=[], temps=[], residual_c=0.0, readings_count=0))
        out = evidence.finalize_diagnosis(object(), anomaly, validated)

        assert out["cause_confidence"] == "undetermined"
        assert out["proposed_action"]["type"] == "inspection_required"
        assert out["proposed_action"].get("delta_c") is None

    def test_finalize_preserves_message_and_anomaly_identity(self, monkeypatch) -> None:
        validated = {"cause": "unknown", "cause_confidence": "undetermined", "message": "unclear"}
        anomaly = _Anomaly(residual_c=3.0)
        monkeypatch.setattr(evidence, "gather_evidence", lambda engine, a: _evidence())
        out = evidence.finalize_diagnosis(object(), anomaly, validated)
        assert out["message"] == "unclear"
        assert out["proposed_action"]["type"] == "inspection_required"
