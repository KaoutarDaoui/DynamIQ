from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import numpy as np
from sqlalchemy import Engine
from typing import Any
from . import constants
from .db import fetch_active_rc_model_params, fetch_building, fetch_floor, fetch_instrumented_room_ids, fetch_room, fetch_room_adjacencies, fetch_sensor_readings, get_engine, insert_rc_model_params
from .rc import FitResult, fit_rc, robust_one_step_ahead_rmse
from .zone_model import ZoneModelSanityError, build_zone_model

@dataclass(frozen=True)
class CalibrationOutcome:
    room_id: str
    accepted: bool
    reason: str
    fit: FitResult | None
    version: int | None
    anomaly_threshold_c: float | None
    data_window_start: datetime | None
    data_window_end: datetime | None

def _anomaly_threshold(rmse_validation_c: float) -> float:
    return max(3.0 * rmse_validation_c, 1.0)

def evaluate_calibration(t_measured_c: np.ndarray, t_ext_c: np.ndarray, q_solar_w: np.ndarray, q_occ_w: np.ndarray, q_hvac_w: np.ndarray, r_bounds: tuple[float, float], c_bounds: tuple[float, float], r_initial_guess: float, c_initial_guess: float, previous_rmse_c: float | None, train_fraction: float=0.7, force_accept: bool=False) -> tuple[FitResult, float, bool, str]:
    n = len(t_ext_c)
    split = int(n * train_fraction)
    if split < 2 or n - split < 2:
        raise ValueError(f'not enough samples to split: n={n}, split={split}')
    fit = fit_rc(t_measured_c=t_measured_c[:split + 1], t_ext_c=t_ext_c[:split], q_solar_w=q_solar_w[:split], q_occ_w=q_occ_w[:split], q_hvac_w=q_hvac_w[:split], r_bounds=r_bounds, c_bounds=c_bounds, r_initial_guess=r_initial_guess, c_initial_guess=c_initial_guess, horizon_steps=constants.CALIBRATION_FIT_HORIZON_STEPS)
    validation_rmse = robust_one_step_ahead_rmse(fit.r_k_per_w, fit.c_j_per_k, t_measured_c[split:], t_ext_c[split:], q_solar_w[split:], q_occ_w[split:], q_hvac_w[split:])
    if previous_rmse_c is None:
        return (fit, validation_rmse, True, 'first calibration for this room')
    if force_accept:
        return (fit, validation_rmse, True, f'validation RMSE {validation_rmse:.4f} (force_accept, previous {previous_rmse_c:.4f})')
    if validation_rmse < previous_rmse_c:
        return (fit, validation_rmse, True, f'validation RMSE {validation_rmse:.4f} < previous {previous_rmse_c:.4f}')
    return (fit, validation_rmse, False, f'validation RMSE {validation_rmse:.4f} >= previous {previous_rmse_c:.4f}, keeping old version')

def calibrate_room(engine: Engine, room_id: str, window_days: int=21, now: datetime | None=None, force_accept: bool=False) -> CalibrationOutcome:
    now = now or datetime.now(timezone.utc)
    window_start = now - timedelta(days=window_days)
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)
    prior = build_zone_model(room, floor, building, adjacencies)
    active = fetch_active_rc_model_params(engine, room_id)
    r_initial_guess = active.r_lumped if active is not None else prior.r_lumped_k_per_w
    c_initial_guess = active.c_lumped if active is not None else prior.c_lumped_j_per_k
    previous_rmse = active.rmse_validation if active is not None else None
    next_version = active.version + 1 if active is not None else 1
    readings = fetch_sensor_readings(engine, room_id, window_start, now)
    n_samples = len(readings.ts)
    if n_samples < constants.CALIBRATION_MIN_SAMPLES:
        return CalibrationOutcome(room_id=room_id, accepted=False, reason=f'only {n_samples} samples in window, need >= {constants.CALIBRATION_MIN_SAMPLES}', fit=None, version=None, anomaly_threshold_c=None, data_window_start=None, data_window_end=None)
    fit, validation_rmse, accepted, reason = evaluate_calibration(t_measured_c=readings.temp_measured_c, t_ext_c=readings.temp_ext_c[:-1], q_solar_w=readings.q_solar_w[:-1], q_occ_w=readings.q_occ_w[:-1], q_hvac_w=readings.q_hvac_w[:-1], r_bounds=(constants.R_LUMPED_MIN_K_PER_W, constants.R_LUMPED_MAX_K_PER_W), c_bounds=(constants.C_LUMPED_MIN_J_PER_K, constants.C_LUMPED_MAX_J_PER_K), r_initial_guess=r_initial_guess, c_initial_guess=c_initial_guess, previous_rmse_c=previous_rmse, force_accept=force_accept)
    if not accepted:
        return CalibrationOutcome(room_id=room_id, accepted=False, reason=reason, fit=fit, version=None, anomaly_threshold_c=None, data_window_start=readings.ts[0], data_window_end=readings.ts[-1])
    threshold = _anomaly_threshold(validation_rmse)
    insert_rc_model_params(engine, room_id, next_version, fit.r_k_per_w, fit.c_j_per_k, validation_rmse, threshold, readings.ts[0], readings.ts[-1])
    return CalibrationOutcome(room_id=room_id, accepted=True, reason=reason, fit=FitResult(fit.r_k_per_w, fit.c_j_per_k, validation_rmse), version=next_version, anomaly_threshold_c=threshold, data_window_start=readings.ts[0], data_window_end=readings.ts[-1])

def run_calibration_sweep(engine: Engine, building_id: str, window_days: int=21, force_accept: bool=False) -> list[CalibrationOutcome]:
    outcomes = []
    for room_id in fetch_instrumented_room_ids(engine, building_id):
        try:
            outcomes.append(calibrate_room(engine, room_id, window_days=window_days, force_accept=force_accept))
        except (ZoneModelSanityError, LookupError) as exc:
            outcomes.append(CalibrationOutcome(room_id=room_id, accepted=False, reason=f'skipped: {exc}', fit=None, version=None, anomaly_threshold_c=None, data_window_start=None, data_window_end=None))
    return outcomes

def sagemaker_entry_point(event: dict[str, Any], context: Any=None) -> dict[str, Any]:
    engine = get_engine()
    building_id = event['building_id']
    window_days = int(event.get('window_days', 21))
    outcomes = run_calibration_sweep(engine, building_id, window_days=window_days)
    return {'building_id': building_id, 'rooms': [{'room_id': o.room_id, 'accepted': o.accepted, 'reason': o.reason, 'version': o.version, 'rmse_validation': o.fit.rmse_c if o.fit else None} for o in outcomes]}
