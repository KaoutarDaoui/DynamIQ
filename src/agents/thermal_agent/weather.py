from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import httpx
import numpy as np
import pandas as pd
import pvlib
from . import constants
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
_FACADE_AZIMUTH_DEG = {'north': 0.0, 'east': 90.0, 'south': 180.0, 'west': 270.0}

@dataclass(frozen=True)
class WeatherForecast:
    timestamps: list[datetime]
    temp_ext_c: np.ndarray
    ghi_w_m2: np.ndarray

def _resample_hourly_to_15min(hourly_times: list[datetime], hourly_values: np.ndarray, n_steps: int, dt_s: float) -> np.ndarray:
    start = hourly_times[0]
    hourly_seconds = np.array([(t - start).total_seconds() for t in hourly_times])
    target_seconds = np.arange(n_steps) * dt_s
    return np.interp(target_seconds, hourly_seconds, hourly_values)

def fetch_forecast(latitude: float, longitude: float, horizon_hours: int=24, dt_s: float=constants.DT_SECONDS, timeout_s: float=10.0) -> WeatherForecast:
    response = httpx.get(OPEN_METEO_URL, params={'latitude': latitude, 'longitude': longitude, 'hourly': 'temperature_2m,shortwave_radiation', 'forecast_days': max(1, -(-horizon_hours // 24)), 'timezone': 'UTC'}, timeout=timeout_s)
    response.raise_for_status()
    hourly = response.json()['hourly']
    hourly_times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in hourly['time']]
    hourly_temp = np.array(hourly['temperature_2m'], dtype=float)
    hourly_ghi = np.array(hourly['shortwave_radiation'], dtype=float)
    n_steps = int(horizon_hours * 3600.0 / dt_s)
    temp = _resample_hourly_to_15min(hourly_times, hourly_temp, n_steps, dt_s)
    ghi = np.clip(_resample_hourly_to_15min(hourly_times, hourly_ghi, n_steps, dt_s), 0.0, None)
    timestamps = [hourly_times[0] + timedelta(seconds=float(k * dt_s)) for k in range(n_steps)]
    return WeatherForecast(timestamps=timestamps, temp_ext_c=temp, ghi_w_m2=ghi)

def offline_forecast(latitude: float, longitude: float, start: datetime, horizon_hours: int=24, dt_s: float=constants.DT_SECONDS) -> WeatherForecast:
    n_steps = int(horizon_hours * 3600.0 / dt_s)
    timestamps = [start + timedelta(seconds=float(k * dt_s)) for k in range(n_steps)]
    times = pd.DatetimeIndex(timestamps)
    hour_of_day = np.array([t.hour + t.minute / 60.0 for t in timestamps])
    temp_ext_c = 28.0 + 6.0 * np.cos(2.0 * np.pi * (hour_of_day - 15.0) / 24.0)
    solar_position = pvlib.solarposition.get_solarposition(times, latitude, longitude)
    airmass_relative = pvlib.atmosphere.get_relative_airmass(solar_position['apparent_zenith'])
    airmass_absolute = pvlib.atmosphere.get_absolute_airmass(airmass_relative)
    linke_turbidity = pvlib.clearsky.lookup_linke_turbidity(times, latitude, longitude)
    altitude = pvlib.location.lookup_altitude(latitude, longitude)
    dni_extra = pvlib.irradiance.get_extra_radiation(times)
    clearsky = pvlib.clearsky.ineichen(solar_position['apparent_zenith'], airmass_absolute, linke_turbidity, altitude=altitude, dni_extra=dni_extra)
    ghi = np.clip(clearsky['ghi'].to_numpy(dtype=float), 0.0, None)
    return WeatherForecast(timestamps=timestamps, temp_ext_c=temp_ext_c, ghi_w_m2=ghi)
_forecast_cache: dict[tuple[float, float], tuple[datetime, WeatherForecast]] = {}
_CACHE_TTL = timedelta(hours=1)

def clear_cache() -> None:
    _forecast_cache.clear()

def get_forecast(latitude: float, longitude: float, horizon_hours: int=24, offline: bool=False, now: datetime | None=None) -> WeatherForecast:
    now = now or datetime.now(timezone.utc)
    key = (round(latitude, 3), round(longitude, 3))
    cached = _forecast_cache.get(key)
    if cached is not None and now - cached[0] < _CACHE_TTL:
        return cached[1]
    if offline:
        forecast = offline_forecast(latitude, longitude, now, horizon_hours)
    else:
        try:
            forecast = fetch_forecast(latitude, longitude, horizon_hours)
        except httpx.HTTPError:
            forecast = offline_forecast(latitude, longitude, now, horizon_hours)
    _forecast_cache[key] = (now, forecast)
    return forecast

def solar_gain_w(orientation: str, latitude: float, longitude: float, timestamps: list[datetime], ghi_w_m2: np.ndarray, window_area_m2: float, shgc: float=constants.SHGC) -> np.ndarray:
    if orientation not in _FACADE_AZIMUTH_DEG:
        raise ValueError(f'orientation must be one of {sorted(_FACADE_AZIMUTH_DEG)}, got {orientation!r}')
    if window_area_m2 <= 0.0:
        return np.zeros(len(timestamps), dtype=float)
    times = pd.DatetimeIndex(timestamps)
    solar_position = pvlib.solarposition.get_solarposition(times, latitude, longitude)
    zenith = solar_position['apparent_zenith']
    azimuth = solar_position['azimuth']
    erbs = pvlib.irradiance.erbs(pd.Series(ghi_w_m2, index=times), zenith, times)
    dni, dhi = (erbs['dni'], erbs['dhi'])
    poa = pvlib.irradiance.get_total_irradiance(surface_tilt=90.0, surface_azimuth=_FACADE_AZIMUTH_DEG[orientation], solar_zenith=zenith, solar_azimuth=azimuth, dni=dni, ghi=ghi_w_m2, dhi=dhi)
    poa_global = np.clip(poa['poa_global'].to_numpy(dtype=float), 0.0, None)
    return shgc * window_area_m2 * poa_global
