"""Grey-box RC thermal network model — the "Engine" layer from the brief.

A zone is represented as a lumped thermal circuit:

    C * dT/dt = (T_ext - T_zone) / R_wall
              + (T_ext - T_zone) / R_window
              + Q_solar + Q_hvac + Q_occupants

TODO:
    - simulate(): forward-integrate zone temperature given RC params and
      exogenous inputs (T_ext, Q_solar, Q_hvac, Q_occupants) over a horizon.
    - calibrate(): fit (r_wall, r_window, c_zone) to measured sensor data
      (least squares against 2 weeks of readings), returning fitted
      RCParams with RMSE reported honestly.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from dynamiq.data.schemas import RCParams


@dataclass
class ExogenousInputs:
    """Per-timestep external drivers of zone temperature, one entry per step."""

    t_ext_c: np.ndarray  # outdoor air temperature
    q_solar_w: np.ndarray  # solar heat gain
    q_hvac_w: np.ndarray  # HVAC heat input (+heating / -cooling)
    q_occupants_w: np.ndarray  # occupant + equipment internal gains

    def __len__(self) -> int:
        return len(self.t_ext_c)


def simulate(
    r_wall: float,
    r_window: float,
    c_zone: float,
    t0_c: float,
    exog: ExogenousInputs,
    dt_seconds: float,
) -> np.ndarray:
    """Forward-simulate zone temperature over the exogenous input horizon."""
    raise NotImplementedError


def calibrate(
    zone_id: str,
    measured_temps_c: np.ndarray,
    exog: ExogenousInputs,
    dt_seconds: float,
) -> RCParams:
    """Fit (r_wall, r_window, c_zone) to measured temperature by least squares."""
    raise NotImplementedError
