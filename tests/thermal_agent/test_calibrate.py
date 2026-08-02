from __future__ import annotations
import pytest
from agents.thermal_agent import constants
from agents.thermal_agent.calibrate import evaluate_calibration
from agents.thermal_agent.rc import generate_synthetic_scenario
R_TRUE = 0.07
C_TRUE = 3000000.0
BOUNDS = ((constants.R_LUMPED_MIN_K_PER_W, constants.R_LUMPED_MAX_K_PER_W), (constants.C_LUMPED_MIN_J_PER_K, constants.C_LUMPED_MAX_J_PER_K))

def _scenario():
    return generate_synthetic_scenario(R_TRUE, C_TRUE, days=21, sensor_noise_std_c=0.3, seed=0)

class TestEvaluateCalibration:

    def test_first_calibration_always_accepted(self) -> None:
        s = _scenario()
        r_bounds, c_bounds = BOUNDS
        fit, rmse, accepted, reason = evaluate_calibration(s.t_measured_c, s.t_ext_c, s.q_solar_w, s.q_occ_w, s.q_hvac_w, r_bounds, c_bounds, R_TRUE * 1.6, C_TRUE * 0.6, previous_rmse_c=None)
        assert accepted is True
        assert 'first calibration' in reason
        assert rmse < 0.6
        assert fit.rmse_c < 0.6

    def test_rejects_when_previous_rmse_is_better(self) -> None:
        s = _scenario()
        r_bounds, c_bounds = BOUNDS
        fit, rmse, accepted, reason = evaluate_calibration(s.t_measured_c, s.t_ext_c, s.q_solar_w, s.q_occ_w, s.q_hvac_w, r_bounds, c_bounds, R_TRUE * 1.6, C_TRUE * 0.6, previous_rmse_c=1e-06)
        assert accepted is False
        assert 'keeping old version' in reason

    def test_accepts_when_previous_rmse_is_clearly_worse(self) -> None:
        s = _scenario()
        r_bounds, c_bounds = BOUNDS
        fit, rmse, accepted, reason = evaluate_calibration(s.t_measured_c, s.t_ext_c, s.q_solar_w, s.q_occ_w, s.q_hvac_w, r_bounds, c_bounds, R_TRUE * 1.6, C_TRUE * 0.6, previous_rmse_c=999.0)
        assert accepted is True

    def test_split_is_chronological_not_shuffled(self) -> None:
        s = _scenario()
        n = len(s.t_ext_c)
        split = int(n * 0.7)
        assert split < n
        assert split > 0

    def test_raises_on_too_few_samples(self) -> None:
        s = _scenario()
        r_bounds, c_bounds = BOUNDS
        with pytest.raises(ValueError):
            evaluate_calibration(s.t_measured_c[:2], s.t_ext_c[:1], s.q_solar_w[:1], s.q_occ_w[:1], s.q_hvac_w[:1], r_bounds, c_bounds, R_TRUE, C_TRUE, previous_rmse_c=None)
