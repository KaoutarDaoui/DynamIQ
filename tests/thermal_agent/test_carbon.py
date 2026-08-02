from __future__ import annotations
from datetime import datetime, timezone
import numpy as np
import pytest
from agents.thermal_agent.carbon import clear_cache, fetch_forecast, get_forecast, offline_forecast

class TestOfflineForecast:

    def test_shape_matches_horizon(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast('DZ', start, horizon_hours=24)
        assert len(fc.timestamps) == 96
        assert len(fc.carbon_intensity_gco2_per_kwh) == 96

    def test_never_negative(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast('DZ', start, horizon_hours=24)
        assert np.all(fc.carbon_intensity_gco2_per_kwh >= 0.0)

    def test_has_diurnal_variation_evening_peak_exceeds_early_morning(self) -> None:
        start = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
        fc = offline_forecast('DZ', start, horizon_hours=24)
        evening_idx = 80
        early_morning_idx = 32
        assert fc.carbon_intensity_gco2_per_kwh[evening_idx] > fc.carbon_intensity_gco2_per_kwh[early_morning_idx]

class TestFetchForecastRequiresApiKey:

    def test_raises_without_api_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv('ELECTRICITYMAPS_API_KEY', raising=False)
        with pytest.raises(RuntimeError, match='ELECTRICITYMAPS_API_KEY'):
            fetch_forecast('DZ', api_key=None)

class TestGetForecastCaching:

    def setup_method(self) -> None:
        clear_cache()

    def test_offline_true_never_touches_network_and_is_cached(self) -> None:
        now = datetime(2026, 7, 30, 8, 0, tzinfo=timezone.utc)
        first = get_forecast('DZ', offline=True, now=now)
        second = get_forecast('DZ', offline=True, now=now)
        assert first is second

    def test_falls_back_to_offline_when_no_api_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv('ELECTRICITYMAPS_API_KEY', raising=False)
        now = datetime(2026, 7, 30, 8, 0, tzinfo=timezone.utc)
        fc = get_forecast('DZ', offline=False, now=now)
        assert len(fc.timestamps) == 96
