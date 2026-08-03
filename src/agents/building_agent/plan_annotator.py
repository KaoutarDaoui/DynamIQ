"""Renders the uploaded floor plan with detected room numbers stamped on it in red."""

from __future__ import annotations

import io
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from .vision_processor import detect_file_type

ROOM_MARK_COLOR = (220, 0, 0)
FONT_SIZE_RATIO = 0.03  # relative to the image's shorter side


def _load_source_image(file_bytes: bytes, filename: str) -> Image.Image:
    """Render a full-resolution RGB image for annotation.

    Deliberately independent of vision_processor's Groq-bound downscaling —
    this is for human viewing, not token budget.
    """

    file_type = detect_file_type(filename, file_bytes)
    if file_type == "pdf":
        from pdf2image import convert_from_bytes

        images = convert_from_bytes(file_bytes, dpi=200, first_page=1, last_page=1)
        if not images:
            raise ValueError("Could not render PDF page for annotation")
        return images[0].convert("RGB")

    return Image.open(io.BytesIO(file_bytes)).convert("RGB")


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arialbd.ttf", size)
    except OSError:
        try:
            return ImageFont.load_default(size=size)
        except TypeError:
            return ImageFont.load_default()


def annotate_plan_with_room_numbers(
    file_bytes: bytes, filename: str, rooms: list[dict[str, Any]]
) -> bytes:
    """Draw each detected room's sequence number in red at its bbox center.

    `rooms` must be the geometry_processor-enriched list (has "bbox" and
    "sequence_number") — bbox is normalized-image-space only and is never
    persisted to the rooms table, so this can't be reconstructed from DB rows.
    """

    image = _load_source_image(file_bytes, filename)
    width, height = image.size
    draw = ImageDraw.Draw(image)
    font = _load_font(max(14, int(min(width, height) * FONT_SIZE_RATIO)))

    for room in rooms:
        bbox = room.get("bbox") or {}
        x = float(bbox.get("x", 0.0)) * width
        y = float(bbox.get("y", 0.0)) * height
        w = float(bbox.get("width", 0.0)) * width
        h = float(bbox.get("height", 0.0)) * height

        label = str(room.get("sequence_number", "?"))
        text_bbox = draw.textbbox((0, 0), label, font=font)
        text_w, text_h = text_bbox[2] - text_bbox[0], text_bbox[3] - text_bbox[1]
        draw.text(
            (x + w / 2 - text_w / 2, y + h / 2 - text_h / 2),
            label,
            fill=ROOM_MARK_COLOR,
            font=font,
        )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
