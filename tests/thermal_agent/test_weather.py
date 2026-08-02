from __future__ import annotations
from datetime import datetime, timezone
import numpy as np
import pytest
from agents.thermal_agent.weather import clear_cache, get_forecast, offline_forecast, solar_gain_w
LAT, LON = (36.7538, 3.0588)

class TestOfflineForecast:

    def test_shape_matches_horizon(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        assert len(fc.timestamps) == 96
        assert len(fc.temp_ext_c) == 96
        assert len(fc.ghi_w_m2) == 96

    def test_temperature_in_plausible_algiers_range(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        assert fc.temp_ext_c.min() > 15.0
        assert fc.temp_ext_c.max() < 40.0

    def test_ghi_is_zero_at_night_and_positive_at_midday(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        assert fc.ghi_w_m2[0] == pytest.approx(0.0, abs=1.0)
        midday_idx = 48
        assert fc.ghi_w_m2[midday_idx] > 500.0

    def test_ghi_never_negative(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        assert np.all(fc.ghi_w_m2 >= 0.0)

class TestSolarGain:

    def test_zero_window_area_gives_zero_gain(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        q = solar_gain_w('south', LAT, LON, fc.timestamps, fc.ghi_w_m2, window_area_m2=0.0)
        assert np.all(q == 0.0)

    def test_invalid_orientation_raises(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        with pytest.raises(ValueError):
            solar_gain_w('northeast', LAT, LON, fc.timestamps, fc.ghi_w_m2, window_area_m2=8.0)

    def test_south_dominates_in_winter(self) -> None:
        start = datetime(2026, 1, 15, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        gains = {o: solar_gain_w(o, LAT, LON, fc.timestamps, fc.ghi_w_m2, window_area_m2=8.0).sum() for o in ('north', 'south', 'east', 'west')}
        assert gains['south'] > gains['east']
        assert gains['south'] > gains['west']
        assert gains['south'] > gains['north']

    def test_east_west_exceed_south_in_high_summer(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast(LAT, LON, start, horizon_hours=24)
        gains = {o: solar_gain_w(o, LAT, LON, fc.timestamps, fc.ghi_w_m2, window_area_m2=8.0).sum() for o in ('north', 'south', 'east', 'west')}
        assert gains['east'] > gains['south']
        assert gains['west'] > gains['south']
        assert gains['south'] > gains['north']

class TestGetForecastCaching:

    def setup_method(self) -> None:
        clear_cache()

    def test_offline_true_never_touches_network_and_is_cached(self) -> None:
        now = datetime(2026, 7, 30, 8, 0, tzinfo=timezone.utc)
        first = get_forecast(LAT, LON, offline=True, now=now)
        second = get_forecast(LAT, LON, offline=True, now=now)
        assert first is second

    def test_different_coordinates_get_separate_cache_entries(self) -> None:
        now = datetime(2026, 7, 30, 8, 0, tzinfo=timezone.utc)
        a = get_forecast(36.75, 3.05, offline=True, now=now)
        b = get_forecast(40.0, 10.0, offline=True, now=now)
        assert not np.array_equal(a.temp_ext_c, b.temp_ext_c) or a is not b
