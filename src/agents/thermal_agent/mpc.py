from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
import cvxpy as cp
import numpy as np
from . import constants
from .rc import discretization_factor
_INFEASIBILITY_SLACK_EPS_C = 0.0001

@dataclass(frozen=True)
class MpcInputs:
    timestamps: list[datetime]
    t_current_c: float
    t_ext_c: np.ndarray
    q_solar_w: np.ndarray
    q_occ_w: np.ndarray
    occupied: np.ndarray
    price_currency_per_kwh: float
    carbon_gco2_per_kwh: np.ndarray
    r_k_per_w: float
    c_j_per_k: float
    capacity_kw: float
    cop_cooling: float

@dataclass(frozen=True)
class MpcSolution:
    timestamps: list[datetime]
    setpoint_c: np.ndarray
    predicted_temp_c: np.ndarray
    predicted_kwh: np.ndarray
    predicted_gco2: np.ndarray
    q_hvac_w: np.ndarray
    status: str
    comfort_violated: bool
    max_slack_c: float

def solve(inputs: MpcInputs) -> MpcSolution:
    n = len(inputs.timestamps)
    if not (len(inputs.t_ext_c) == n and len(inputs.q_solar_w) == n and (len(inputs.q_occ_w) == n) and (len(inputs.occupied) == n) and (len(inputs.carbon_gco2_per_kwh) == n)):
        raise ValueError('all per-step input arrays must have the same length as timestamps')
    dt_hours = constants.DT_SECONDS / 3600.0
    a = discretization_factor(inputs.r_k_per_w, inputs.c_j_per_k)
    q_hvac_w = cp.Variable(n)
    t = cp.Variable(n + 1)
    slack_lower = cp.Variable(n, nonneg=True)
    slack_upper = cp.Variable(n, nonneg=True)
    t_min = np.where(inputs.occupied, constants.T_MIN_OCCUPIED_C, constants.T_MIN_UNOCCUPIED_C)
    t_max = np.where(inputs.occupied, constants.T_MAX_OCCUPIED_C, constants.T_MAX_UNOCCUPIED_C)
    constraints = [t[0] == inputs.t_current_c]
    for k in range(n):
        constraints.append(t[k + 1] == a * t[k] + (1.0 - a) * (inputs.t_ext_c[k] + inputs.r_k_per_w * (inputs.q_solar_w[k] + inputs.q_occ_w[k] + q_hvac_w[k])))
    constraints += [q_hvac_w >= -inputs.capacity_kw * 1000.0, q_hvac_w <= 0.0, t[1:] >= t_min - slack_lower, t[1:] <= t_max + slack_upper]
    p_elec_kw = -q_hvac_w / (inputs.cop_cooling * 1000.0)
    carbon_kg_per_kwh = inputs.carbon_gco2_per_kwh / 1000.0
    rate = inputs.price_currency_per_kwh + constants.CARBON_WEIGHT_LAMBDA * carbon_kg_per_kwh
    energy_cost = cp.sum(cp.multiply(rate, p_elec_kw)) * dt_hours
    slack_penalty = constants.COMFORT_SLACK_PENALTY * cp.sum(slack_lower + slack_upper)
    problem = cp.Problem(cp.Minimize(energy_cost + slack_penalty), constraints)
    problem.solve(solver=cp.ECOS)
    if t.value is None:
        raise RuntimeError(f'MPC solve failed to produce a solution (status={problem.status})')
    predicted_temp_c = t.value[1:]
    q_hvac_solved = q_hvac_w.value
    p_elec_kw_solved = np.clip(-q_hvac_solved / (inputs.cop_cooling * 1000.0), 0.0, None)
    predicted_kwh = p_elec_kw_solved * dt_hours
    predicted_gco2 = predicted_kwh * inputs.carbon_gco2_per_kwh
    max_slack = float(np.max(slack_lower.value + slack_upper.value))
    return MpcSolution(timestamps=inputs.timestamps, setpoint_c=np.round(predicted_temp_c, 1), predicted_temp_c=predicted_temp_c, predicted_kwh=predicted_kwh, predicted_gco2=predicted_gco2, q_hvac_w=q_hvac_solved, status=problem.status, comfort_violated=max_slack > _INFEASIBILITY_SLACK_EPS_C, max_slack_c=max_slack)
