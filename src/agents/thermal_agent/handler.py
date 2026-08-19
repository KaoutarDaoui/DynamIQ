from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
import numpy as np
from . import constants
from .anomaly import AnomalyCheckResult, run_anomaly_pipeline
from .db import fetch_active_rc_model_params, fetch_building, fetch_floor, fetch_instrumented_room_ids, fetch_latest_applied_action_decision, fetch_latest_sensor_readings, fetch_room, fetch_room_adjacencies, get_engine, insert_mpc_schedule_rows
from .carbon import get_forecast as get_carbon_forecast
from .mpc import MpcInputs, MpcSolution, solve
from .weather import get_forecast as get_weather_forecast, solar_gain_w
from .zone_model import window_area_by_direction

@dataclass(frozen=True)
class FastLoopResult:
    room_id: str
    ran_control: bool
    reason: str
    mpc_status: str | None
    comfort_violated: bool | None
    anomaly: AnomalyCheckResult | None

def _total_solar_gain_w(room, adjacencies, weather_fc, latitude: float, longitude: float) -> np.ndarray:
    window_areas = window_area_by_direction(room, adjacencies)
    n = len(weather_fc.timestamps)
    total = np.zeros(n)
    for direction, area_m2 in window_areas.items():
        if area_m2 <= 0.0:
            continue
        total += solar_gain_w(direction, latitude, longitude, weather_fc.timestamps, weather_fc.ghi_w_m2, area_m2)
    return total

def run_fast_loop_for_room(engine, room_id: str, occupied: np.ndarray, now: datetime | None=None, offline: bool=False) -> FastLoopResult:
    now = now or datetime.now(timezone.utc)
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)
    active_model = fetch_active_rc_model_params(engine, room_id)
    if active_model is None:
        anomaly_result = run_anomaly_pipeline(engine, room_id, occupied=bool(occupied[0]))
        return FastLoopResult(room_id, False, 'no active rc_model_params (cold start)', None, None, anomaly_result)
    latest = fetch_latest_sensor_readings(engine, room_id, n=1)
    if len(latest.ts) == 0:
        anomaly_result = run_anomaly_pipeline(engine, room_id, occupied=bool(occupied[0]))
        return FastLoopResult(room_id, False, 'no sensor reading available', None, None, anomaly_result)
    t_current_c = float(latest.temp_measured_c[-1])
    weather_fc = get_weather_forecast(building.latitude, building.longitude, horizon_hours=24, offline=offline, now=now)
    carbon_fc = get_carbon_forecast(building.country_code, horizon_hours=24, offline=offline, now=now)
    n = len(weather_fc.timestamps)
    q_solar_w = _total_solar_gain_w(room, adjacencies, weather_fc, building.latitude, building.longitude)
    capacity_persons = room.area_m2 / constants.OCCUPANT_DENSITY_M2_PER_PERSON
    q_occ_w = np.where(occupied[:n], capacity_persons * constants.OCCUPANT_SENSIBLE_HEAT_W, 0.0)
    hvac = room.config_json.get('hvac', {})
    applied = fetch_latest_applied_action_decision(engine, room_id)
    setpoint_offset_c = 0.0
    if applied is not None:
        if applied.get('action_type') == 'setpoint_change' and isinstance(applied.get('delta_c'), (int, float)):
            setpoint_offset_c = float(applied['delta_c'])
        else:
            setpoint_offset_c = 0.0
    mpc_inputs = MpcInputs(timestamps=weather_fc.timestamps, t_current_c=t_current_c, t_ext_c=weather_fc.temp_ext_c, q_solar_w=q_solar_w, q_occ_w=q_occ_w, occupied=occupied[:n].astype(bool), price_currency_per_kwh=constants.TARIFF_CURRENCY_PER_KWH, carbon_gco2_per_kwh=carbon_fc.carbon_intensity_gco2_per_kwh, r_k_per_w=active_model.r_lumped, c_j_per_k=active_model.c_lumped, capacity_kw=float(hvac['capacity_kw']), cop_cooling=float(hvac['cop_cooling']), setpoint_offset_c=setpoint_offset_c)
    solution: MpcSolution = solve(mpc_inputs)
    insert_mpc_schedule_rows(engine, room_id, now, active_model.version, solution.timestamps, solution.setpoint_c, solution.predicted_temp_c, solution.predicted_kwh, solution.predicted_gco2)
    anomaly_result = run_anomaly_pipeline(engine, room_id, occupied=bool(occupied[0]))
    return FastLoopResult(room_id, True, 'solved and scheduled', solution.status, solution.comfort_violated, anomaly_result)

def run_fast_loop_for_building(engine, building_id: str, occupied_by_room: dict[str, np.ndarray], now: datetime | None=None, offline: bool=False) -> list[FastLoopResult]:
    results = []
    for room_id in fetch_instrumented_room_ids(engine, building_id):
        occupied = occupied_by_room.get(room_id)
        if occupied is None:
            results.append(FastLoopResult(room_id, False, 'no occupancy schedule supplied', None, None, None))
            continue
        results.append(run_fast_loop_for_room(engine, room_id, occupied, now=now, offline=offline))
    return results

def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    engine = get_engine()
    building_id = event['building_id']
    occupied_by_room = {room_id: np.array(flags, dtype=bool) for room_id, flags in event['occupied_by_room'].items()}
    offline = bool(event.get('offline', False))
    results = run_fast_loop_for_building(engine, building_id, occupied_by_room, offline=offline)
    return {'building_id': building_id, 'rooms': [{'room_id': r.room_id, 'ran_control': r.ran_control, 'reason': r.reason, 'mpc_status': r.mpc_status, 'comfort_violated': r.comfort_violated, 'anomaly_stage': r.anomaly.stage if r.anomaly else None} for r in results]}
