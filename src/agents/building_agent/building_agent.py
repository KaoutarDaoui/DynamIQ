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
        north_click_direction: str,
    ) -> dict[str, Any]:
        """Normalize room geometry, create ORM rows, and persist them."""

        oriented_walls = compute_cardinal_orientations(north_click_direction)
        floor_id = f"{building_id}-floor-{floor_level}"

        with self._session_scope() as session:
            building = session.get(Building, building_id)
            if building is None:
                raise LookupError(f"Building not found: {building_id}")

            floor = save_floor(
                session,
                Floor(id=floor_id, building_id=building_id, floor_level=floor_level),
            )

            normalized_rooms = auto_number_and_map_rooms(detected_rooms_list, floor_level, oriented_walls)
            saved_rooms: list[Room] = []
            for room_data in normalized_rooms:
                room_config = room_data.get("config_json") or default_room_config()
                room = Room(
                    room_id=room_data["room_id"],
                    floor_id=floor_id,
                    room_label=room_data["room_label"],
                    area_m2=float(room_data["area_m2"]),
                    primary_orientation=str(room_data.get("primary_orientation", "unknown")),
                    config_json=room_config,
                )
                saved_rooms.append(save_room(session, room))

            return {
                "building_id": building_id,
                "floor": floor,
                "rooms": saved_rooms,
                "oriented_walls": oriented_walls,
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
