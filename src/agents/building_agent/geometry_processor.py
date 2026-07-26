"""Geometry and north-alignment helpers for the Building Agent."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .schema_models import default_room_config


_ORIENTATION_ROTATIONS: dict[str, dict[str, str]] = {
    "top": {
        "wall_top": "north",
        "wall_right": "east",
        "wall_bottom": "south",
        "wall_left": "west",
    },
    "right": {
        "wall_top": "west",
        "wall_right": "north",
        "wall_bottom": "east",
        "wall_left": "south",
    },
    "bottom": {
        "wall_top": "south",
        "wall_right": "west",
        "wall_bottom": "north",
        "wall_left": "east",
    },
    "left": {
        "wall_top": "east",
        "wall_right": "south",
        "wall_bottom": "west",
        "wall_left": "north",
    },
}


def compute_cardinal_orientations(north_direction: str) -> dict[str, str]:
    """Map plan-relative wall positions to real-world cardinal directions."""

    normalized_direction = north_direction.strip().lower()
    if normalized_direction not in _ORIENTATION_ROTATIONS:
        valid = ", ".join(sorted(_ORIENTATION_ROTATIONS))
        raise ValueError(f"north_direction must be one of: {valid}")
    return dict(_ORIENTATION_ROTATIONS[normalized_direction])


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


def auto_number_and_map_rooms(detected_rooms: list, floor_level: int, oriented_walls: dict) -> list:
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
        room_id = f"room-{floor_level}{sequence_number:02d}"
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
