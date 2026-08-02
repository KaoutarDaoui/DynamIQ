from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
import numpy as np
from sqlalchemy import Engine
from . import constants
from .db import RcModelParamsRecord, close_anomaly, fetch_active_rc_model_params, fetch_latest_sensor_readings, fetch_open_anomaly, fetch_sensor_readings, insert_anomaly
from .rc import one_step_ahead_predictions
Stage = Literal['sensor_fault', 'comfort_violation', 'thermal_anomaly', 'ok', 'cold_start']

@dataclass(frozen=True)
class AnomalyCheckResult:
    room_id: str
    stage: Stage
    detail: str
    anomaly_id: int | None = None

def check_sensor_validity(room_id: str, readings_last_2h) -> AnomalyCheckResult | None:
    if len(readings_last_2h.ts) == 0:
        return AnomalyCheckResult(room_id, 'sensor_fault', 'no reading available')
    latest_ts = readings_last_2h.ts[-1]
    latest_temp = readings_last_2h.temp_measured_c[-1]
    now = datetime.now(timezone.utc)
    if latest_ts.tzinfo is None:
        latest_ts = latest_ts.replace(tzinfo=timezone.utc)
    if now - latest_ts > timedelta(minutes=constants.SENSOR_MAX_STALENESS_MINUTES):
        return AnomalyCheckResult(room_id, 'sensor_fault', f'reading is stale: {latest_ts.isoformat()}')
    if not constants.SENSOR_VALID_MIN_C <= latest_temp <= constants.SENSOR_VALID_MAX_C:
        return AnomalyCheckResult(room_id, 'sensor_fault', f'reading {latest_temp}C outside physical range')
    stuck_window_start = latest_ts - timedelta(hours=constants.SENSOR_STUCK_WINDOW_HOURS)
    in_window = [t for t, ts in zip(readings_last_2h.temp_measured_c, readings_last_2h.ts) if (ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts) >= stuck_window_start]
    if len(in_window) >= 2 and len(set(in_window)) == 1:
        span_hours = (latest_ts - (readings_last_2h.ts[0].replace(tzinfo=timezone.utc) if readings_last_2h.ts[0].tzinfo is None else readings_last_2h.ts[0])).total_seconds() / 3600.0
        if span_hours >= constants.SENSOR_STUCK_WINDOW_HOURS:
            return AnomalyCheckResult(room_id, 'sensor_fault', f'byte-identical reading for >= {constants.SENSOR_STUCK_WINDOW_HOURS}h')
    return None

def check_comfort_violation(room_id: str, latest_temp_c: float, occupied: bool) -> AnomalyCheckResult | None:
    if not occupied:
        return None
    t_min, t_max = (constants.T_MIN_OCCUPIED_C, constants.T_MAX_OCCUPIED_C)
    if latest_temp_c < t_min or latest_temp_c > t_max:
        return AnomalyCheckResult(room_id, 'comfort_violation', f'T={latest_temp_c}C outside occupied bounds [{t_min}, {t_max}]')
    return None

def check_thermal_anomaly(engine: Engine, room_id: str) -> AnomalyCheckResult:
    model = fetch_active_rc_model_params(engine, room_id)
    if model is None:
        return AnomalyCheckResult(room_id, 'cold_start', 'no validated rc_model_params yet -- log-only')
    n_needed = constants.ANOMALY_CONSECUTIVE_SAMPLES + 1
    readings = fetch_latest_sensor_readings(engine, room_id, n_needed)
    if len(readings.ts) < n_needed:
        return AnomalyCheckResult(room_id, 'cold_start', f'only {len(readings.ts)} recent samples, need {n_needed}')
    predicted = one_step_ahead_predictions(model.r_lumped, model.c_lumped, readings.temp_measured_c, readings.temp_ext_c[:-1], readings.q_solar_w[:-1], readings.q_occ_w[:-1], readings.q_hvac_w[:-1])
    residuals = readings.temp_measured_c[1:] - predicted
    threshold = model.anomaly_threshold_c
    clear_threshold = constants.ANOMALY_CLEAR_FRACTION * threshold
    now = datetime.now(timezone.utc)
    open_anomaly = fetch_open_anomaly(engine, room_id, 'thermal_anomaly')
    all_over = bool(np.all(np.abs(residuals) > threshold))
    all_under_clear = bool(np.all(np.abs(residuals) < clear_threshold))
    if open_anomaly is None:
        if all_over:
            trace = [{'ts': ts.isoformat(), 'residual_c': float(r)} for ts, r in zip(readings.ts[1:], residuals)]
            anomaly_id = insert_anomaly(engine, room_id, 'thermal_anomaly', now, None, float(residuals[-1]), trace, threshold, model.version)
            return AnomalyCheckResult(room_id, 'thermal_anomaly', f'raised: {constants.ANOMALY_CONSECUTIVE_SAMPLES} consecutive |residual|>{threshold:.3f}', anomaly_id)
        return AnomalyCheckResult(room_id, 'ok', f'residuals within threshold (latest={residuals[-1]:.3f})')
    if all_under_clear:
        close_anomaly(engine, open_anomaly.id, now)
        return AnomalyCheckResult(room_id, 'ok', 'cleared: consecutive |residual| < 0.5*threshold', open_anomaly.id)
    return AnomalyCheckResult(room_id, 'thermal_anomaly', 'still open, hysteresis band not yet cleared', open_anomaly.id)

def run_anomaly_pipeline(engine: Engine, room_id: str, occupied: bool) -> AnomalyCheckResult:
    readings = fetch_latest_sensor_readings(engine, room_id, n=int(constants.SENSOR_STUCK_WINDOW_HOURS * 4) + 1)
    sensor_result = check_sensor_validity(room_id, readings)
    if sensor_result is not None:
        return sensor_result
    latest_temp = float(readings.temp_measured_c[-1])
    comfort_result = check_comfort_violation(room_id, latest_temp, occupied)
    if comfort_result is not None:
        return comfort_result
    return check_thermal_anomaly(engine, room_id)

@dataclass(frozen=True)
class DriftCheckResult:
    room_id: str
    should_recalibrate: bool
    mean_signed_residual_c: float
    detail: str

def check_drift(engine: Engine, room_id: str, now: datetime | None=None) -> DriftCheckResult:
    now = now or datetime.now(timezone.utc)
    model = fetch_active_rc_model_params(engine, room_id)
    if model is None:
        return DriftCheckResult(room_id, False, 0.0, 'no active model yet, cannot assess drift')
    window_start = now - timedelta(days=constants.DRIFT_WINDOW_DAYS)
    readings = fetch_sensor_readings(engine, room_id, window_start, now)
    if len(readings.ts) < 2:
        return DriftCheckResult(room_id, False, 0.0, 'not enough recent samples to assess drift')
    predicted = one_step_ahead_predictions(model.r_lumped, model.c_lumped, readings.temp_measured_c, readings.temp_ext_c[:-1], readings.q_solar_w[:-1], readings.q_occ_w[:-1], readings.q_hvac_w[:-1])
    residuals = readings.temp_measured_c[1:] - predicted
    mean_residual = float(np.mean(residuals))
    drift_bound = constants.DRIFT_FRACTION_OF_RMSE * model.rmse_validation
    should_recalibrate = abs(mean_residual) > drift_bound
    return DriftCheckResult(room_id, should_recalibrate, mean_residual, f'mean signed residual {mean_residual:.4f}C vs drift bound {drift_bound:.4f}C')
