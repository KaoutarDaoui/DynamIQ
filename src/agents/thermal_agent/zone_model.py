from __future__ import annotations
from dataclasses import dataclass
from . import constants
from .db import AdjacencyRecord, BuildingRecord, FloorRecord, RoomRecord

# Only 4 directions are modeled — diagonal/other orientations aren't supported,
# every wall is assumed to face one of these.
_CARDINAL_DIRECTIONS = ('north', 'south', 'east', 'west')


class ZoneModelSanityError(ValueError):
    # Raised by sanity_gate() below when a room's computed R or C is
    # physically implausible (e.g. would make the room heat/cool in seconds,
    # or take weeks) — a bug in the input data, not a real room.
    pass


@dataclass(frozen=True)
class ZoneModel:
    # Everything downstream (MPC, anomaly detection) needs from a room's
    # geometry, bundled into one object. "frozen=True" means once created,
    # none of these fields can be changed — it's a read-only snapshot.
    room_id: str
    r_lumped_k_per_w: float       # the room's overall resistance (K/W) — see build_zone_model()
    c_lumped_j_per_k: float       # the room's overall thermal mass (J/K)
    tau_hours: float              # R * C, converted to hours: how long the room takes to respond
    ua_wall_w_per_k: float        # heat leaking through the solid (non-window) walls
    ua_window_w_per_k: float      # heat leaking through the windows
    ua_roof_w_per_k: float        # heat leaking through the roof (0 unless top floor)
    ua_vent_w_per_k: float        # heat leaking through air infiltration (drafts/gaps)
    is_top_floor: bool
    external_directions: frozenset[str]  # which compass directions actually face outside


def r_value_to_ua(r_value_m2_k_per_w: float, area_m2: float) -> float:
    # Converts a material R-value (m2*K/W — a property of the material itself,
    # independent of size) into a UA value (W/K — the actual heat-leak rate
    # for THIS wall, given its real area). "UA" = U-value x Area; since
    # U-value is just 1/R-value, this is the same as area / r_value.
    # Bigger wall with the same insulation quality leaks more total heat,
    # hence dividing by area rather than ignoring it.
    if r_value_m2_k_per_w <= 0:
        raise ValueError(f'r_value_m2_k_per_w must be positive, got {r_value_m2_k_per_w}')
    if area_m2 < 0:
        raise ValueError(f'area_m2 must be non-negative, got {area_m2}')
    return area_m2 / r_value_m2_k_per_w


def is_top_floor(floor_level: int, building_total_floors: int) -> bool:
    # A room only loses/gains heat through a roof if there's no other floor
    # above it. Simple equality check: is this floor the highest one?
    return floor_level == building_total_floors


def external_directions(adjacencies: list[AdjacencyRecord], room: RoomRecord | None=None) -> frozenset[str]:
    # Figures out which of the room's walls actually face the outside world
    # (as opposed to another room). Two possible data sources, tried in order:
    from_table = frozenset((a.direction for a in adjacencies if a.wall_type == 'external'))
    if from_table or room is None:
        # If the room_adjacencies table has real rows for this room, trust it.
        return from_table
    # Otherwise (the table is empty for this room — true for most real data
    # in this system today) fall back to the "adjacency" block inside the
    # room's own config_json, which Agent 1 actually populates.
    adjacency_cfg = room.config_json.get('adjacency', {})
    return frozenset((d for d, v in adjacency_cfg.items() if v == 'external'))


def mass_factor(thermal_mass: str) -> float:
    # Translates Agent 1's qualitative "heavy" / "light" construction label
    # into the actual multiplier applied to the room's base capacitance.
    # Heavy (concrete, brick) holds far more heat than light (drywall).
    if thermal_mass == 'heavy':
        return constants.MASS_FACTOR_HEAVY
    if thermal_mass == 'light':
        return constants.MASS_FACTOR_LIGHT
    raise ValueError(f"Unknown thermal_mass {thermal_mass!r}, expected 'heavy' or 'light'")


def sanity_gate(r_lumped_k_per_w: float, c_lumped_j_per_k: float, room_id: str) -> None:
    # Last checkpoint before a room's R/C gets trusted anywhere else: reject
    # anything physically impossible rather than silently using bad numbers.
    rc_seconds = r_lumped_k_per_w * c_lumped_j_per_k  # tau = R * C, in seconds

    # Is the resistance (how insulated the room is) within a believable range?
    if not constants.R_LUMPED_MIN_K_PER_W < r_lumped_k_per_w < constants.R_LUMPED_MAX_K_PER_W:
        raise ZoneModelSanityError(f'{room_id}: R_lumped={r_lumped_k_per_w:.6f} K/W outside ({constants.R_LUMPED_MIN_K_PER_W}, {constants.R_LUMPED_MAX_K_PER_W})')

    # Is the capacitance (how much heat it can absorb) within a believable range?
    if not constants.C_LUMPED_MIN_J_PER_K < c_lumped_j_per_k < constants.C_LUMPED_MAX_J_PER_K:
        raise ZoneModelSanityError(f'{room_id}: C_lumped={c_lumped_j_per_k:.1f} J/K outside ({constants.C_LUMPED_MIN_J_PER_K}, {constants.C_LUMPED_MAX_J_PER_K})')

    # Is the resulting time constant (R * C — how long the room takes to
    # react) believable? Catches bad combinations even when R and C each
    # individually look fine on their own.
    if not constants.RC_TIME_CONSTANT_MIN_S < rc_seconds < constants.RC_TIME_CONSTANT_MAX_S:
        raise ZoneModelSanityError(f'{room_id}: R*C={rc_seconds:.1f} s outside ({constants.RC_TIME_CONSTANT_MIN_S}, {constants.RC_TIME_CONSTANT_MAX_S})')


def window_area_by_direction(room: RoomRecord, adjacencies: list[AdjacencyRecord]) -> dict[str, float]:
    # Same 20%-of-external-wall assumption as build_zone_model() below, but
    # broken out per compass direction instead of summed — needed by
    # handler.py to calculate solar gain separately for each facing wall
    # (a north-facing window gets very different sun than a south-facing one).
    envelope = room.config_json.get('envelope', {})
    ext_dirs = external_directions(adjacencies, room)
    return {d: constants.WINDOW_AREA_FRACTION * float(envelope.get(f'{d}_wall_m2', 0.0)) for d in ext_dirs}


def build_zone_model(room: RoomRecord, floor: FloorRecord, building: BuildingRecord, adjacencies: list[AdjacencyRecord]) -> ZoneModel:
    # The main function of this file: turns Agent 1's raw geometry into the
    # single R and single C the rest of Agent 2 treats the room as.
    envelope = room.config_json.get('envelope', {})   # wall areas per direction
    thermal = room.config_json.get('thermal', {})      # window U-value, thermal mass label

    # Which walls face outside, and how much total external wall area is there?
    ext_dirs = external_directions(adjacencies, room)
    a_ext = sum((float(envelope.get(f'{d}_wall_m2', 0.0)) for d in ext_dirs))

    # Split that external area into window vs. solid wall, using the fixed
    # 20% assumption (Agent 1 doesn't record exact window sizes).
    a_window = constants.WINDOW_AREA_FRACTION * a_ext
    a_opaque = a_ext - a_window

    top_floor = is_top_floor(floor.level, building.total_floors)

    # Convert each heat-leak path into a UA (W/K) term, one at a time:
    ua_wall = r_value_to_ua(room.r_wall, a_opaque) if a_opaque > 0 else 0.0
    # Windows: Agent 1 already stores a U-value (not an R-value) for glazing,
    # so no conversion is needed — just multiply by the window area directly.
    ua_window = a_window * float(thermal['window_u_value'])
    # Roof: only top-floor rooms have one exposed to the outside; everyone
    # else gets 0 (their "ceiling" just borders another floor, not the sky).
    ua_roof = room.area_m2 * constants.ROOF_U_VALUE if top_floor else 0.0
    # Ventilation/infiltration: air leaking in and out through gaps and
    # cracks, converted from "how many times per hour the room's air is
    # replaced" (ACH) into a steady W/K leak rate. Dividing by 3600 converts
    # the hourly rate into a per-second rate to match the other UA terms.
    ua_vent = constants.INFILTRATION_ACH * room.volume_m3 * constants.AIR_VOLUMETRIC_HEAT_CAPACITY / 3600.0

    # All four leak paths act in parallel (heat can escape through any of
    # them independently), so their conductances simply add up.
    ua_total = ua_wall + ua_window + ua_roof + ua_vent

    # Resistance is the reciprocal of total conductance — a well-insulated
    # room (low UA) has a high R; a leaky room (high UA) has a low R.
    r_lumped = 1.0 / ua_total

    # Capacitance: Agent 1's raw guess, scaled up or down by how "heavy" the
    # room's construction is (see mass_factor() above).
    c_lumped = room.c_zone * mass_factor(thermal['thermal_mass'])

    # Reject the result outright if it's not physically plausible, rather
    # than silently handing bad numbers to the calibrator or optimizer.
    sanity_gate(r_lumped, c_lumped, room.room_id)

    return ZoneModel(
        room_id=room.room_id,
        r_lumped_k_per_w=r_lumped,
        c_lumped_j_per_k=c_lumped,
        tau_hours=r_lumped * c_lumped / 3600.0,  # the time constant, in hours, for easy reading
        ua_wall_w_per_k=ua_wall,
        ua_window_w_per_k=ua_window,
        ua_roof_w_per_k=ua_roof,
        ua_vent_w_per_k=ua_vent,
        is_top_floor=top_floor,
        external_directions=ext_dirs,
    )
