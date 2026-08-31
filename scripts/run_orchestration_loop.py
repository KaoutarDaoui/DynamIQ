"""Run the full orchestration cycle (calibration-if-due, MPC fast loop,
diagnosis, alerts) for every building on a fixed interval, forever.

Nothing else in this codebase triggers this automatically -- the
orchestrator API (orchestration/api.py) only runs a cycle when something
calls POST /run-cycle, and orchestration/scheduler.py's run_forever() is
never invoked anywhere. This script is that missing driver: it's the thing
that makes "recalibrates automatically via Agent 4" actually true, and
keeps MPC schedules and anomaly diagnosis moving. Anomaly *detection* itself
runs inside simulate_live_sensors.py instead, synchronously right after
each reading is written -- see that script's docstring for why.

Every cycle force-recalibrates every instrumented room and force-accepts the
result (bypassing both the 24h CALIBRATION_INTERVAL_HOURS gate and the
"only accept if RMSE improves" check in calibrate.py), so calibrated_at
advances on every single tick for every room -- matching the interval the
live sensor feed writes at, at the cost of R/C jittering slightly cycle to
cycle instead of only updating on genuine improvement. Pass
--no-force-accept for the normal, gated behaviour instead.

MPC (the fast loop) re-solves on its own, slower cadence
(--mpc-interval-minutes, default orchestration.constants.FAST_LOOP_INTERVAL_MINUTES)
instead of every cycle: fetch_latest_mpc_schedule() always returns the most
recently solved schedule, so re-solving every 2 minutes would replace it
before its later slots ever become "past" and pick up a real sensor
reading -- the "Planned vs actual" chart would only ever show the leading
1-2 points. Solving less often lets a schedule live long enough for actual
readings to accumulate against most of its slots.

Usage:
    python scripts/run_orchestration_loop.py
    python scripts/run_orchestration_loop.py --interval-seconds 120 --building-id djezzy-hq
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import numpy as np

from agents.thermal_agent.calibrate import calibrate_room
from agents.thermal_agent.db import fetch_all_building_ids, fetch_instrumented_room_ids, get_engine
from agents.thermal_agent.history_backfill import backfill_room_history, needs_history_backfill
from orchestration import constants as orch_constants
from orchestration import orchestrate

_OCCUPIED_START_H = 8
_OCCUPIED_END_H = 16
_HORIZON_SLOTS = 96  # 24h at 15-min resolution


def _default_occupied_horizon(now: datetime) -> np.ndarray:
    return np.array(
        [_OCCUPIED_START_H <= (now.hour + int(k / 4)) % 24 < _OCCUPIED_END_H for k in range(_HORIZON_SLOTS)],
        dtype=bool,
    )


def _ensure_history(engine, room_ids: list[str], now: datetime, known_sufficient: set[str], force_accept: bool) -> None:
    # Rooms only ever accumulate readings, so once a room has enough it
    # always will -- cache that so a steady-state cycle doesn't re-run a
    # COUNT query per room. A brand new room (e.g. just onboarded) won't be
    # in the cache yet, gets checked, and -- if it's short on history --
    # gets a synthetic backfill right here so it's calibratable this cycle
    # instead of waiting ~10h for the live 2-min feed to accumulate enough.
    #
    # Each room that becomes sufficient gets calibrated immediately, right
    # here, instead of waiting for every other room in the building to
    # finish its (network-bound, ~1-3min) backfill first: run_full_cycle's
    # calibration sweep only runs after this whole function returns, so
    # without this a building with one slow-to-backfill room would leave
    # every other already-ready room sitting at "awaiting calibration" for
    # no reason. run_full_cycle's sweep still re-calibrates everything
    # afterwards too (that's what keeps calibrated_at fresh every cycle) --
    # this is just about not making a ready room wait its turn.
    for room_id in room_ids:
        if room_id in known_sufficient:
            continue
        try:
            if needs_history_backfill(engine, room_id, now):
                n = backfill_room_history(engine, room_id, now)
                print(f"[{now.isoformat()}]   {room_id}: backfilled {n} synthetic readings (new room, not enough history yet)")
            calibrate_room(engine, room_id, force_accept=force_accept, now=now)
        except Exception as exc:
            # e.g. the room's geometry fails build_zone_model's sanity gate --
            # letting this propagate would abort _run_building before it ever
            # reaches calibration/fast_loop for the *rest* of the building's
            # rooms, every single cycle. Mark it resolved either way so a
            # broken room is skipped (and logged) instead of retried forever.
            print(f"[{now.isoformat()}]   {room_id}: history backfill/calibration failed, skipping this room: {exc!r}")
        known_sufficient.add(room_id)


def _run_building(
    engine,
    building_id: str,
    now: datetime,
    offline: bool,
    force_accept: bool,
    known_sufficient: set[str],
    last_fast_loop: dict[str, datetime],
    mpc_interval_minutes: float,
) -> None:
    room_ids = fetch_instrumented_room_ids(engine, building_id)
    if not room_ids:
        print(f"[{now.isoformat()}]   (skipping {building_id!r}: no instrumented rooms)")
        return
    _ensure_history(engine, room_ids, now, known_sufficient, force_accept)
    occupied_by_room = {room_id: _default_occupied_horizon(now) for room_id in room_ids}
    last = last_fast_loop.get(building_id)
    run_fast_loop = last is None or (now - last) >= timedelta(minutes=mpc_interval_minutes)
    result = orchestrate.run_full_cycle(
        engine, building_id, occupied_by_room, now=now, offline=offline, force_calibration=True, force_accept=force_accept, run_fast_loop=run_fast_loop
    )
    if run_fast_loop:
        last_fast_loop[building_id] = now
    n_cal = len(result.calibration_results or [])
    n_accepted = sum(1 for c in (result.calibration_results or []) if getattr(c, "accepted", False))
    print(
        f"[{now.isoformat()}] {building_id}: calibration={n_accepted}/{n_cal} accepted, "
        f"fast_loop={'ran, ' + str(len(result.fast_loop_results)) + ' room(s)' if run_fast_loop else 'skipped (not due)'}, "
        f"diagnoses={len(result.diagnosis_results)}, alerts={len(result.alerts_dispatched)}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--building-id", action="append", default=None, help="Limit to specific building id(s); repeatable. Defaults to every building.")
    parser.add_argument("--interval-seconds", type=float, default=120.0)
    parser.add_argument("--online-weather", action="store_true", help="Fetch real weather instead of the offline sinusoidal model.")
    parser.add_argument("--no-force-accept", dest="force_accept", action="store_false", help="Use normal gated calibration (24h interval, only accept if RMSE improves) instead of force-refreshing every room every cycle.")
    parser.add_argument("--mpc-interval-minutes", type=float, default=float(orch_constants.FAST_LOOP_INTERVAL_MINUTES), help="How often to re-solve the MPC schedule (separate from --interval-seconds, which is the calibration cadence). Defaults to the system's own FAST_LOOP_INTERVAL_MINUTES.")
    parser.add_argument("--iterations", type=int, default=None, help="Stop after this many cycles instead of running forever -- e.g. --iterations 1 for a single cron-triggered run (GitHub Actions, etc.) instead of a perpetual worker.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    engine = get_engine()
    known_sufficient: set[str] = set()
    last_fast_loop: dict[str, datetime] = {}
    print(f"Running full orchestration cycle every {args.interval_seconds:.0f}s (MPC re-solves every {args.mpc_interval_minutes:.0f}min).")
    try:
        iteration = 0
        while args.iterations is None or iteration < args.iterations:
            cycle_start = time.monotonic()
            now = datetime.now(timezone.utc)
            building_ids = args.building_id or fetch_all_building_ids(engine)
            for building_id in building_ids:
                try:
                    _run_building(
                        engine, building_id, now, offline=not args.online_weather, force_accept=args.force_accept,
                        known_sufficient=known_sufficient, last_fast_loop=last_fast_loop, mpc_interval_minutes=args.mpc_interval_minutes,
                    )
                except Exception as exc:  # keep the loop alive across a bad cycle
                    print(f"[{now.isoformat()}] {building_id}: cycle failed: {exc!r}")
            iteration += 1
            if args.iterations is not None and iteration >= args.iterations:
                break
            elapsed = time.monotonic() - cycle_start
            remaining = args.interval_seconds - elapsed
            if remaining > 0:
                time.sleep(remaining)
            else:
                print(f"[{now.isoformat()}] cycle took {elapsed:.0f}s, longer than the {args.interval_seconds:.0f}s interval -- starting next cycle immediately")
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
