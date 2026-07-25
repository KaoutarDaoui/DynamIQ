"""Agent Thermique — the computational brain. Not an LLM: deterministic
physics + optimization, wrapping the RC model and MPC solver.

TODO:
    - calibrate_zone(): pull recent sensor history + exogenous inputs and
      call dynamiq.models.rc_model.calibrate().
    - compute_trajectory(): pull weather/carbon forecast + occupancy from
      Agent Bâtiment and call dynamiq.models.mpc.solve().
    - detect_anomalies(): compare predicted vs measured temperature and
      HVAC state to flag Anomaly records (overheating, stuck damper,
      simultaneous heat/cool, schedule mismatch).
"""
from __future__ import annotations

from dynamiq.agents.base import Agent
from dynamiq.data.schemas import Anomaly, RCParams, SetpointTrajectory, Zone


class ThermalAgent(Agent):
    name = "agent_thermique"

    def calibrate_zone(self, zone: Zone) -> RCParams:
        raise NotImplementedError

    def compute_trajectory(self, zone: Zone, rc_params: RCParams) -> SetpointTrajectory:
        raise NotImplementedError

    def detect_anomalies(self, zone: Zone, trajectory: SetpointTrajectory) -> list[Anomaly]:
        raise NotImplementedError
