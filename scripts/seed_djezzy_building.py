from __future__ import annotations
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from sqlalchemy import text

from agents.thermal_agent.calibrate import calibrate_room
from agents.thermal_agent.db import (
    BuildingRecord,
    FloorRecord,
    RoomRecord,
    fetch_building,
    fetch_floor,
    fetch_room,
    fetch_room_adjacencies,
    get_engine,
)
from agents.thermal_agent.rc import generate_synthetic_scenario
from agents.thermal_agent.zone_model import build_zone_model

BUILDING_ID = "djezzy-hq"
DEFAULT_ORG_ID = "ORG_AMAZON"
BUILDING = {
    "building_id": BUILDING_ID,
    "name": "Djezzy HQ Annex",
    "address": "Hydra, Algiers",
    "latitude": 36.749,
    "longitude": 3.033,
    "total_floors": 3,
    "country_code": "DZ",
    "org_id": DEFAULT_ORG_ID,
}
FLOORS = [
    {"floor_id": f"{BUILDING_ID}-floor-1", "building_id": BUILDING_ID, "level": 1, "name": "Ground Floor"},
    {"floor_id": f"{BUILDING_ID}-floor-2", "building_id": BUILDING_ID, "level": 2, "name": "Office Floor"},
    {"floor_id": f"{BUILDING_ID}-floor-3", "building_id": BUILDING_ID, "level": 3, "name": "Executive Floor"},
]

_R_WALL = 1.8
_WINDOW_U = 3.5
_HVAC_M2_PER_KW = 13.0


def _envelope(**wall_m2: float) -> dict:
    return {f"{d}_wall_m2": wall_m2.get(d, 0.0) for d in ("north", "south", "east", "west")}


def _adjacency(*external: str) -> dict:
    return {d: ("external" if d in external else "internal") for d in ("north", "south", "east", "west")}


def _hvac(area_m2: float, setpoint_c: float, cop: float) -> dict:
    return {
        "type": "split_unit",
        "capacity_kw": round(max(area_m2 / _HVAC_M2_PER_KW, 1.0), 1),
        "cop_cooling": cop,
        "setpoint_occupied_c": setpoint_c,
    }


def _room(floor_level: int, seq: int, label: str, room_type: str, area_m2: float, external: tuple[str, ...], orientation: str, instrumented: bool) -> dict:
    side_m = area_m2**0.5
    wall_m2 = {d: round(side_m * 3.0, 1) for d in external}
    room_id = f"{BUILDING_ID}-floor-{floor_level}-room-{seq:02d}"
    return {
        "room_id": room_id,
        "floor_id": f"{BUILDING_ID}-floor-{floor_level}",
        "room_label": label,
        "room_type": room_type,
        "area_m2": area_m2,
        "volume_m3": round(area_m2 * 3.0, 1),
        "primary_orientation": orientation,
        "r_wall": _R_WALL,
        "c_zone": round(area_m2 * 3.0 * 1206.0, 1),
        "sensor_id": f"demo-esp32-djz-{seq + (floor_level - 1) * 6:02d}" if instrumented else None,
        "config_json": {
            "envelope": _envelope(**wall_m2),
            "thermal": {"thermal_mass": "heavy", "wall_r_value": _R_WALL, "window_u_value": _WINDOW_U, "estimated_C_zone": round(area_m2 * 3.0 * 1206.0, 1)},
            "hvac": _hvac(area_m2, 22.0, 2.9),
            "adjacency": _adjacency(*external),
        },
    }


ROOMS = [
    _room(1, 1, "Reception", "reception", 35.0, ("south", "west"), "south", instrumented=True),
    _room(1, 2, "Meeting Room A1", "meeting_room", 22.0, ("north",), "north", instrumented=False),
    _room(1, 3, "Open Space A", "open_space", 60.0, ("east",), "east", instrumented=False),
    _room(1, 4, "Kitchen", "kitchen", 18.0, (), "internal", instrumented=False),
    _room(1, 5, "Server Room", "server_room", 15.0, (), "internal", instrumented=False),
    _room(1, 6, "Storage", "storage", 12.0, (), "internal", instrumented=False),
    _room(2, 1, "Open Space B", "open_space", 55.0, ("west",), "west", instrumented=True),
    _room(2, 2, "Bureau 201", "office", 16.0, ("south",), "south", instrumented=False),
    _room(2, 3, "Bureau 202", "office", 16.0, ("south",), "south", instrumented=False),
    _room(2, 4, "Meeting Room B2", "meeting_room", 20.0, ("east",), "east", instrumented=False),
    _room(2, 5, "Print Room", "print_room", 10.0, (), "internal", instrumented=False),
    _room(2, 6, "Toilets F2", "toilets", 14.0, (), "internal", instrumented=False),
    _room(3, 1, "Executive Office", "executive_office", 22.0, ("north",), "north", instrumented=True),
    _room(3, 2, "Open Office C", "open_space", 25.0, ("south",), "south", instrumented=False),
    _room(3, 3, "Meeting Room C3", "meeting_room", 18.0, ("east",), "east", instrumented=False),
    _room(3, 4, "Lounge", "lounge", 20.0, ("north",), "north", instrumented=False),
    _room(3, 5, "Archive", "archive", 14.0, (), "internal", instrumented=False),
    _room(3, 6, "Toilets F3", "toilets", 12.0, (), "internal", instrumented=False),
]

CALIBRATION_WINDOW_DAYS = 21


def _validate_zone_models() -> None:
    building = BuildingRecord(building_id=BUILDING_ID, name=BUILDING["name"], latitude=BUILDING["latitude"], longitude=BUILDING["longitude"], total_floors=BUILDING["total_floors"], country_code=BUILDING["country_code"])
    floors_by_id = {f["floor_id"]: FloorRecord(floor_id=f["floor_id"], building_id=BUILDING_ID, level=f["level"], name=f["name"]) for f in FLOORS}
    for room in ROOMS:
        record = RoomRecord(room_id=room["room_id"], floor_id=room["floor_id"], building_id=BUILDING_ID, room_label=room["room_label"], room_type=room["room_type"], area_m2=room["area_m2"], volume_m3=room["volume_m3"], primary_orientation=room["primary_orientation"], r_wall=room["r_wall"], c_zone=room["c_zone"], sensor_id=room["sensor_id"], config_json=room["config_json"])
        model = build_zone_model(record, floors_by_id[room["floor_id"]], building, adjacencies=[])
        print(f"  {room['room_id']:<32} R={model.r_lumped_k_per_w:.5f} K/W  C={model.c_lumped_j_per_k:,.0f} J/K  tau={model.tau_hours:.2f}h  top_floor={model.is_top_floor}")


def main() -> None:
    engine = get_engine()
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM buildings WHERE building_id = :id"), {"id": BUILDING_ID}).first()
    if exists:
        print(f"Building {BUILDING_ID!r} already exists -- aborting, this script is not meant to be re-run.")
        return

    print("Validating zone models against the §5 sanity gate before writing anything:")
    _validate_zone_models()

    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO buildings (building_id, name, address, latitude, longitude, total_floors, country_code, org_id) VALUES (:building_id, :name, :address, :latitude, :longitude, :total_floors, :country_code, :org_id)"),
            BUILDING,
        )
        for floor in FLOORS:
            conn.execute(text("INSERT INTO floors (floor_id, building_id, level, name) VALUES (:floor_id, :building_id, :level, :name)"), floor)
        for room in ROOMS:
            conn.execute(
                text("INSERT INTO rooms (room_id, floor_id, building_id, room_label, room_type, area_m2, volume_m3, primary_orientation, r_wall, c_zone, sensor_id, config_json) VALUES (:room_id, :floor_id, :building_id, :room_label, :room_type, :area_m2, :volume_m3, :primary_orientation, :r_wall, :c_zone, :sensor_id, :config_json)"),
                {**room, "building_id": BUILDING_ID, "config_json": json.dumps(room["config_json"])},
            )
    print(f"\nInserted building {BUILDING_ID!r}: {len(FLOORS)} floors, {len(ROOMS)} rooms.")

    instrumented = [r for r in ROOMS if r["sensor_id"] is not None]
    print(f"\nGenerating {CALIBRATION_WINDOW_DAYS}d of synthetic sensor history for {len(instrumented)} instrumented rooms:")
    now = datetime.now(timezone.utc)
    for room in instrumented:
        room_id = room["room_id"]
        db_room = fetch_room(engine, room_id)
        floor = fetch_floor(engine, db_room.floor_id)
        building = fetch_building(engine, BUILDING_ID)
        adjacencies = fetch_room_adjacencies(engine, room_id)
        model = build_zone_model(db_room, floor, building, adjacencies)
        scenario = generate_synthetic_scenario(model.r_lumped_k_per_w, model.c_lumped_j_per_k, days=CALIBRATION_WINDOW_DAYS, seed=hash(room_id) % (2**31))
        start = now - timedelta(days=CALIBRATION_WINDOW_DAYS)
        n = len(scenario.t_ext_c)
        timestamps = [start + timedelta(seconds=900 * k) for k in range(n + 1)]
        rows = [
            {
                "room_id": room_id,
                "ts": timestamps[k],
                "temp_measured_c": float(scenario.t_measured_c[k]),
                "temp_ext_c": float(scenario.t_ext_c[k]) if k < n else float(scenario.t_ext_c[-1]),
                "q_solar_w": float(scenario.q_solar_w[k]) if k < n else float(scenario.q_solar_w[-1]),
                "q_occ_w": float(scenario.q_occ_w[k]) if k < n else float(scenario.q_occ_w[-1]),
                "q_hvac_w": float(scenario.q_hvac_w[k]) if k < n else float(scenario.q_hvac_w[-1]),
            }
            for k in range(n + 1)
        ]
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO sensor_readings (room_id, ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w) VALUES (:room_id, :ts, :temp_measured_c, :temp_ext_c, :q_solar_w, :q_occ_w, :q_hvac_w)"),
                rows,
            )
        print(f"  {room_id}: {len(rows)} readings, {timestamps[0].date()} .. {timestamps[-1].date()}")

    print("\nRunning real calibration (fit_rc) against the synthetic history for each instrumented room:")
    for room in instrumented:
        outcome = calibrate_room(engine, room["room_id"], window_days=CALIBRATION_WINDOW_DAYS, now=now)
        status = "accepted" if outcome.accepted else "REJECTED"
        rmse = f"{outcome.fit.rmse_c:.4f}" if outcome.fit else "n/a"
        print(f"  {room['room_id']}: {status} (v{outcome.version}) validation_rmse={rmse}C -- {outcome.reason}")


if __name__ == "__main__":
    main()
