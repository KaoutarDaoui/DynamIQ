from __future__ import annotations
from datetime import datetime, timedelta, timezone
import numpy as np
import pytest
from agents.thermal_agent import constants
from agents.thermal_agent.anomaly import check_comfort_violation, check_sensor_validity
from agents.thermal_agent.db import SensorReadingsWindow

def _window(temps: list[float], now: datetime | None=None, spacing_minutes: int=15) -> SensorReadingsWindow:
    now = now or datetime.now(timezone.utc)
    n = len(temps)
    ts = [now - timedelta(minutes=spacing_minutes * (n - 1 - i)) for i in range(n)]
    zeros = np.zeros(n)
    return SensorReadingsWindow(ts=ts, temp_measured_c=np.array(temps, dtype=float), temp_ext_c=zeros, q_solar_w=zeros, q_occ_w=zeros, q_hvac_w=zeros)

class TestSensorValidity:

    def test_no_readings_is_a_fault(self) -> None:
        result = check_sensor_validity('r1', _window([]))
        assert result is not None
        assert result.stage == 'sensor_fault'

    def test_fresh_normal_reading_passes(self) -> None:
        result = check_sensor_validity('r1', _window([20.0, 21.0, 22.0, 23.0]))
        assert result is None

    def test_stale_reading_is_a_fault(self) -> None:
        old_now = datetime.now(timezone.utc) - timedelta(hours=2)
        result = check_sensor_validity('r1', _window([21.0, 22.0], now=old_now))
        assert result is not None
        assert result.stage == 'sensor_fault'
        assert 'stale' in result.detail

    def test_reading_below_physical_range_is_a_fault(self) -> None:
        result = check_sensor_validity('r1', _window([20.0, 21.0, -5.0]))
        assert result is not None
        assert result.stage == 'sensor_fault'

    def test_reading_above_physical_range_is_a_fault(self) -> None:
        result = check_sensor_validity('r1', _window([20.0, 21.0, 60.0]))
        assert result is not None
        assert result.stage == 'sensor_fault'

    def test_boundary_values_are_valid(self) -> None:
        assert check_sensor_validity('r1', _window([constants.SENSOR_VALID_MIN_C])) is None
        assert check_sensor_validity('r1', _window([constants.SENSOR_VALID_MAX_C])) is None

    def test_byte_identical_for_over_2h_is_stuck_fault(self) -> None:
        temps = [22.0] * 9
        result = check_sensor_validity('r1', _window(temps))
        assert result is not None
        assert result.stage == 'sensor_fault'
        assert 'identical' in result.detail

    def test_identical_but_short_window_is_not_a_fault(self) -> None:
        result = check_sensor_validity('r1', _window([22.0, 22.0]))
        assert result is None

    def test_varying_readings_over_2h_are_not_stuck(self) -> None:
        temps = [20.0, 20.5, 21.0, 21.5, 22.0, 22.5, 23.0, 23.5, 24.0]
        result = check_sensor_validity('r1', _window(temps))
        assert result is None

class TestComfortViolation:

    def test_within_bounds_while_occupied_passes(self) -> None:
        mid = (constants.T_MIN_OCCUPIED_C + constants.T_MAX_OCCUPIED_C) / 2.0
        assert check_comfort_violation('r1', mid, occupied=True) is None

    def test_below_min_while_occupied_violates(self) -> None:
        result = check_comfort_violation('r1', constants.T_MIN_OCCUPIED_C - 1.0, occupied=True)
        assert result is not None
        assert result.stage == 'comfort_violation'

    def test_above_max_while_occupied_violates(self) -> None:
        result = check_comfort_violation('r1', constants.T_MAX_OCCUPIED_C + 1.0, occupied=True)
        assert result is not None
        assert result.stage == 'comfort_violation'

    def test_out_of_occupied_bounds_while_unoccupied_does_not_violate(self) -> None:
        result = check_comfort_violation('r1', constants.T_MAX_OCCUPIED_C + 1.0, occupied=False)
        assert result is None

    def test_boundary_values_do_not_violate(self) -> None:
        assert check_comfort_violation('r1', constants.T_MIN_OCCUPIED_C, occupied=True) is None
        assert check_comfort_violation('r1', constants.T_MAX_OCCUPIED_C, occupied=True) is None
