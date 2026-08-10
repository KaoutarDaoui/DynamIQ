"""Geometry and north-alignment helpers for the Building Agent."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .schema_models import default_room_config


# 8-way compass, in clockwise order starting from north — index i sits at
# bearing i*45°, so nearest-point lookup is a single round() + modulo.
_COMPASS_POINTS = [
    "north", "northeast", "east", "southeast",
    "south", "southwest", "west", "northwest",
]

# Bearing (clockwise degrees from "up") of each image edge in an unrotated plan.
_EDGE_BEARINGS = {
    "wall_top": 0.0,
    "wall_right": 90.0,
    "wall_bottom": 180.0,
    "wall_left": 270.0,
}


def _nearest_compass_point(bearing_deg: float) -> str:
    index = round((bearing_deg % 360) / 45) % 8
    return _COMPASS_POINTS[index]


def compute_cardinal_orientations(north_angle_deg: float) -> dict[str, str]:
    """Map plan-relative wall positions to real-world compass directions.

    north_angle_deg: clockwise degrees from the image's "up" direction to
    true north (0 = north is straight up, 90 = north points at the image's
    right edge, etc). Comes from the frontend's free-rotation compass dial —
    any value is valid, it's normalized mod 360 and rounded to the nearest
    of 8 compass points per wall.
    """

    return {
        wall: _nearest_compass_point(edge_bearing - north_angle_deg)
        for wall, edge_bearing in _EDGE_BEARINGS.items()
    }


def _extract_bbox(room: Mapping[str, Any]) -> tuple[float, float, float, float]:
    bbox = room.get("bbox")
    if isinstance(bbox, Mapping):
        if {"x", "y", "width", "height"}.issubset(bbox):
            return (
                float(bbox["x"]),
                float(bbox["y"]),
                float(bbox["width"]),
                float(bbox["height"]),
            )
        if {"left", "top", "right", "bottom"}.issubset(bbox):
            left = float(bbox["left"])
            top = float(bbox["top"])
            right = float(bbox["right"])
            bottom = float(bbox["bottom"])
            return left, top, right - left, bottom - top

    if isinstance(bbox, Sequence) and len(bbox) == 4:
        x, y, width, height = bbox
        return float(x), float(y), float(width), float(height)

    x = float(room.get("x", room.get("left", 0.0)))
    y = float(room.get("y", room.get("top", 0.0)))
    width = float(room.get("width", room.get("right", 0.0) - x))
    height = float(room.get("height", room.get("bottom", 0.0) - y))
    return x, y, width, height


def auto_number_and_map_rooms(
    detected_rooms: list, building_id: str, floor_level: int, oriented_walls: dict
) -> list:
    """Sort detected rooms, assign sequential IDs, and annotate wall mappings."""

    normalized_rooms: list[dict[str, Any]] = []
    for room in detected_rooms:
        room_data = dict(room)
        x, y, width, height = _extract_bbox(room_data)
        room_data["bbox"] = {"x": x, "y": y, "width": width, "height": height}
        room_data["_sort_y"] = y
        room_data["_sort_x"] = x
        room_data["area_m2"] = float(room_data.get("area_m2", width * height))
        normalized_rooms.append(room_data)

    normalized_rooms.sort(key=lambda item: (item["_sort_y"], item["_sort_x"]))

    cardinal_walls = {cardinal: wall for wall, cardinal in oriented_walls.items()}
    enriched_rooms: list[dict[str, Any]] = []
    for sequence_number, room in enumerate(normalized_rooms, start=1):
        # Must be globally unique across the whole `rooms` table, not just
        # this floor — without building_id, two buildings sharing a floor
        # level collide on room_id and silently overwrite each other's rows
        # (verified live: uploading for building "2" clobbered building "1"'s
        # rooms since both produced "room-101" for floor 1, room 1).
        room_id = f"{building_id}-floor-{floor_level}-room-{sequence_number:02d}"
        room_label = str(room.get("room_label", room_id))
        enriched_room = {
            key: value
            for key, value in room.items()
            if not key.startswith("_")
        }
        enriched_room.update(
            {
                "room_id": room_id,
                "room_label": room_label,
                "floor_level": floor_level,
                "sequence_number": sequence_number,
                "primary_orientation": str(room.get("primary_orientation", "unknown")),
                "wall_surfaces": dict(oriented_walls),
                "cardinal_walls": cardinal_walls,
                "config_json": room.get("config_json", default_room_config()),
            }
        )
        enriched_rooms.append(enriched_room)

    return enriched_rooms
