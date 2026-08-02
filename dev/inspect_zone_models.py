from __future__ import annotations
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))
from dotenv import load_dotenv
from agents.thermal_agent.db import fetch_building, fetch_floor, fetch_room, fetch_room_adjacencies, get_engine
from agents.thermal_agent.zone_model import ZoneModelSanityError, build_zone_model
load_dotenv(Path(__file__).resolve().parent / '.env.dev')
ROOM_IDS = ['room-a101', 'room-b205', 'room-c301']

def main() -> None:
    engine = get_engine()
    rows = []
    for room_id in ROOM_IDS:
        room = fetch_room(engine, room_id)
        floor = fetch_floor(engine, room.floor_id)
        building = fetch_building(engine, room.building_id)
        adjacencies = fetch_room_adjacencies(engine, room_id)
        try:
            model = build_zone_model(room, floor, building, adjacencies)
            rows.append((room_id, f'{model.r_lumped_k_per_w:.5f}', f'{model.c_lumped_j_per_k:,.0f}', f'{model.tau_hours:.2f}', 'top' if model.is_top_floor else '-', 'ok'))
        except ZoneModelSanityError as exc:
            rows.append((room_id, '-', '-', '-', '-', f'SKIPPED: {exc}'))
    headers = ('room_id', 'R_lumped (K/W)', 'C_lumped (J/K)', 'tau (h)', 'top_floor', 'status')
    widths = [max((len(str(row[i])) for row in [headers] + rows)) for i in range(len(headers))]
    fmt = '  '.join((f'{{:<{w}}}' for w in widths))
    print(fmt.format(*headers))
    print(fmt.format(*('-' * w for w in widths)))
    for row in rows:
        print(fmt.format(*row))
if __name__ == '__main__':
    main()
