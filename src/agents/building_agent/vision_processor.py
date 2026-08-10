"""PDF and image plan analysis using Groq Vision (Qwen3.6 27B)."""

from __future__ import annotations

import base64
import io
import json
import os
import re
import time
from pathlib import Path
from typing import Any


import httpx


GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
# Only active vision-capable (image input) model on this Groq account as of
# 2026-07 — verify against GET /openai/v1/models before changing.
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.6-27b")

SUPPORTED_IMAGE_TYPES = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".gif":  "image/gif",
}

EXTRACTION_PROMPT = """
You are an architectural plan analyzer. Analyze this floor plan image and extract every room.

For each room you detect, return a JSON object with these exact fields:
- "room_label": string — the room number or name visible on the plan (e.g. "204", "TP Réseau", "Amphi A"). If no label is visible, use "unlabeled".
- "bbox": object with "x", "y", "width", "height" as normalized values between 0.0 and 1.0 relative to the full image dimensions. (0,0) is top-left.
- "area_m2": float — estimated area in square meters. If a scale is visible use it, otherwise estimate from proportions assuming a typical room is 20-50 m².
- "external_walls": list of strings — which walls face the exterior. Values must be from: ["wall_top", "wall_bottom", "wall_left", "wall_right"]. A wall is external if it borders the outside of the building.
- "has_windows": object with keys "wall_top", "wall_bottom", "wall_left", "wall_right" and boolean values.
- "room_type": string — one of: "classroom", "lab", "office", "corridor", "amphitheater", "bathroom", "staircase", "elevator", "storage", "unknown"
- "primary_orientation": string — the cardinal direction of the main facade. Use "unknown" if cannot be determined from plan alone.

Return ONLY a valid JSON array. No explanation, no markdown, no code blocks.
If you cannot detect any rooms, return [].
"""


# ── file type detection ────────────────────────────────────────────────────

def detect_file_type(filename: str, file_bytes: bytes) -> str:
    """
    Detect whether the file is a PDF or an image.
    Returns: "pdf" | "jpeg" | "png" | "webp" | "gif"
    Checks magic bytes first, then falls back to file extension.
    """

    # Magic bytes detection — reliable regardless of filename
    if file_bytes[:4] == b"%PDF":
        return "pdf"
    if file_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if file_bytes[:2] in (b"\xff\xd8", b"\xff\xe0", b"\xff\xe1"):
        return "jpeg"
    if file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP":
        return "webp"
    if file_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"

    # Fallback to extension
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in (".jpg", ".jpeg"):
        return "jpeg"
    if ext == ".png":
        return "png"
    if ext == ".webp":
        return "webp"
    if ext == ".gif":
        return "gif"

    raise ValueError(
        f"Unsupported file type for '{filename}'. "
        f"Accepted: PDF, JPEG, PNG, WEBP, GIF."
    )


# ── conversion helpers ─────────────────────────────────────────────────────

# Groq's on_demand tier caps this model at 8000 tokens/minute. Two separate
# things eat that budget, both verified against the live API on a real
# floor plan:
#  1. Image tokens scale with encoded JPEG size, which depends on line/text
#     density, not just pixel dimensions — dense CAD-style plans cost far
#     more per pixel than simple graphics. 512px keeps this to ~1650 tokens.
#  2. Groq reserves the *entire* `max_tokens` value against the budget
#     upfront, not actual usage (a 413 fires even if the model would have
#     used far less). See reasoning_effort below for why max_tokens also
#     has to be large enough to not truncate the answer.
MAX_IMAGE_DIMENSION = 512
JPEG_QUALITY = 80


def _downscale_to_base64_jpeg(image_bytes: bytes) -> str:
    """Downscale/recompress any supported image to a token-budget-friendly JPEG."""

    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as img:
        img = img.convert("RGB")
        img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=JPEG_QUALITY)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _pdf_to_base64_jpeg(pdf_bytes: bytes, page_index: int = 0) -> str:
    """Convert one page of a PDF to a downscaled base64 JPEG."""

    from pdf2image import convert_from_bytes

    images = convert_from_bytes(
        pdf_bytes,
        dpi=150,
        first_page=page_index + 1,
        last_page=page_index + 1,
    )
    if not images:
        raise ValueError(f"Could not render page {page_index} from PDF")

    buffer = io.BytesIO()
    images[0].save(buffer, format="JPEG", quality=90)
    return _downscale_to_base64_jpeg(buffer.getvalue())


# ── groq api call ──────────────────────────────────────────────────────────

# Our on_demand tier's 8000 tokens/minute budget is tight enough (a single
# extraction costs ~4500-4800 tokens) that back-to-back uploads routinely
# collide with a still-open window — Groq returns 429 with a "try again in
# N.Ns" hint in that case rather than rejecting the request outright. The
# LangGraph agentic loop (graph.py) makes several more calls per upload
# (extraction + up to 5 rounds of decide_action + tool), so a low retry
# budget here means the whole run aborts on a single transient 429 — bumped
# from 2 to 5 so a run has real odds of riding out a busy minute.
MAX_RATE_LIMIT_RETRIES = 5
RETRY_AFTER_PATTERN = re.compile(r"try again in ([\d.]+)s")


def _call_groq_vision(image_b64: str, media_type: str, api_key: str, prompt: str = EXTRACTION_PROMPT) -> str:
    """Send an image to Groq Vision and return the raw text response.

    `prompt` defaults to the room-extraction prompt (this module's own use),
    but graph.py's tool nodes (zoom/scale/adjacency/recount) pass their own —
    without this parameter they'd silently get room-extraction output no
    matter what they asked for, since a plain positional call couldn't
    override the text sent at all. Verified live: this exact bug meant
    tool_recount could never parse an "exact_count" out of a room list.
    """

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": GROQ_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{media_type};base64,{image_b64}",
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        "max_tokens": 4000,
        "temperature": 0.1,
        # qwen3.6 is a reasoning model — without this its <think>...</think>
        # trace is inlined into `content`, and that trace's own stray
        # brackets break the JSON-array extraction below.
        "reasoning_format": "hidden",
        # Without this, the model burns its entire max_tokens budget on
        # hidden reasoning for real (multi-room, dense) floor plans and
        # finish_reason ends up "length" with an empty answer — verified
        # live: 5000 tokens of pure reasoning, zero output. "none" makes
        # it answer directly.
        "reasoning_effort": "none",
    }

    with httpx.Client(timeout=90.0) as client:
        for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
            response = client.post(GROQ_API_URL, json=payload, headers=headers)

            if response.status_code == 429 and attempt < MAX_RATE_LIMIT_RETRIES:
                match = RETRY_AFTER_PATTERN.search(response.text)
                delay = float(match.group(1)) + 0.5 if match else 5.0
                time.sleep(delay)
                continue

            if response.is_error:
                detail = response.text.strip() or response.reason_phrase
                raise ValueError(
                    f"Groq vision request failed with HTTP {response.status_code} "
                    f"for model '{GROQ_VISION_MODEL}': {detail}"
                )

            return response.json()["choices"][0]["message"]["content"]

    raise AssertionError("unreachable")  # loop always returns or raises


# ── response parsing ───────────────────────────────────────────────────────

def _parse_groq_response(raw_text: str) -> list[dict[str, Any]]:
    """Extract the JSON array from Groq's response robustly."""

    # Strip reasoning traces some models inline into content despite
    # reasoning_format=hidden (e.g. <think>...</think> blocks). These often
    # contain stray brackets that would otherwise confuse the array regex below.
    text = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()

    # Direct parse
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    # Strip markdown code fences if present
    text_clean = re.sub(r"```(?:json)?", "", text).strip()
    try:
        parsed = json.loads(text_clean)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    # Find JSON array anywhere in the text
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    return []


def _validate_room(room: dict[str, Any], index: int) -> dict[str, Any]:
    """Ensure a room dict has all required fields with sensible defaults."""

    return {
        "room_label":          str(room.get("room_label", f"unlabeled-{index}")),
        "bbox":                room.get("bbox", {"x": 0.0, "y": 0.0, "width": 0.1, "height": 0.1}),
        "area_m2":             float(room.get("area_m2", 30.0)),
        "external_walls":      list(room.get("external_walls", [])),
        "has_windows":         dict(room.get("has_windows", {
                                   "wall_top": False, "wall_bottom": False,
                                   "wall_left": False, "wall_right": False,
                               })),
        "room_type":           str(room.get("room_type", "unknown")),
        "primary_orientation": str(room.get("primary_orientation", "unknown")),
    }


# ── public API ─────────────────────────────────────────────────────────────

def extract_rooms_from_file(
    file_bytes: bytes,
    filename: str,
    api_key: str,
    pdf_page_index: int = 0,
) -> list[dict[str, Any]]:
    """
    Universal entry point — accepts PDF, JPEG, PNG, WEBP, or GIF.

    Detects the file type automatically from magic bytes + extension,
    converts to a base64 image if needed, calls Groq Vision, and returns
    a validated list of room dicts ready for geometry_processor.

    Args:
        file_bytes:     Raw file content (from UploadFile.read() or open()).
        filename:       Original filename — used for type detection fallback.
        api_key:        Groq API key.
        pdf_page_index: For PDFs — which page to analyze (0-indexed).

    Returns:
        List of room dicts with bbox, area_m2, external_walls, etc.

    Raises:
        ValueError: If the file type is not supported.
        httpx.HTTPError: If the Groq API call fails.
    """

    file_type = detect_file_type(filename, file_bytes)

    if file_type == "pdf":
        image_b64 = _pdf_to_base64_jpeg(file_bytes, pdf_page_index)
    else:
        image_b64 = _downscale_to_base64_jpeg(file_bytes)
    # Always JPEG post-downscale, regardless of the original upload format.
    media_type = "image/jpeg"

    raw_response = _call_groq_vision(image_b64, media_type, api_key)
    raw_rooms    = _parse_groq_response(raw_response)
    return [_validate_room(room, i) for i, room in enumerate(raw_rooms)]


# ── legacy aliases (backward compat) ──────────────────────────────────────

def extract_rooms_from_pdf(
    pdf_bytes: bytes,
    api_key: str,
    page_index: int = 0,
) -> list[dict[str, Any]]:
    """Backward-compatible wrapper — delegates to extract_rooms_from_file."""
    return extract_rooms_from_file(pdf_bytes, "plan.pdf", api_key, page_index)


def extract_rooms_from_image_path(
    image_path: str | Path,
    api_key: str,
) -> list[dict[str, Any]]:
    """Backward-compatible wrapper for file-path based calls."""
    path = Path(image_path)
    with open(path, "rb") as f:
        file_bytes = f.read()
    return extract_rooms_from_file(file_bytes, path.name, api_key)