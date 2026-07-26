"""Open-Meteo client — 24h outdoor temperature + solar forecast, no API key.

TODO:
    - get_forecast(lat, lon, hours): fetch hourly temperature_2m and
      shortwave_radiation from the Open-Meteo forecast API and return
      them as aligned arrays for use as RC model exogenous inputs.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


@dataclass
class WeatherForecast:
    timestamps: list
    t_ext_c: np.ndarray
    solar_wm2: np.ndarray


def get_forecast(lat: float, lon: float, hours: int = 24) -> WeatherForecast:
    """Fetch an hourly outdoor temperature + solar radiation forecast."""
    raise NotImplementedError
