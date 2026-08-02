from __future__ import annotations
import numpy as np
import pytest
from agents.thermal_agent import constants
from agents.thermal_agent.rc import discretization_factor, fit_rc, generate_synthetic_scenario, simulate, step
R_TRUE = 0.07
C_TRUE = 3000000.0
FITTING_HORIZON_STEPS = constants.CALIBRATION_FIT_HORIZON_STEPS

class TestStep:

    def test_matches_hand_calc(self) -> None:
        r, c, dt = (2.0, 1000.0, 900.0)
        a = np.exp(-dt / (r * c))
        expected = a * 20.0 + (1.0 - a) * (10.0 + r * (5.0 + 3.0 + -2.0))
        assert step(20.0, 10.0, 5.0, 3.0, -2.0, r, c, dt) == pytest.approx(expected)

    def test_decay_factor_in_unit_interval(self) -> None:
        a = discretization_factor(R_TRUE, C_TRUE)
        assert 0.0 < a < 1.0

class TestSimulate:

    def test_zero_exogenous_and_matched_t_ext_holds_constant(self) -> None:
        n = 10
        t_ext = np.full(n, 21.0)
        zeros = np.zeros(n)
        traj = simulate(21.0, t_ext, zeros, zeros, zeros, R_TRUE, C_TRUE)
        assert traj == pytest.approx(np.full(n + 1, 21.0))

    def test_positive_gradient_warms_monotonically_toward_t_ext(self) -> None:
        n = 50
        t_ext = np.full(n, 35.0)
        zeros = np.zeros(n)
        traj = simulate(20.0, t_ext, zeros, zeros, zeros, R_TRUE, C_TRUE)
        assert np.all(np.diff(traj) > 0)
        assert traj[-1] < 35.0
        assert traj[-1] > traj[0]

    def test_length_matches_input_plus_one(self) -> None:
        n = 7
        zeros = np.zeros(n)
        traj = simulate(20.0, zeros, zeros, zeros, zeros, R_TRUE, C_TRUE)
        assert len(traj) == n + 1

    def test_mismatched_lengths_raise(self) -> None:
        with pytest.raises(ValueError):
            simulate(20.0, np.zeros(5), np.zeros(4), np.zeros(5), np.zeros(5), R_TRUE, C_TRUE)

class TestFitRcAtZeroNoiseProvesTheMachineryIsCorrect:

    @pytest.mark.parametrize('horizon_steps', [1, FITTING_HORIZON_STEPS])
    def test_exact_recovery_with_no_sensor_noise(self, horizon_steps: int) -> None:
        scenario = generate_synthetic_scenario(R_TRUE, C_TRUE, days=21, sensor_noise_std_c=0.0, seed=0)
        fit = fit_rc(t_measured_c=scenario.t_measured_c, t_ext_c=scenario.t_ext_c, q_solar_w=scenario.q_solar_w, q_occ_w=scenario.q_occ_w, q_hvac_w=scenario.q_hvac_w, r_bounds=(constants.R_LUMPED_MIN_K_PER_W, constants.R_LUMPED_MAX_K_PER_W), c_bounds=(constants.C_LUMPED_MIN_J_PER_K, constants.C_LUMPED_MAX_J_PER_K), r_initial_guess=R_TRUE * 1.6, c_initial_guess=C_TRUE * 0.6, horizon_steps=horizon_steps)
        assert fit.r_k_per_w == pytest.approx(R_TRUE, rel=0.001)
        assert fit.c_j_per_k == pytest.approx(C_TRUE, rel=0.001)

class TestLiteralOneStepAheadIsIllConditionedAtRealisticNoise:

    def test_one_step_horizon_fails_r_recovery_at_spec_noise(self) -> None:
        scenario = generate_synthetic_scenario(R_TRUE, C_TRUE, days=21, sensor_noise_std_c=0.3, seed=0)
        fit = fit_rc(t_measured_c=scenario.t_measured_c, t_ext_c=scenario.t_ext_c, q_solar_w=scenario.q_solar_w, q_occ_w=scenario.q_occ_w, q_hvac_w=scenario.q_hvac_w, r_bounds=(constants.R_LUMPED_MIN_K_PER_W, constants.R_LUMPED_MAX_K_PER_W), c_bounds=(constants.C_LUMPED_MIN_J_PER_K, constants.C_LUMPED_MAX_J_PER_K), r_initial_guess=R_TRUE * 1.6, c_initial_guess=C_TRUE * 0.6, horizon_steps=1)
        r_rel_err = abs(fit.r_k_per_w - R_TRUE) / R_TRUE
        assert r_rel_err > 0.1

class TestRecoversKnownParameters:

    @pytest.mark.parametrize('seed', [0, 1, 2, 3])
    def test_recovers_r_and_c_within_10_percent(self, seed: int) -> None:
        scenario = generate_synthetic_scenario(R_TRUE, C_TRUE, days=21, sensor_noise_std_c=0.3, seed=seed)
        n = len(scenario.t_ext_c)
        split = int(n * 0.7)
        fit = fit_rc(t_measured_c=scenario.t_measured_c[:split + 1], t_ext_c=scenario.t_ext_c[:split], q_solar_w=scenario.q_solar_w[:split], q_occ_w=scenario.q_occ_w[:split], q_hvac_w=scenario.q_hvac_w[:split], r_bounds=(constants.R_LUMPED_MIN_K_PER_W, constants.R_LUMPED_MAX_K_PER_W), c_bounds=(constants.C_LUMPED_MIN_J_PER_K, constants.C_LUMPED_MAX_J_PER_K), r_initial_guess=R_TRUE * 1.6, c_initial_guess=C_TRUE * 0.6, horizon_steps=FITTING_HORIZON_STEPS)
        assert abs(fit.r_k_per_w - R_TRUE) / R_TRUE < 0.1, f'seed={seed}: R off by {abs(fit.r_k_per_w - R_TRUE) / R_TRUE:.1%}'
        assert abs(fit.c_j_per_k - C_TRUE) / C_TRUE < 0.1, f'seed={seed}: C off by {abs(fit.c_j_per_k - C_TRUE) / C_TRUE:.1%}'

    def test_validation_rmse_is_one_step_ahead_and_near_noise_floor(self) -> None:
        from agents.thermal_agent.rc import one_step_ahead_rmse
        scenario = generate_synthetic_scenario(R_TRUE, C_TRUE, days=21, sensor_noise_std_c=0.3, seed=0)
        n = len(scenario.t_ext_c)
        split = int(n * 0.7)
        fit = fit_rc(t_measured_c=scenario.t_measured_c[:split + 1], t_ext_c=scenario.t_ext_c[:split], q_solar_w=scenario.q_solar_w[:split], q_occ_w=scenario.q_occ_w[:split], q_hvac_w=scenario.q_hvac_w[:split], r_bounds=(constants.R_LUMPED_MIN_K_PER_W, constants.R_LUMPED_MAX_K_PER_W), c_bounds=(constants.C_LUMPED_MIN_J_PER_K, constants.C_LUMPED_MAX_J_PER_K), r_initial_guess=R_TRUE * 1.6, c_initial_guess=C_TRUE * 0.6, horizon_steps=FITTING_HORIZON_STEPS)
        val_rmse = one_step_ahead_rmse(fit.r_k_per_w, fit.c_j_per_k, scenario.t_measured_c[split:], scenario.t_ext_c[split:], scenario.q_solar_w[split:], scenario.q_occ_w[split:], scenario.q_hvac_w[split:])
        assert val_rmse < 0.6
