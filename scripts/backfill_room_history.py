"""Backfill synthetic sensor history for instrumented rooms that don't have
enough of it yet for a first RC calibration. See
agents.thermal_agent.history_backfill for what this actually does and why
-- this script is a manual, one-off entry point into the same logic that
run_orchestration_loop.py now also runs automatically every cycle for any
newly-added room.

Safe to re-run: only backfills rooms currently below the sample threshold.

Usage:
    python scripts/backfill_room_history.py
    python scripts/backfill_room_history.py --building-id djezzy-hq
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.thermal_agent.calibrate import calibrate_room
from agents.thermal_agent.db import fetch_all_building_ids, fetch_instrumented_room_ids, get_engine
from agents.thermal_agent.history_backfill import WINDOW_DAYS, backfill_room_history, needs_history_backfill


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--building-id", default=None, help="Limit to one building. Defaults to every building in the database.")
    args = parser.parse_args()

    engine = get_engine()
    now = datetime.now(timezone.utc)
    building_ids = [args.building_id] if args.building_id else fetch_all_building_ids(engine)

    for building_id in building_ids:
        room_ids = fetch_instrumented_room_ids(engine, building_id)
        if not room_ids:
            continue
        for room_id in room_ids:
            if not needs_history_backfill(engine, room_id, now):
                print(f"  {room_id:40s} already has enough history, skipping")
                continue
            n = backfill_room_history(engine, room_id, now)
            outcome = calibrate_room(engine, room_id, window_days=WINDOW_DAYS, now=now)
            status = "accepted" if outcome.accepted else "REJECTED"
            rmse = f"{outcome.fit.rmse_c:.4f}" if outcome.fit else "n/a"
            print(f"  {room_id:40s} backfilled {n} readings -> calibration {status} (v{outcome.version}) rmse={rmse}C -- {outcome.reason}")


if __name__ == "__main__":
    main()
