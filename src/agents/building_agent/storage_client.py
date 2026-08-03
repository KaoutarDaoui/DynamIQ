"""Supabase Storage helper for persisting rendered floor plan images."""

from __future__ import annotations

import os

import httpx

STORAGE_BUCKET = "floor-plans"


def upload_annotated_plan(image_bytes: bytes, building_id: str, floor_level: int) -> str:
    """Upload the annotated PNG and return its public URL.

    Upserts so re-uploading the same floor's plan replaces the old image
    instead of accumulating stale copies.
    """

    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured")

    object_path = f"{building_id}/floor-{floor_level}/annotated-plan.png"
    upload_url = f"{supabase_url}/storage/v1/object/{STORAGE_BUCKET}/{object_path}"

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            upload_url,
            content=image_bytes,
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,
                "Content-Type": "image/png",
                "x-upsert": "true",
            },
        )
        if response.is_error:
            raise RuntimeError(
                f"Supabase Storage upload failed with HTTP {response.status_code}: {response.text}"
            )

    return f"{supabase_url}/storage/v1/object/public/{STORAGE_BUCKET}/{object_path}"
