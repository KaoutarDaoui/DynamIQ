from __future__ import annotations
import pytest
from thermal_agent import constants
from thermal_agent.db import AdjacencyRecord, BuildingRecord, FloorRecord, RoomRecord
from thermal_agent.zone_model import ZoneModelSanityError, build_zone_model, external_directions, is_top_floor, mass_factor, r_value_to_ua, sanity_gate

class TestRValueToUa:

    def test_hand_computed_round_numbers(self) -> None:
        assert r_value_to_ua(2.0, 10.0) == pytest.approx(5.0)

    def test_esi_realistic_case_matches_spec_warning(self) -> None:
        ua = r_value_to_ua(1.8, 26.0)
        assert ua == pytest.approx(26.0 / 1.8)
        wrong_ua_if_treated_as_resistance = 1.0 / 1.8
        assert ua / wrong_ua_if_treated_as_resistance == pytest.approx(26.0)

    def test_nonpositive_r_value_raises(self) -> None:
        with pytest.raises(ValueError):
            r_value_to_ua(0.0, 10.0)
        with pytest.raises(ValueError):
            r_value_to_ua(-1.0, 10.0)

    def test_negative_area_raises(self) -> None:
        with pytest.raises(ValueError):
            r_value_to_ua(1.8, -1.0)

class TestIsTopFloor:

    def test_top_floor_when_level_equals_total_floors(self) -> None:
        assert is_top_floor(floor_level=3, building_total_floors=3) is True

    def test_not_top_floor_when_level_below_total_floors(self) -> None:
        assert is_top_floor(floor_level=2, building_total_floors=3) is False

    def test_not_top_floor_ground_level_one(self) -> None:
        assert is_top_floor(floor_level=1, building_total_floors=3) is False

class TestMassFactor:

    def test_heavy(self) -> None:
        assert mass_factor('heavy') == constants.MASS_FACTOR_HEAVY

    def test_light(self) -> None:
        assert mass_factor('light') == constants.MASS_FACTOR_LIGHT

    def test_unknown_raises(self) -> None:
        with pytest.raises(ValueError):
            mass_factor('medium')

class TestExternalDirections:

    def test_only_external_wall_type_counted(self) -> None:
        adjacencies = [AdjacencyRecord(room_id='r1', adjacent_room_id=None, direction='south', wall_type='external'), AdjacencyRecord(room_id='r1', adjacent_room_id=None, direction='west', wall_type='external'), AdjacencyRecord(room_id='r1', adjacent_room_id=None, direction='north', wall_type='internal'), AdjacencyRecord(room_id='r1', adjacent_room_id='r2', direction='east', wall_type='internal')]
        assert external_directions(adjacencies) == frozenset({'south', 'west'})

    def test_falls_back_to_config_json_adjacency_when_no_rows(self) -> None:
        room = _room(config_json={'envelope': {'north_wall_m2': 10.0, 'south_wall_m2': 10.0, 'east_wall_m2': 10.0, 'west_wall_m2': 10.0}, 'thermal': {'window_u_value': 5.8, 'thermal_mass': 'heavy'}, 'hvac': {'capacity_kw': 3.5, 'cop_cooling': 2.8, 'setpoint_occupied_c': 22.0}, 'adjacency': {'east': 'external', 'west': 'external', 'north': 'internal', 'south': 'internal'}})
        assert external_directions([], room) == frozenset({'east', 'west'})

    def test_no_fallback_when_room_not_supplied(self) -> None:
        assert external_directions([]) == frozenset()

    def test_table_rows_take_priority_over_config_json_fallback(self) -> None:
        room = _room(config_json={'envelope': {'north_wall_m2': 10.0, 'south_wall_m2': 10.0, 'east_wall_m2': 10.0, 'west_wall_m2': 10.0}, 'thermal': {'window_u_value': 5.8, 'thermal_mass': 'heavy'}, 'hvac': {'capacity_kw': 3.5, 'cop_cooling': 2.8, 'setpoint_occupied_c': 22.0}, 'adjacency': {'east': 'external', 'west': 'external', 'north': 'internal', 'south': 'internal'}})
        adjacencies = [AdjacencyRecord(room_id='r1', adjacent_room_id=None, direction='north', wall_type='external')]
        assert external_directions(adjacencies, room) == frozenset({'north'})

class TestSanityGate:

    def test_passes_within_bounds(self) -> None:
        sanity_gate(r_lumped_k_per_w=0.05, c_lumped_j_per_k=1000000.0, room_id='ok-room')

    def test_rejects_r_too_low(self) -> None:
        with pytest.raises(ZoneModelSanityError, match='R_lumped'):
            sanity_gate(r_lumped_k_per_w=0.001, c_lumped_j_per_k=1000000.0, room_id='bad-room')

    def test_rejects_c_too_high(self) -> None:
        with pytest.raises(ZoneModelSanityError, match='C_lumped'):
            sanity_gate(r_lumped_k_per_w=0.05, c_lumped_j_per_k=100000000.0, room_id='bad-room')

    def test_rejects_time_constant_too_long(self) -> None:
        with pytest.raises(ZoneModelSanityError, match='R\\*C'):
            sanity_gate(r_lumped_k_per_w=0.4, c_lumped_j_per_k=40000000.0, room_id='bad-room')

def _room(**overrides: object) -> RoomRecord:
    defaults: dict[str, object] = dict(room_id='room-a101', floor_id='floor-1', building_id='esi-algiers', room_label='A101', room_type='classroom', area_m2=45.0, volume_m3=135.0, primary_orientation='south', r_wall=1.8, c_zone=135.0 * constants.AIR_VOLUMETRIC_HEAT_CAPACITY, sensor_id='esp32-a101', config_json={'envelope': {'north_wall_m2': 18.0, 'south_wall_m2': 18.0, 'east_wall_m2': 22.5, 'west_wall_m2': 22.5}, 'thermal': {'window_u_value': 5.8, 'thermal_mass': 'heavy'}, 'hvac': {'capacity_kw': 3.5, 'cop_cooling': 2.8, 'setpoint_occupied_c': 22.0}})
    defaults.update(overrides)
    return RoomRecord(**defaults)

def _corner_adjacencies(room_id: str) -> list[AdjacencyRecord]:
    return [AdjacencyRecord(room_id, None, 'south', 'external'), AdjacencyRecord(room_id, None, 'west', 'external'), AdjacencyRecord(room_id, None, 'north', 'internal'), AdjacencyRecord(room_id, None, 'east', 'internal')]

class TestBuildZoneModel:

    def test_end_to_end_matches_hand_calc_for_ground_floor_corner_room(self) -> None:
        room = _room()
        floor = FloorRecord(floor_id='floor-1', building_id='esi-algiers', level=1, name='Ground Floor')
        building = BuildingRecord(building_id='esi-algiers', name='ESI Algiers', latitude=36.7538, longitude=3.0588, total_floors=3, country_code='DZ')
        adjacencies = _corner_adjacencies(room.room_id)
        model = build_zone_model(room, floor, building, adjacencies)
        assert model.ua_wall_w_per_k == pytest.approx(18.0)
        assert model.ua_window_w_per_k == pytest.approx(46.98)
        assert model.ua_roof_w_per_k == pytest.approx(0.0)
        assert model.ua_vent_w_per_k == pytest.approx(27.135)
        assert model.is_top_floor is False
        expected_r = 1.0 / (18.0 + 46.98 + 0.0 + 27.135)
        assert model.r_lumped_k_per_w == pytest.approx(expected_r)
        expected_c = room.c_zone * constants.MASS_FACTOR_HEAVY
        assert model.c_lumped_j_per_k == pytest.approx(expected_c)
        assert model.tau_hours == pytest.approx(expected_r * expected_c / 3600.0)

    def test_top_floor_adds_roof_term(self) -> None:
        room = _room(room_id='room-c301', area_m2=38.0, volume_m3=114.0, c_zone=114.0 * constants.AIR_VOLUMETRIC_HEAT_CAPACITY)
        floor = FloorRecord(floor_id='floor-3', building_id='esi-algiers', level=3, name='Top Floor')
        building = BuildingRecord(building_id='esi-algiers', name='ESI Algiers', latitude=36.7538, longitude=3.0588, total_floors=3, country_code='DZ')
        adjacencies = [AdjacencyRecord(room.room_id, None, 'west', 'external'), AdjacencyRecord(room.room_id, None, 'north', 'internal'), AdjacencyRecord(room.room_id, None, 'south', 'internal'), AdjacencyRecord(room.room_id, None, 'east', 'internal')]
        with pytest.raises(ZoneModelSanityError, match='R_lumped'):
            build_zone_model(room, floor, building, adjacencies)

    def test_unknown_thermal_mass_raises(self) -> None:
        room = _room(config_json={'envelope': {'south_wall_m2': 18.0, 'west_wall_m2': 22.5, 'north_wall_m2': 18.0, 'east_wall_m2': 22.5}, 'thermal': {'window_u_value': 5.8, 'thermal_mass': 'medium'}, 'hvac': {'capacity_kw': 3.5, 'cop_cooling': 2.8, 'setpoint_occupied_c': 22.0}})
        floor = FloorRecord(floor_id='floor-1', building_id='esi-algiers', level=1, name='Ground Floor')
        building = BuildingRecord(building_id='esi-algiers', name='ESI Algiers', latitude=36.7538, longitude=3.0588, total_floors=3, country_code='DZ')
        with pytest.raises(ValueError, match='thermal_mass'):
            build_zone_model(room, floor, building, _corner_adjacencies(room.room_id))
