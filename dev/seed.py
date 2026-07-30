from __future__ import annotations
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
load_dotenv(Path(__file__).resolve().parent / '.env.dev')

def _envelope(**wall_m2: float) -> dict:
    return {'north_wall_m2': wall_m2.get('north', 0.0), 'south_wall_m2': wall_m2.get('south', 0.0), 'east_wall_m2': wall_m2.get('east', 0.0), 'west_wall_m2': wall_m2.get('west', 0.0)}
BUILDING = {'building_id': 'esi-algiers', 'name': 'ESI Algiers', 'address': 'Route Nationale 68, Oued Smar, Alger', 'latitude': 36.7538, 'longitude': 3.0588, 'total_floors': 3, 'country_code': 'DZ'}
FLOORS = [{'floor_id': 'floor-1', 'building_id': 'esi-algiers', 'level': 1, 'name': 'Ground Floor'}, {'floor_id': 'floor-2', 'building_id': 'esi-algiers', 'level': 2, 'name': 'Middle Floor'}, {'floor_id': 'floor-3', 'building_id': 'esi-algiers', 'level': 3, 'name': 'Top Floor'}]
_DEFAULT_THERMAL = {'window_u_value': 5.8, 'thermal_mass': 'heavy'}
_DEFAULT_HVAC = {'capacity_kw': 3.5, 'cop_cooling': 2.8, 'setpoint_occupied_c': 22.0}
ROOMS = [{'room_id': 'room-a101', 'floor_id': 'floor-1', 'building_id': 'esi-algiers', 'room_label': 'A101', 'room_type': 'classroom', 'area_m2': 45.0, 'volume_m3': 135.0, 'primary_orientation': 'south', 'r_wall': 1.8, 'c_zone': 135.0 * 1206.0, 'sensor_id': 'esp32-a101', 'config_json': {'envelope': _envelope(north=18.0, south=18.0, east=22.5, west=22.5), 'thermal': _DEFAULT_THERMAL, 'hvac': _DEFAULT_HVAC}}, {'room_id': 'room-b205', 'floor_id': 'floor-2', 'building_id': 'esi-algiers', 'room_label': 'B205', 'room_type': 'classroom', 'area_m2': 40.0, 'volume_m3': 120.0, 'primary_orientation': 'north', 'r_wall': 1.8, 'c_zone': 120.0 * 1206.0, 'sensor_id': 'esp32-b205', 'config_json': {'envelope': _envelope(north=20.0, south=20.0, east=18.0, west=18.0), 'thermal': _DEFAULT_THERMAL, 'hvac': _DEFAULT_HVAC}}, {'room_id': 'room-c301', 'floor_id': 'floor-3', 'building_id': 'esi-algiers', 'room_label': 'C301', 'room_type': 'classroom', 'area_m2': 38.0, 'volume_m3': 114.0, 'primary_orientation': 'west', 'r_wall': 1.8, 'c_zone': 114.0 * 1206.0, 'sensor_id': 'esp32-c301', 'config_json': {'envelope': _envelope(north=17.0, south=17.0, east=19.0, west=19.0), 'thermal': _DEFAULT_THERMAL, 'hvac': _DEFAULT_HVAC}}]
ADJACENCIES = [('room-a101', None, 'south', 'external'), ('room-a101', None, 'west', 'external'), ('room-a101', None, 'north', 'internal'), ('room-a101', None, 'east', 'internal'), ('room-b205', None, 'north', 'external'), ('room-b205', None, 'south', 'internal'), ('room-b205', None, 'east', 'internal'), ('room-b205', None, 'west', 'internal'), ('room-c301', None, 'west', 'external'), ('room-c301', None, 'north', 'internal'), ('room-c301', None, 'south', 'internal'), ('room-c301', None, 'east', 'internal')]

def main() -> None:
    database_url = os.environ['DATABASE_URL']
    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text('INSERT INTO buildings (building_id, name, address, latitude, longitude, total_floors, country_code) VALUES (:building_id, :name, :address, :latitude, :longitude, :total_floors, :country_code)'), BUILDING)
        for floor in FLOORS:
            conn.execute(text('INSERT INTO floors (floor_id, building_id, level, name) VALUES (:floor_id, :building_id, :level, :name)'), floor)
        for room in ROOMS:
            conn.execute(text('INSERT INTO rooms (room_id, floor_id, building_id, room_label, room_type, area_m2, volume_m3, primary_orientation, r_wall, c_zone, sensor_id, config_json) VALUES (:room_id, :floor_id, :building_id, :room_label, :room_type, :area_m2, :volume_m3, :primary_orientation, :r_wall, :c_zone, :sensor_id, :config_json)'), {**room, 'config_json': json.dumps(room['config_json'])})
        for room_id, adjacent_room_id, direction, wall_type in ADJACENCIES:
            conn.execute(text('INSERT INTO room_adjacencies (room_id, adjacent_room_id, direction, wall_type) VALUES (:room_id, :adjacent_room_id, :direction, :wall_type)'), {'room_id': room_id, 'adjacent_room_id': adjacent_room_id, 'direction': direction, 'wall_type': wall_type})
    print(f"Seeded {len(ROOMS)} rooms across {len(FLOORS)} floors for building {BUILDING['building_id']}.")
if __name__ == '__main__':
    main()
