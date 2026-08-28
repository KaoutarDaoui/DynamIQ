from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from scipy.optimize import least_squares
from . import constants

def discretization_factor(r_k_per_w: float, c_j_per_k: float, dt_s: float=constants.DT_SECONDS) -> float:
    return float(np.exp(-dt_s / (r_k_per_w * c_j_per_k)))

def step(t_k_c: float, t_ext_k_c: float, q_solar_k_w: float, q_occ_k_w: float, q_hvac_k_w: float, r_k_per_w: float, c_j_per_k: float, dt_s: float=constants.DT_SECONDS) -> float:
    a = discretization_factor(r_k_per_w, c_j_per_k, dt_s)
    return a * t_k_c + (1.0 - a) * (t_ext_k_c + r_k_per_w * (q_solar_k_w + q_occ_k_w + q_hvac_k_w))

def simulate(t0_c: float, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, r_k_per_w: float, c_j_per_k: float, dt_s: float=constants.DT_SECONDS) -> np.ndarray:
    n = len(t_ext_c)
    if not len(q_solar_w) == len(q_occ_w) == len(q_hvac_w) == n:
        raise ValueError('t_ext_c, q_solar_w, q_occ_w, q_hvac_w must all have the same length')
    a = discretization_factor(r_k_per_w, c_j_per_k, dt_s)
    t = np.empty(n + 1, dtype=float)
    t[0] = t0_c
    for k in range(n):
        t[k + 1] = a * t[k] + (1.0 - a) * (t_ext_c[k] + r_k_per_w * (q_solar_w[k] + q_occ_w[k] + q_hvac_w[k]))
    return t

def one_step_ahead_predictions(r_k_per_w: float, c_j_per_k: float, t_measured_c: np.ndarray, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, dt_s: float=constants.DT_SECONDS) -> np.ndarray:
    a = discretization_factor(r_k_per_w, c_j_per_k, dt_s)
    t_prev = t_measured_c[:-1]
    return a * t_prev + (1.0 - a) * (t_ext_c + r_k_per_w * (q_solar_w + q_occ_w + q_hvac_w))

def one_step_ahead_rmse(r_k_per_w: float, c_j_per_k: float, t_measured_c: np.ndarray, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, dt_s: float=constants.DT_SECONDS) -> float:
    predicted = one_step_ahead_predictions(r_k_per_w, c_j_per_k, t_measured_c, t_ext_c, q_solar_w, q_occ_w, q_hvac_w, dt_s)
    return float(np.sqrt(np.mean((predicted - t_measured_c[1:]) ** 2)))

def robust_one_step_ahead_rmse(r_k_per_w: float, c_j_per_k: float, t_measured_c: np.ndarray, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, dt_s: float=constants.DT_SECONDS, trim_fraction: float=0.1) -> float:
    """Like one_step_ahead_rmse, but excludes the largest `trim_fraction` of
    residuals (by magnitude) before computing RMSE. The live sensor feed
    injects faulty readings (spikes, dropouts) on purpose to exercise the
    anomaly pipeline -- roughly 7% of samples -- and a plain RMSE computed
    over a validation window that includes them is dominated by those few
    huge residuals. That inflates rmse_validation and, downstream, the
    anomaly threshold (3x RMSE) to the point genuine anomalies can never
    exceed it. Trimming the worst ~10% (comfortably above the known fault
    rate) keeps this an honest estimate of the model's real noise floor."""
    predicted = one_step_ahead_predictions(r_k_per_w, c_j_per_k, t_measured_c, t_ext_c, q_solar_w, q_occ_w, q_hvac_w, dt_s)
    residuals = predicted - t_measured_c[1:]
    n = len(residuals)
    if n == 0:
        return 0.0
    keep = max(1, int(np.ceil(n * (1.0 - trim_fraction))))
    trimmed = np.sort(np.abs(residuals))[:keep]
    return float(np.sqrt(np.mean(trimmed ** 2)))

def _n_step_predictions(r_k_per_w: float, c_j_per_k: float, t_measured_c: np.ndarray, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, horizon_steps: int, dt_s: float) -> tuple[np.ndarray, np.ndarray]:
    a = discretization_factor(r_k_per_w, c_j_per_k, dt_s)
    n = len(t_ext_c)
    n_windows = n // horizon_steps
    usable = n_windows * horizon_steps
    t_ext = t_ext_c[:usable].reshape(n_windows, horizon_steps)
    q_solar = q_solar_w[:usable].reshape(n_windows, horizon_steps)
    q_occ = q_occ_w[:usable].reshape(n_windows, horizon_steps)
    q_hvac = q_hvac_w[:usable].reshape(n_windows, horizon_steps)
    anchors = t_measured_c[0:usable:horizon_steps]
    targets = t_measured_c[horizon_steps:usable + 1:horizon_steps]
    t = anchors.copy()
    for k in range(horizon_steps):
        t = a * t + (1.0 - a) * (t_ext[:, k] + r_k_per_w * (q_solar[:, k] + q_occ[:, k] + q_hvac[:, k]))
    return (t, targets)

@dataclass(frozen=True)
class FitResult:
    r_k_per_w: float
    c_j_per_k: float
    rmse_c: float

def fit_rc(t_measured_c: np.ndarray, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, r_bounds: tuple[float, float], c_bounds: tuple[float, float], r_initial_guess: float, c_initial_guess: float, horizon_steps: int=1, dt_s: float=constants.DT_SECONDS) -> FitResult:
    n = len(t_ext_c)
    if not (len(q_solar_w) == len(q_occ_w) == len(q_hvac_w) == n and len(t_measured_c) == n + 1):
        raise ValueError('exogenous arrays must have length N; t_measured_c must have length N+1')
    if horizon_steps < 1:
        raise ValueError('horizon_steps must be >= 1')

    def residuals(params: np.ndarray) -> np.ndarray:
        r, c = params
        predicted, targets = _n_step_predictions(r, c, t_measured_c, t_ext_c, q_solar_w, q_occ_w, q_hvac_w, horizon_steps, dt_s)
        return predicted - targets
    result = least_squares(residuals, x0=np.array([r_initial_guess, c_initial_guess], dtype=float), bounds=([r_bounds[0], c_bounds[0]], [r_bounds[1], c_bounds[1]]), x_scale=np.array([r_initial_guess, c_initial_guess], dtype=float))
    r_fit, c_fit = (float(result.x[0]), float(result.x[1]))
    rmse = one_step_ahead_rmse(r_fit, c_fit, t_measured_c, t_ext_c, q_solar_w, q_occ_w, q_hvac_w, dt_s)
    return FitResult(r_k_per_w=r_fit, c_j_per_k=c_fit, rmse_c=rmse)

@dataclass(frozen=True)
class SyntheticScenario:
    dt_s: float
    t_ext_c: np.ndarray
    q_solar_w: np.ndarray
    q_occ_w: np.ndarray
    q_hvac_w: np.ndarray
    t_true_c: np.ndarray
    t_measured_c: np.ndarray

def generate_synthetic_scenario(r_true_k_per_w: float, c_true_j_per_k: float, days: int=21, t0_c: float=24.0, sensor_noise_std_c: float=0.3, capacity_persons: float=20.0, hvac_capacity_w: float=3500.0, setpoint_occupied_c: float=22.0, seed: int | None=0) -> SyntheticScenario:
    rng = np.random.default_rng(seed)
    steps_per_day = int(round(86400.0 / constants.DT_SECONDS))
    n = days * steps_per_day
    t_hours = np.arange(n) * (constants.DT_SECONDS / 3600.0)
    hour_of_day = t_hours % 24.0
    day_index = np.arange(n) // steps_per_day
    daily_temp_offset = rng.uniform(-3.0, 3.0, size=days)[day_index]
    daily_solar_scale = rng.uniform(0.3, 1.3, size=days)[day_index]
    daily_hvac_on = (rng.uniform(0.0, 1.0, size=days) > 0.15)[day_index]
    t_ext_c = 28.0 + 6.0 * np.cos(2.0 * np.pi * (hour_of_day - 15.0) / 24.0) + daily_temp_offset
    occupied = (hour_of_day >= 8.0) & (hour_of_day < 16.0)
    q_occ_w = np.where(occupied, capacity_persons * constants.OCCUPANT_SENSIBLE_HEAT_W, 0.0)
    daylight = np.clip(np.sin(np.pi * (hour_of_day - 6.0) / 12.0), 0.0, None)
    q_solar_w = 400.0 * daylight * daily_solar_scale
    a = discretization_factor(r_true_k_per_w, c_true_j_per_k)
    t_true = np.empty(n + 1, dtype=float)
    q_hvac_w = np.empty(n, dtype=float)
    t_true[0] = t0_c
    for k in range(n):
        if occupied[k] and t_true[k] > setpoint_occupied_c and daily_hvac_on[k]:
            q_hvac_w[k] = -hvac_capacity_w
        else:
            q_hvac_w[k] = 0.0
        t_true[k + 1] = a * t_true[k] + (1.0 - a) * (t_ext_c[k] + r_true_k_per_w * (q_solar_w[k] + q_occ_w[k] + q_hvac_w[k]))
    noise = rng.normal(0.0, sensor_noise_std_c, size=n + 1)
    t_measured = t_true + noise
    return SyntheticScenario(dt_s=constants.DT_SECONDS, t_ext_c=t_ext_c, q_solar_w=q_solar_w, q_occ_w=q_occ_w, q_hvac_w=q_hvac_w, t_true_c=t_true, t_measured_c=t_measured)
