"""Simulate a live sensor feed: writes one row per instrumented room to
sensor_readings on a fixed interval (default every 2 minutes), evolving each
room's temperature with the same RC physics used elsewhere in Agent 2. Each
tick has a chance of reporting a faulty value instead of a real one, to
exercise the anomaly pipeline against noisy/broken sensors.

Anomaly detection (run_anomaly_pipeline) runs right here, synchronously,
immediately after each room's reading commits -- this is what "detection
every 2min, right after generation" actually means: not a separate process
polling on its own out-of-phase timer, but the check running in the same
breath as the write it's checking. run_orchestration_loop.py no longer
duplicates this -- calibration and MPC still live there, but anomaly
detection's only real driver is this script.

With no --building-id, simulates every instrumented room in every building
in the database (this is the normal way to run it), and rescans for newly
added rooms/buildings every tick so a room added after this starts (e.g.
via onboarding) joins the feed on its own -- no restart needed.

Usage:
    python scripts/simulate_live_sensors.py
    python scripts/simulate_live_sensors.py --building-id djezzy-hq
    python scripts/simulate_live_sensors.py --room-id djezzy-hq-floor-2-room-01 --iterations 5
"""
from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import numpy as np
from sqlmodel import Session

from agents.thermal_agent import constants
from agents.thermal_agent import rc
from agents.thermal_agent.anomaly import run_anomaly_pipeline
from agents.thermal_agent.db import (
    BuildingRecord,
    FloorRecord,
    RoomRecord,
    SensorReadingsTable,
    fetch_active_rc_model_params,
    fetch_all_building_ids,
    fetch_building,
    fetch_floor,
    fetch_instrumented_room_ids,
    fetch_latest_sensor_readings,
    fetch_room,
    fetch_room_adjacencies,
    get_engine,
)
from agents.thermal_agent.weather import get_forecast as get_weather_forecast, solar_gain_w
from agents.thermal_agent.zone_model import build_zone_model, window_area_by_direction

FAULT_KINDS = ("spike", "stuck", "out_of_range", "noise_burst")


@dataclass
class RoomState:
    room: RoomRecord
    floor: FloorRecord
    building: BuildingRecord
    adjacencies: list
    r_k_per_w: float
    c_j_per_k: float
    t_true_c: float
    last_reported_c: float


def _load_room_state(engine, room_id: str) -> RoomState:
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)

    active = fetch_active_rc_model_params(engine, room_id)
    if active is not None:
        r_k_per_w, c_j_per_k = active.r_lumped, active.c_lumped
    else:
        model = build_zone_model(room, floor, building, adjacencies)
        r_k_per_w, c_j_per_k = model.r_lumped_k_per_w, model.c_lumped_j_per_k

    latest = fetch_latest_sensor_readings(engine, room_id, n=1)
    t0 = float(latest.temp_measured_c[-1]) if len(latest.ts) else 22.0
    return RoomState(room, floor, building, adjacencies, r_k_per_w, c_j_per_k, t0, t0)


def _weather_now(state: RoomState, now: datetime, offline: bool) -> tuple[float, float]:
    # horizon_hours=1 is enough to get a single "now" sample; solar_gain_w
    # needs the same timestamp/ghi pair build_zone_model's callers use.
    weather_fc = get_weather_forecast(state.building.latitude, state.building.longitude, horizon_hours=1, offline=offline, now=now)
    window_areas = window_area_by_direction(state.room, state.adjacencies)
    q_solar_w = 0.0
    for direction, area_m2 in window_areas.items():
        if area_m2 <= 0.0:
            continue
        gain = solar_gain_w(direction, state.building.latitude, state.building.longitude, weather_fc.timestamps, weather_fc.ghi_w_m2, area_m2)
        q_solar_w += float(gain[0])
    return float(weather_fc.temp_ext_c[0]), q_solar_w


def _hvac_gain_w(state: RoomState, occupied: bool) -> float:
    # Cooling-only bang-bang thermostat, matching the cop_cooling-only HVAC
    # config the rest of Agent 2 assumes for this building's climate.
    if not occupied:
        return 0.0
    hvac_cfg = state.room.config_json.get("hvac", {})
    capacity_w = float(hvac_cfg.get("capacity_kw", 3.5)) * 1000.0
    target_c = (constants.T_MIN_OCCUPIED_C + constants.T_MAX_OCCUPIED_C) / 2.0
    if state.t_true_c > target_c + 0.5:
        return -capacity_w
    return 0.0


def _apply_fault(rng: np.random.Generator, t_measured_c: float, last_reported_c: float) -> tuple[float, str]:
    kind = rng.choice(FAULT_KINDS)
    if kind == "spike":
        sign = rng.choice([-1.0, 1.0])
        return t_measured_c + sign * rng.uniform(6.0, 15.0), kind
    if kind == "stuck":
        return last_reported_c, kind
    if kind == "out_of_range":
        low_side = rng.uniform(-15.0, constants.SENSOR_VALID_MIN_C - 1.0)
        high_side = rng.uniform(constants.SENSOR_VALID_MAX_C + 1.0, 70.0)
        return float(rng.choice([low_side, high_side])), kind
    return t_measured_c + rng.normal(0.0, 4.0), kind  # noise_burst


def _tick(engine, session: Session, state: RoomState, now: datetime, interval_s: float, mistake_probability: float, offline: bool, rng: np.random.Generator) -> None:
    occupied = 8 <= now.hour < 18
    capacity_persons = state.room.area_m2 / constants.OCCUPANT_DENSITY_M2_PER_PERSON
    q_occ_w = capacity_persons * constants.OCCUPANT_SENSIBLE_HEAT_W if occupied else 0.0
    q_hvac_w = _hvac_gain_w(state, occupied)
    t_ext_c, q_solar_w = _weather_now(state, now, offline)

    t_true_new = rc.step(state.t_true_c, t_ext_c, q_solar_w, q_occ_w, q_hvac_w, state.r_k_per_w, state.c_j_per_k, dt_s=interval_s)
    t_measured = t_true_new + rng.normal(0.0, 0.3)

    fault_kind = None
    if rng.random() < mistake_probability:
        t_measured, fault_kind = _apply_fault(rng, float(t_measured), state.last_reported_c)

    session.add(SensorReadingsTable(room_id=state.room.room_id, ts=now, temp_measured_c=float(t_measured), temp_ext_c=t_ext_c, q_solar_w=q_solar_w, q_occ_w=q_occ_w, q_hvac_w=q_hvac_w))
    session.commit()

    state.t_true_c = t_true_new
    state.last_reported_c = float(t_measured)

    flag = f"  FAULT({fault_kind})" if fault_kind else ""
    print(f"[{now.isoformat()}] {state.room.room_id:32s} temp={t_measured:6.2f}C ext={t_ext_c:5.1f}C occ={int(occupied)}{flag}")

    # Run anomaly detection right here, synchronously, immediately after
    # this room's reading commits -- rather than on a separately-timed
    # process whose own 2min cycle drifts out of phase with generation and
    # could check data that's up to a full interval stale.
    try:
        anomaly_result = run_anomaly_pipeline(engine, state.room.room_id, occupied=occupied)
        if anomaly_result.stage not in ("ok", "cold_start"):
            print(f"    -> anomaly stage={anomaly_result.stage} ({anomaly_result.detail})")
    except Exception as exc:
        print(f"    ! anomaly check failed for {state.room.room_id}: {exc!r}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--building-id", default=None, help="Limit to one building. Defaults to every building in the database.")
    parser.add_argument("--room-id", action="append", default=None, help="Limit to specific room id(s); repeatable. Defaults to all instrumented rooms in --building-id (or every building).")
    parser.add_argument("--interval-seconds", type=float, default=120.0)
    parser.add_argument("--mistake-probability", type=float, default=0.07)
    parser.add_argument("--iterations", type=int, default=None, help="Stop after this many ticks per room instead of running forever.")
    parser.add_argument("--online-weather", action="store_true", help="Fetch real weather instead of the offline sinusoidal model.")
    parser.add_argument("--seed", type=int, default=None)
    return parser.parse_args()


def _discover_room_ids(engine, args: argparse.Namespace, verbose: bool) -> list[str]:
    if args.room_id:
        return args.room_id
    building_ids = [args.building_id] if args.building_id else fetch_all_building_ids(engine)
    room_ids = []
    for building_id in building_ids:
        ids = fetch_instrumented_room_ids(engine, building_id)
        if not ids:
            if verbose:
                print(f"  (skipping {building_id!r}: no instrumented rooms)")
            continue
        room_ids.extend(ids)
    return room_ids


def main() -> None:
    args = parse_args()
    engine = get_engine()
    rng = np.random.default_rng(args.seed)
    # Only auto-discover (and keep rescanning for new rooms every tick) when
    # the caller didn't pin an explicit --room-id list.
    auto_discover = not args.room_id

    room_ids = _discover_room_ids(engine, args, verbose=True)
    if not room_ids:
        raise SystemExit("No instrumented rooms found.")

    states: dict[str, RoomState] = {}
    for room_id in room_ids:
        try:
            states[room_id] = _load_room_state(engine, room_id)
        except Exception as exc:  # e.g. bad building geometry -- don't take the whole feed down over one room
            print(f"  ! failed to load {room_id}, skipping it: {exc!r}")
    if not states:
        raise SystemExit("No room could be loaded (all failed -- see errors above).")
    print(f"Simulating {len(states)} room(s) every {args.interval_seconds:.0f}s, {args.mistake_probability:.0%} chance of a faulty reading per tick.")

    iteration = 0
    with Session(engine) as session:
        try:
            while args.iterations is None or iteration < args.iterations:
                if auto_discover and iteration > 0:
                    for room_id in _discover_room_ids(engine, args, verbose=False):
                        if room_id not in states:
                            try:
                                states[room_id] = _load_room_state(engine, room_id)
                                print(f"  + new room detected: {room_id}, joining the simulation")
                            except Exception as exc:  # e.g. missing building lat/long -- don't take the whole feed down
                                print(f"  ! failed to load {room_id}, skipping it: {exc!r}")
                now = datetime.now(timezone.utc)
                for room_id, state in list(states.items()):
                    try:
                        _tick(engine, session, state, now, args.interval_seconds, args.mistake_probability, not args.online_weather, rng)
                    except Exception as exc:  # keep simulating every other room even if one is broken
                        print(f"  ! tick failed for {room_id}, skipping it this round: {exc!r}")
                iteration += 1
                if args.iterations is None or iteration < args.iterations:
                    time.sleep(args.interval_seconds)
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
