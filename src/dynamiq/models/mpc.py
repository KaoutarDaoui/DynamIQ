"""Model Predictive Control optimizer — solves the 24h setpoint trajectory.

Every 15 minutes, for each zone:

    MINIMIZE:   energy_cost + carbon_penalty over the horizon
    SUBJECT TO: T_min <= T_zone <= T_max at all times

Inputs: weather forecast, hourly grid carbon intensity, scheduled
occupancy (from Agent Bâtiment), and the zone's current RCParams.

TODO:
    - solve(): build and solve the convex MPC problem (e.g. with cvxpy)
      given RCParams, a weather/carbon forecast, and zone comfort bounds;
      return a SetpointTrajectory.
"""
from __future__ import annotations

import numpy as np

from dynamiq.data.schemas import RCParams, SetpointTrajectory, Zone


def solve(
    zone: Zone,
    rc_params: RCParams,
    t_ext_forecast_c: np.ndarray,
    carbon_intensity_gco2_per_kwh: np.ndarray,
    energy_price_per_kwh: np.ndarray,
    occupancy_schedule: np.ndarray,
    dt_minutes: int,
) -> SetpointTrajectory:
    """Solve the horizon-ahead optimal setpoint trajectory for one zone."""
    raise NotImplementedError
