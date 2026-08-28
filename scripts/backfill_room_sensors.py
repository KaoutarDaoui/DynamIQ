"""Assign a sensor_id to every room that doesn't have one yet.

fetch_instrumented_room_ids() (used by the simulator, calibration, MPC and
the orchestrator) only picks up rooms where rooms.sensor_id IS NOT NULL. Any
room without one is silently skipped everywhere -- this backfills existing
rooms so the whole pipeline covers every room in every building. New rooms
created by the building agent's onboarding pipeline already get a sensor_id
automatically, so this is only needed for rooms that existed before that.

Safe to re-run: only touches rows where sensor_id IS NULL.

Usage:
    python scripts/backfill_room_sensors.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from sqlmodel import Session, select

from agents.thermal_agent.db import RoomsTable, get_engine


def main() -> None:
    engine = get_engine()
    with Session(engine) as session:
        rooms = session.exec(select(RoomsTable).where(RoomsTable.sensor_id.is_(None))).all()
        if not rooms:
            print("Every room already has a sensor_id.")
            return
        for room in rooms:
            room.sensor_id = f"sensor-{room.room_id}"
            session.add(room)
            print(f"  {room.room_id:40s} -> {room.sensor_id}")
        session.commit()
    print(f"Backfilled sensor_id for {len(rooms)} room(s).")


if __name__ == "__main__":
    main()
