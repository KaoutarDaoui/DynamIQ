"""ElectricityMaps client — hourly grid carbon intensity for the MPC's
carbon penalty term. Falls back to a static regional profile when no API
key is configured, so the optimizer always has a signal to use.

TODO:
    - get_carbon_intensity(zone, hours): fetch hourly forecasted
      gCO2eq/kWh from ElectricityMaps for the configured grid zone.
    - fallback_profile(hours): static day-shape profile keyed by
      settings.electricitymaps_zone, used when no API key is set.
"""
from __future__ import annotations

import numpy as np

ELECTRICITYMAPS_URL = "https://api.electricitymap.org/v3/carbon-intensity/forecast"


def get_carbon_intensity(zone: str, hours: int = 24) -> np.ndarray:
    """Fetch (or fall back to) hourly grid carbon intensity in gCO2/kWh."""
    raise NotImplementedError
