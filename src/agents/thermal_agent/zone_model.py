from __future__ import annotations
from dataclasses import dataclass
from . import constants
from .db import AdjacencyRecord, BuildingRecord, FloorRecord, RoomRecord
_CARDINAL_DIRECTIONS = ('north', 'south', 'east', 'west')

class ZoneModelSanityError(ValueError):
    pass

@dataclass(frozen=True)
class ZoneModel:
    room_id: str
    r_lumped_k_per_w: float
    c_lumped_j_per_k: float
    tau_hours: float
    ua_wall_w_per_k: float
    ua_window_w_per_k: float
    ua_roof_w_per_k: float
    ua_vent_w_per_k: float
    is_top_floor: bool
    external_directions: frozenset[str]

def r_value_to_ua(r_value_m2_k_per_w: float, area_m2: float) -> float:
    if r_value_m2_k_per_w <= 0:
        raise ValueError(f'r_value_m2_k_per_w must be positive, got {r_value_m2_k_per_w}')
    if area_m2 < 0:
        raise ValueError(f'area_m2 must be non-negative, got {area_m2}')
    return area_m2 / r_value_m2_k_per_w

def is_top_floor(floor_level: int, building_total_floors: int) -> bool:
    return floor_level == building_total_floors

def external_directions(adjacencies: list[AdjacencyRecord], room: RoomRecord | None=None) -> frozenset[str]:
    from_table = frozenset((a.direction for a in adjacencies if a.wall_type == 'external'))
    if from_table or room is None:
        return from_table
    adjacency_cfg = room.config_json.get('adjacency', {})
    return frozenset((d for d, v in adjacency_cfg.items() if v == 'external'))

def mass_factor(thermal_mass: str) -> float:
    if thermal_mass == 'heavy':
        return constants.MASS_FACTOR_HEAVY
    if thermal_mass == 'light':
        return constants.MASS_FACTOR_LIGHT
    raise ValueError(f"Unknown thermal_mass {thermal_mass!r}, expected 'heavy' or 'light'")

def sanity_gate(r_lumped_k_per_w: float, c_lumped_j_per_k: float, room_id: str) -> None:
    rc_seconds = r_lumped_k_per_w * c_lumped_j_per_k
    if not constants.R_LUMPED_MIN_K_PER_W < r_lumped_k_per_w < constants.R_LUMPED_MAX_K_PER_W:
        raise ZoneModelSanityError(f'{room_id}: R_lumped={r_lumped_k_per_w:.6f} K/W outside ({constants.R_LUMPED_MIN_K_PER_W}, {constants.R_LUMPED_MAX_K_PER_W})')
    if not constants.C_LUMPED_MIN_J_PER_K < c_lumped_j_per_k < constants.C_LUMPED_MAX_J_PER_K:
        raise ZoneModelSanityError(f'{room_id}: C_lumped={c_lumped_j_per_k:.1f} J/K outside ({constants.C_LUMPED_MIN_J_PER_K}, {constants.C_LUMPED_MAX_J_PER_K})')
    if not constants.RC_TIME_CONSTANT_MIN_S < rc_seconds < constants.RC_TIME_CONSTANT_MAX_S:
        raise ZoneModelSanityError(f'{room_id}: R*C={rc_seconds:.1f} s outside ({constants.RC_TIME_CONSTANT_MIN_S}, {constants.RC_TIME_CONSTANT_MAX_S})')

def window_area_by_direction(room: RoomRecord, adjacencies: list[AdjacencyRecord]) -> dict[str, float]:
    envelope = room.config_json.get('envelope', {})
    ext_dirs = external_directions(adjacencies, room)
    return {d: constants.WINDOW_AREA_FRACTION * float(envelope.get(f'{d}_wall_m2', 0.0)) for d in ext_dirs}

def build_zone_model(room: RoomRecord, floor: FloorRecord, building: BuildingRecord, adjacencies: list[AdjacencyRecord]) -> ZoneModel:
    envelope = room.config_json.get('envelope', {})
    thermal = room.config_json.get('thermal', {})
    ext_dirs = external_directions(adjacencies, room)
    a_ext = sum((float(envelope.get(f'{d}_wall_m2', 0.0)) for d in ext_dirs))
    a_window = constants.WINDOW_AREA_FRACTION * a_ext
    a_opaque = a_ext - a_window
    top_floor = is_top_floor(floor.level, building.total_floors)
    ua_wall = r_value_to_ua(room.r_wall, a_opaque) if a_opaque > 0 else 0.0
    ua_window = a_window * float(thermal['window_u_value'])
    ua_roof = room.area_m2 * constants.ROOF_U_VALUE if top_floor else 0.0
    ua_vent = constants.INFILTRATION_ACH * room.volume_m3 * constants.AIR_VOLUMETRIC_HEAT_CAPACITY / 3600.0
    ua_total = ua_wall + ua_window + ua_roof + ua_vent
    r_lumped = 1.0 / ua_total
    c_lumped = room.c_zone * mass_factor(thermal['thermal_mass'])
    sanity_gate(r_lumped, c_lumped, room.room_id)
    return ZoneModel(room_id=room.room_id, r_lumped_k_per_w=r_lumped, c_lumped_j_per_k=c_lumped, tau_hours=r_lumped * c_lumped / 3600.0, ua_wall_w_per_k=ua_wall, ua_window_w_per_k=ua_window, ua_roof_w_per_k=ua_roof, ua_vent_w_per_k=ua_vent, is_top_floor=top_floor, external_directions=ext_dirs)
