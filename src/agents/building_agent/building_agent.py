"""Main orchestration interface for the Building Agent."""

from __future__ import annotations

from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from typing import Any

from sqlmodel import Session

from .config import get_session
from .db_manager import get_room_by_id, save_floor, save_room
from .geometry_processor import auto_number_and_map_rooms, compute_cardinal_orientations
from .schema_models import Building, Floor, Room, RoomConfig, default_room_config

# No scale/height data is extracted from the plan, so volume is estimated
# from a standard residential/institutional ceiling height.
DEFAULT_CEILING_HEIGHT_M = 3.0


class BuildingAgent:
    """Process architectural inputs and persist them as institutional memory."""

    def __init__(self, session_factory: Callable[[], Iterator[Session]] = get_session) -> None:
        self._session_factory = session_factory

    @contextmanager
    def _session_scope(self) -> Generator[Session, None, None]:
        session_generator = self._session_factory()
        session = next(session_generator)
        try:
            yield session
        finally:
            session.close()
            try:
                next(session_generator)
            except StopIteration:
                pass

    def process_and_save_floor(
        self,
        building_id: str,
        floor_level: int,
        detected_rooms_list: list,
        north_angle_deg: float,
    ) -> dict[str, Any]:
        """Normalize room geometry, create ORM rows, and persist them."""

        oriented_walls = compute_cardinal_orientations(north_angle_deg)
        floor_id = f"{building_id}-floor-{floor_level}"

        with self._session_scope() as session:
            building = session.get(Building, building_id)
            if building is None:
                raise LookupError(f"Building not found: {building_id}")

            floor = save_floor(
                session,
                Floor(floor_id=floor_id, building_id=building_id, level=floor_level),
            )

            normalized_rooms = auto_number_and_map_rooms(
                detected_rooms_list, building_id, floor_level, oriented_walls
            )
            saved_rooms: list[Room] = []
            for room_data in normalized_rooms:
                room_config = room_data.get("config_json") or default_room_config()
                area_m2 = float(room_data["area_m2"])
                thermal = room_config.get("thermal", {})
                room = Room(
                    room_id=room_data["room_id"],
                    floor_id=floor_id,
                    room_label=room_data["room_label"],
                    room_type=str(room_data.get("room_type", "classroom")),
                    area_m2=area_m2,
                    volume_m3=area_m2 * DEFAULT_CEILING_HEIGHT_M,
                    primary_orientation=str(room_data.get("primary_orientation", "unknown")),
                    r_wall=float(thermal.get("wall_r_value", 1.8)),
                    c_zone=float(thermal.get("estimated_C_zone", 145000.0)),
                    config_json=room_config,
                )
                saved_rooms.append(save_room(session, room))

            return {
                "building_id": building_id,
                "floor": floor,
                "rooms": saved_rooms,
                "oriented_walls": oriented_walls,
                # bbox/sequence_number are geometry-only and never persisted
                # to the rooms table — callers that need to render the plan
                # (e.g. the annotated-plan endpoint) must use this, not
                # "rooms".
                "normalized_rooms": normalized_rooms,
            }

    def get_thermal_parameters(self, room_id: str) -> dict[str, float | str]:
        """Return the room's thermal resistance and capacitance for Agent 2."""

        with self._session_scope() as session:
            room = get_room_by_id(session, room_id)
            config = RoomConfig.model_validate(room.config_json or default_room_config())
            return {
                "room_id": room_id,
                "R": config.thermal.wall_r_value,
                "C": config.thermal.estimated_C_zone,
                "wall_r_value": config.thermal.wall_r_value,
                "estimated_C_zone": config.thermal.estimated_C_zone,
            }
