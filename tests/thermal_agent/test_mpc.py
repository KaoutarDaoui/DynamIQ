from __future__ import annotations
from datetime import datetime, timedelta, timezone
import numpy as np
import pytest
from thermal_agent import constants
from thermal_agent.carbon import offline_forecast as carbon_offline_forecast
from thermal_agent.mpc import MpcInputs, solve
R_A101 = 0.010829145947844227
C_A101 = 3298545.5503180367

def _flat_scenario(t_current_c: float, capacity_kw: float, c_j_per_k: float=C_A101, occupied_all: bool=True):
    start = datetime(2026, 7, 30, 15, 0, tzinfo=timezone.utc)
    n = 96
    timestamps = [start + timedelta(seconds=900 * k) for k in range(n)]
    cfc = carbon_offline_forecast('DZ', start, horizon_hours=24)
    return MpcInputs(timestamps=timestamps, t_current_c=t_current_c, t_ext_c=np.full(n, 25.0), q_solar_w=np.zeros(n), q_occ_w=np.full(n, 800.0), occupied=np.ones(n, dtype=bool) if occupied_all else np.zeros(n, dtype=bool), price_currency_per_kwh=constants.TARIFF_CURRENCY_PER_KWH, carbon_gco2_per_kwh=cfc.carbon_intensity_gco2_per_kwh, r_k_per_w=R_A101, c_j_per_k=c_j_per_k, capacity_kw=capacity_kw, cop_cooling=2.8)

class TestBasicSolve:

    def test_solves_to_optimal(self) -> None:
        sol = solve(_flat_scenario(t_current_c=23.0, capacity_kw=3.5))
        assert sol.status == 'optimal'

    def test_t0_matches_current_reading(self) -> None:
        inputs = _flat_scenario(t_current_c=23.0, capacity_kw=3.5)
        sol = solve(inputs)
        assert abs(sol.predicted_temp_c[0] - 23.0) < 1.0

    def test_q_hvac_never_positive_cooling_only(self) -> None:
        sol = solve(_flat_scenario(t_current_c=23.0, capacity_kw=3.5))
        assert np.all(sol.q_hvac_w <= 1e-06)

    def test_q_hvac_never_exceeds_capacity(self) -> None:
        sol = solve(_flat_scenario(t_current_c=23.0, capacity_kw=3.5))
        assert np.all(sol.q_hvac_w >= -3.5 * 1000.0 - 0.001)

    def test_comfort_respected_when_feasible(self) -> None:
        sol = solve(_flat_scenario(t_current_c=23.0, capacity_kw=10.0))
        assert sol.comfort_violated is False
        assert np.all(sol.predicted_temp_c <= constants.T_MAX_OCCUPIED_C + 0.001)
        assert np.all(sol.predicted_temp_c >= constants.T_MIN_OCCUPIED_C - 0.001)

    def test_mismatched_array_lengths_raise(self) -> None:
        inputs = _flat_scenario(t_current_c=23.0, capacity_kw=3.5)
        bad = MpcInputs(**{**inputs.__dict__, 't_ext_c': inputs.t_ext_c[:-1]})
        with pytest.raises(ValueError):
            solve(bad)

class TestSoftComfortBounds:

    def test_undersized_capacity_reports_violation_not_crash(self) -> None:
        sol = solve(_flat_scenario(t_current_c=23.0, capacity_kw=0.1))
        assert sol.status == 'optimal'
        assert sol.comfort_violated is True
        assert sol.max_slack_c > 0.0

class TestPrecoolingDiagnosis:

    def test_lambda_has_no_effect_at_this_rooms_actual_thermal_mass(self) -> None:
        totals = []
        for lam in (0.0, 8.0, 100.0):
            constants.CARBON_WEIGHT_LAMBDA = lam
            sol = solve(_flat_scenario(t_current_c=26.0, capacity_kw=3.5, c_j_per_k=C_A101))
            totals.append(sol.predicted_gco2.sum())
        constants.CARBON_WEIGHT_LAMBDA = 8.0
        assert totals[0] == pytest.approx(totals[1], rel=1e-06)
        assert totals[1] == pytest.approx(totals[2], rel=1e-06)

    def test_lambda_produces_real_carbon_shifting_at_10x_thermal_mass(self) -> None:
        gco2_low_lambda, gco2_high_lambda = ([], [])
        for lam in (0.0, 100.0):
            constants.CARBON_WEIGHT_LAMBDA = lam
            sol = solve(_flat_scenario(t_current_c=26.0, capacity_kw=3.5, c_j_per_k=C_A101 * 10))
            (gco2_low_lambda if lam == 0.0 else gco2_high_lambda).append(sol.predicted_gco2.sum())
        constants.CARBON_WEIGHT_LAMBDA = 8.0
        assert gco2_high_lambda[0] < gco2_low_lambda[0]
