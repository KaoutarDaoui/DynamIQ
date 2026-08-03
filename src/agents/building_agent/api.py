"""FastAPI routes for the Building Agent onboarding flow."""

from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session

from .building_agent import BuildingAgent
from .config import get_session
from .db_manager import save_building, save_floor
from .plan_annotator import annotate_plan_with_room_numbers
from .schema_models import Building
from .storage_client import upload_annotated_plan
from .vision_processor import extract_rooms_from_file

logger = logging.getLogger(__name__)


app = FastAPI(title="AeroTwin AI Building Agent")


class OnboardingResponse(BaseModel):
    """Response returned after a floor plan is processed and persisted."""

    building_id: str
    floor_level: int
    rooms_saved: int
    room_ids: list[str] = Field(default_factory=list)
    oriented_walls: dict[str, str]
    annotated_plan_url: str | None = None


class BuildingCreateRequest(BaseModel):
    """Payload to register a new building before uploading floor plans."""

    building_id: str
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    total_floors: int
    country_code: str = "DZ"


class BuildingResponse(BaseModel):
    building_id: str
    name: str
    address: str | None
    latitude: float | None
    longitude: float | None
    total_floors: int
    country_code: str


SessionDep = Annotated[Session, Depends(get_session)]


ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}


@app.post(
    "/buildings",
    response_model=BuildingResponse,
    status_code=201,
    summary="Register a new building",
)
async def create_building(
    payload: BuildingCreateRequest,
    session: SessionDep,
) -> BuildingResponse:
    if session.get(Building, payload.building_id) is not None:
        raise HTTPException(status_code=409, detail=f"Building already exists: {payload.building_id}")

    building = save_building(session, Building(**payload.model_dump()))
    return BuildingResponse(
        building_id=building.building_id,
        name=building.name,
        address=building.address,
        latitude=building.latitude,
        longitude=building.longitude,
        total_floors=building.total_floors,
        country_code=building.country_code,
    )


@app.post(
    "/buildings/{building_id}/floors/{floor_level}/upload",
    response_model=OnboardingResponse,
    summary="Upload a floor plan (PDF, JPEG, PNG, WEBP, GIF) and extract rooms",
)
async def upload_floor_plan(
    building_id: str,
    floor_level: int,
    north_direction: Annotated[str, Form(
        description="Where north points on the plan: top | bottom | left | right"
    )],
    plan_file: Annotated[UploadFile, File(
        description="Architectural plan — PDF, JPEG, PNG, WEBP, or GIF"
    )],
    session: SessionDep,
) -> OnboardingResponse:
    if not plan_file.filename:
        raise HTTPException(status_code=422, detail="Uploaded file must have a filename")

    if north_direction.lower() not in {"top", "bottom", "left", "right"}:
        raise HTTPException(status_code=422, detail="north_direction must be: top | bottom | left | right")

    content_type = (plan_file.content_type or "").lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Accepted: PDF, JPEG, PNG, WEBP, GIF.",
        )

    file_bytes = await plan_file.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    try:
        detected_rooms = extract_rooms_from_file(
            file_bytes=file_bytes,
            filename=plan_file.filename,
            api_key=groq_api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Vision extraction failed: {exc}") from exc

    if not detected_rooms:
        raise HTTPException(
            status_code=422,
            detail="No rooms detected. Check image quality or try a clearer plan.",
        )

    agent = BuildingAgent(session_factory=lambda: iter([session]))
    try:
        result = agent.process_and_save_floor(
            building_id=building_id,
            floor_level=floor_level,
            detected_rooms_list=detected_rooms,
            north_click_direction=north_direction.lower(),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Best-effort: rooms are already persisted at this point, so a rendering
    # or upload failure here shouldn't turn a successful save into a 500.
    annotated_plan_url: str | None = None
    try:
        annotated_bytes = annotate_plan_with_room_numbers(
            file_bytes, plan_file.filename, result["normalized_rooms"]
        )
        annotated_plan_url = upload_annotated_plan(annotated_bytes, building_id, floor_level)
        floor = result["floor"]
        floor.floor_plan_url = annotated_plan_url
        save_floor(session, floor)
    except Exception:
        logger.exception(
            "Failed to render/upload annotated plan for building=%s floor=%s",
            building_id,
            floor_level,
        )

    return OnboardingResponse(
        building_id=building_id,
        floor_level=floor_level,
        rooms_saved=len(result["rooms"]),
        room_ids=[room.room_id for room in result["rooms"]],
        oriented_walls=result["oriented_walls"],
        annotated_plan_url=annotated_plan_url,
    )