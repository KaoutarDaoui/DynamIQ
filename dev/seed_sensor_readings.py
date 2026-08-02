from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))
from dotenv import load_dotenv
from sqlalchemy import text
from agents.thermal_agent.db import fetch_building, fetch_floor, fetch_room, fetch_room_adjacencies, get_engine
from agents.thermal_agent.rc import generate_synthetic_scenario
from agents.thermal_agent.zone_model import build_zone_model
load_dotenv(Path(__file__).resolve().parent / '.env.dev')

def main() -> None:
    room_id = sys.argv[1] if len(sys.argv) > 1 else 'room-a101'
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 21
    engine = get_engine()
    room = fetch_room(engine, room_id)
    floor = fetch_floor(engine, room.floor_id)
    building = fetch_building(engine, room.building_id)
    adjacencies = fetch_room_adjacencies(engine, room_id)
    model = build_zone_model(room, floor, building, adjacencies)
    print(f'Generating {days}d of synthetic history for {room_id} using its OWN geometric prior as ground truth:')
    print(f'  R_true={model.r_lumped_k_per_w:.5f} K/W  C_true={model.c_lumped_j_per_k:,.0f} J/K  tau={model.tau_hours:.2f}h')
    scenario = generate_synthetic_scenario(model.r_lumped_k_per_w, model.c_lumped_j_per_k, days=days, seed=42)
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    n = len(scenario.t_ext_c)
    timestamps = [start + timedelta(seconds=900 * k) for k in range(n + 1)]
    with engine.begin() as conn:
        conn.execute(text('DELETE FROM sensor_readings WHERE room_id = :room_id'), {'room_id': room_id})
        rows = [{'room_id': room_id, 'ts': timestamps[k], 'temp_measured_c': float(scenario.t_measured_c[k]), 'temp_ext_c': float(scenario.t_ext_c[k]) if k < n else float(scenario.t_ext_c[-1]), 'q_solar_w': float(scenario.q_solar_w[k]) if k < n else float(scenario.q_solar_w[-1]), 'q_occ_w': float(scenario.q_occ_w[k]) if k < n else float(scenario.q_occ_w[-1]), 'q_hvac_w': float(scenario.q_hvac_w[k]) if k < n else float(scenario.q_hvac_w[-1])} for k in range(n + 1)]
        conn.execute(text('INSERT INTO sensor_readings (room_id, ts, temp_measured_c, temp_ext_c, q_solar_w, q_occ_w, q_hvac_w) VALUES (:room_id, :ts, :temp_measured_c, :temp_ext_c, :q_solar_w, :q_occ_w, :q_hvac_w)'), rows)
    print(f'Inserted {len(rows)} sensor_readings rows for {room_id}, {timestamps[0]} .. {timestamps[-1]}')
if __name__ == '__main__':
    main()
