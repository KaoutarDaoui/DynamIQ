from __future__ import annotations
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import httpx
import numpy as np
from . import constants
ELECTRICITYMAPS_FORECAST_URL = 'https://api.electricitymap.org/v3/carbon-intensity/forecast'

@dataclass(frozen=True)
class CarbonForecast:
    timestamps: list[datetime]
    carbon_intensity_gco2_per_kwh: np.ndarray

def fetch_forecast(zone: str, api_key: str | None=None, horizon_hours: int=24, dt_s: float=constants.DT_SECONDS, timeout_s: float=10.0) -> CarbonForecast:
    api_key = api_key or os.getenv('ELECTRICITYMAPS_API_KEY')
    if not api_key:
        raise RuntimeError('ELECTRICITYMAPS_API_KEY not set (see .env.example)')
    response = httpx.get(ELECTRICITYMAPS_FORECAST_URL, params={'zone': zone}, headers={'auth-token': api_key}, timeout=timeout_s)
    response.raise_for_status()
    forecast = response.json()['forecast']
    hourly_times = [datetime.fromisoformat(item['datetime'].replace('Z', '+00:00')) for item in forecast]
    hourly_intensity = np.array([item['carbonIntensity'] for item in forecast], dtype=float)
    n_steps = int(horizon_hours * 3600.0 / dt_s)
    hourly_seconds = np.array([(t - hourly_times[0]).total_seconds() for t in hourly_times])
    target_seconds = np.arange(n_steps) * dt_s
    intensity = np.clip(np.interp(target_seconds, hourly_seconds, hourly_intensity), 0.0, None)
    timestamps = [hourly_times[0] + timedelta(seconds=float(s)) for s in target_seconds]
    return CarbonForecast(timestamps=timestamps, carbon_intensity_gco2_per_kwh=intensity)

def offline_forecast(zone: str, start: datetime, horizon_hours: int=24, dt_s: float=constants.DT_SECONDS) -> CarbonForecast:
    n_steps = int(horizon_hours * 3600.0 / dt_s)
    timestamps = [start + timedelta(seconds=float(k * dt_s)) for k in range(n_steps)]
    hour_of_day = np.array([t.hour + t.minute / 60.0 for t in timestamps])
    intensity = constants.CARBON_OFFLINE_BASELINE_GCO2_PER_KWH + constants.CARBON_OFFLINE_AMPLITUDE_GCO2_PER_KWH * np.cos(2.0 * np.pi * (hour_of_day - constants.CARBON_OFFLINE_PEAK_HOUR) / 24.0)
    return CarbonForecast(timestamps=timestamps, carbon_intensity_gco2_per_kwh=np.clip(intensity, 0.0, None))
_forecast_cache: dict[str, tuple[datetime, CarbonForecast]] = {}
_CACHE_TTL = timedelta(hours=1)

def clear_cache() -> None:
    _forecast_cache.clear()

def get_forecast(zone: str, horizon_hours: int=24, offline: bool=False, now: datetime | None=None) -> CarbonForecast:
    now = now or datetime.now(timezone.utc)
    cached = _forecast_cache.get(zone)
    if cached is not None and now - cached[0] < _CACHE_TTL:
        return cached[1]
    if offline:
        forecast = offline_forecast(zone, now, horizon_hours)
    else:
        try:
            forecast = fetch_forecast(zone, horizon_hours=horizon_hours)
        except (httpx.HTTPError, RuntimeError):
            forecast = offline_forecast(zone, now, horizon_hours)
    _forecast_cache[zone] = (now, forecast)
    return forecast
