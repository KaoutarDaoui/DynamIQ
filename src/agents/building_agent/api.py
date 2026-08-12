"""FastAPI routes for the Building Agent onboarding flow."""

from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from agents.logging_config import configure_agent_logging
from .building_agent import BuildingAgent
from .config import engine, get_session
from .db_manager import replace_room_air_conditioners, save_building, save_floor
from .graph import ensure_building_agent_runs_table
from .plan_annotator import annotate_plan_with_room_numbers
from .schema_models import Building, Floor, Room
from .storage_client import upload_annotated_plan

configure_agent_logging("agents.building_agent", "building_agent.log")

logger = logging.getLogger(__name__)

# Multi-tenant org support isn't built yet — every building/query is scoped
# to this single hardcoded org until the frontend has an org switcher.
DEFAULT_ORG_ID = "ORG_AMAZON"


app = FastAPI(title="AeroTwin AI Building Agent")

app.add_middleware(
    CORSMiddleware,
    # Vite picks the next free port (5173, 5174, ...) when one's already
    # taken, so pin the regex to localhost/127.0.0.1 rather than one port.
    # Tighten this once there's a deployed frontend origin to pin instead.
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _ensure_run_log_table() -> None:
    ensure_building_agent_runs_table(engine)


class HealthResponse(BaseModel):
    status: str
    db_configured: bool


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        with engine.connect():
            db_ok = True
    except Exception:
        db_ok = False
    return HealthResponse(status="ok", db_configured=db_ok)


class RoomOut(BaseModel):
    room_id: str
    room_label: str
    room_type: str
    area_m2: float
    volume_m3: float
    primary_orientation: str
    needs_review: bool = False


class OnboardingResponse(BaseModel):
    """Response returned after a floor plan is processed and persisted."""

    building_id: str
    floor_level: int
    floor_id: str
    rooms_saved: int
    rooms_flagged: int
    room_ids: list[str] = Field(default_factory=list)
    flagged_room_ids: list[str] = Field(default_factory=list)
    rooms: list[RoomOut] = Field(default_factory=list)
    oriented_walls: dict[str, str]
    iterations_used: int
    run_id: str
    annotated_plan_url: str | None = None


class BuildingCreateRequest(BaseModel):
    """Payload to register a new building before uploading floor plans."""

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
    org_id: str | None


class AcSetRequest(BaseModel):
    """Payload to set a room's AC units — replaces any existing units for that room."""

    count: int = Field(ge=0, le=20)
    capacity_kw: float = Field(gt=0)


class AcOut(BaseModel):
    ac_id: str
    cooling_capacity_kw: float | None
    power_kw: float | None


class BuildingSummary(BaseModel):
    """Building card data for the portfolio list — includes live counts."""

    building_id: str
    name: str
    address: str | None
    latitude: float | None
    longitude: float | None
    total_floors: int
    country_code: str
    floors_uploaded: int
    rooms_count: int


SessionDep = Annotated[Session, Depends(get_session)]


ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}


def _slugify_building_id(session: Session, name: str) -> str:
    """Derive a URL-safe, unique building_id from the building name."""

    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "building"
    candidate = slug
    while session.get(Building, candidate) is not None:
        candidate = f"{slug}-{uuid.uuid4().hex[:6]}"
    return candidate


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
    building_id = _slugify_building_id(session, payload.name)
    building = save_building(
        session,
        Building(building_id=building_id, org_id=DEFAULT_ORG_ID, **payload.model_dump()),
    )
    return BuildingResponse(
        building_id=building.building_id,
        name=building.name,
        address=building.address,
        latitude=building.latitude,
        longitude=building.longitude,
        total_floors=building.total_floors,
        country_code=building.country_code,
        org_id=building.org_id,
    )


@app.get(
    "/organisations/{org_id}/buildings",
    response_model=list[BuildingSummary],
    summary="List buildings in an organisation, with live floor/room counts",
)
async def list_org_buildings(org_id: str, session: SessionDep) -> list[BuildingSummary]:
    buildings = session.exec(select(Building).where(Building.org_id == org_id)).all()

    summaries: list[BuildingSummary] = []
    for building in buildings:
        floors_uploaded = session.exec(
            select(func.count()).select_from(Floor).where(Floor.building_id == building.building_id)
        ).one()
        floor_ids = session.exec(
            select(Floor.floor_id).where(Floor.building_id == building.building_id)
        ).all()
        rooms_count = (
            session.exec(select(func.count()).select_from(Room).where(Room.floor_id.in_(floor_ids))).one()
            if floor_ids
            else 0
        )
        summaries.append(
            BuildingSummary(
                building_id=building.building_id,
                name=building.name,
                address=building.address,
                latitude=building.latitude,
                longitude=building.longitude,
                total_floors=building.total_floors,
                country_code=building.country_code,
                floors_uploaded=floors_uploaded,
                rooms_count=rooms_count,
            )
        )
    return summaries


@app.post(
    "/buildings/{building_id}/floors/{floor_level}/upload",
    response_model=OnboardingResponse,
    summary="Upload a floor plan (PDF, JPEG, PNG, WEBP, GIF) and extract rooms",
)
async def upload_floor_plan(
    building_id: str,
    floor_level: int,
    north_angle_deg: Annotated[float, Form(
        description="Clockwise degrees from the image's top edge to true north (0-359), from the compass dial"
    )],
    plan_file: Annotated[UploadFile, File(
        description="Architectural plan — PDF, JPEG, PNG, WEBP, or GIF"
    )],
    session: SessionDep,
    floor_name: Annotated[str | None, Form(description="Optional display name for the floor")] = None,
    expected_room_count: Annotated[
        int | None, Form(description="Optional sanity-check count used by the agentic loop's count_match gate")
    ] = None,
) -> OnboardingResponse:
    if not plan_file.filename:
        raise HTTPException(status_code=422, detail="Uploaded file must have a filename")

    content_type = (plan_file.content_type or "").lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Accepted: PDF, JPEG, PNG, WEBP, GIF.",
        )

    file_bytes = await plan_file.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    agent = BuildingAgent(session_factory=lambda: iter([session]))
    try:
        result = agent.run_graph(
            file_bytes=file_bytes,
            filename=plan_file.filename,
            north_angle_deg=north_angle_deg,
            building_id=building_id,
            floor_level=floor_level,
            floor_name=floor_name,
            expected_room_count=expected_room_count,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Vision extraction failed: {exc}") from exc

    # Extraction happens inside the graph, so an empty-detection failure only
    # surfaces here — the floor row from `persist` already exists (with 0
    # rooms) by this point; re-uploading a better plan for the same floor
    # will just overwrite it via `merge()`, so this is harmless.
    if result.get("extraction_raw_count", 0) == 0:
        raise HTTPException(
            status_code=422,
            detail="No rooms detected. Check image quality or try a clearer plan.",
        )

    floor_id = f"{building_id}-floor-{floor_level}"

    # Best-effort: rooms are already persisted at this point, so a rendering
    # or upload failure here shouldn't turn a successful save into a 500.
    annotated_plan_url: str | None = None
    try:
        annotated_bytes = annotate_plan_with_room_numbers(
            file_bytes, plan_file.filename, result["rooms"]
        )
        annotated_plan_url = upload_annotated_plan(annotated_bytes, building_id, floor_level)
        floor = session.get(Floor, floor_id) or result["floor"]
        floor.floor_plan_url = annotated_plan_url
        save_floor(session, floor)
    except Exception:
        logger.exception(
            "Failed to render/upload annotated plan for building=%s floor=%s",
            building_id,
            floor_level,
        )

    flagged_ids = set(result.get("flagged_rooms", []))
    logger.info(
        "onboarding building=%s floor=%s rooms_saved=%d flagged=%d run_id=%s",
        building_id,
        floor_id,
        len(result.get("saved_rooms", [])),
        len(flagged_ids),
        result.get("run_id"),
    )
    return OnboardingResponse(
        building_id=building_id,
        floor_level=floor_level,
        floor_id=floor_id,
        rooms_saved=len(result.get("saved_rooms", [])),
        rooms_flagged=len(result.get("flagged_rooms", [])),
        room_ids=result.get("saved_rooms", []),
        flagged_room_ids=result.get("flagged_rooms", []),
        rooms=[
            RoomOut(
                room_id=room["room_id"],
                room_label=room["room_label"],
                room_type=room.get("room_type", "classroom"),
                area_m2=room["area_m2"],
                volume_m3=room["volume_m3"],
                primary_orientation=room.get("primary_orientation", "unknown"),
                needs_review=room["room_id"] in flagged_ids,
            )
            for room in result["rooms"]
        ],
        oriented_walls=result["oriented_walls"],
        iterations_used=result.get("iteration", 0),
        run_id=result["run_id"],
        annotated_plan_url=annotated_plan_url,
    )


@app.post(
    "/rooms/{room_id}/air-conditioners",
    response_model=list[AcOut],
    status_code=201,
    summary="Set a room's AC units (count + shared capacity), replacing any existing ones",
)
async def set_room_air_conditioners(
    room_id: str,
    payload: AcSetRequest,
    session: SessionDep,
) -> list[AcOut]:
    if session.get(Room, room_id) is None:
        raise HTTPException(status_code=404, detail=f"Room not found: {room_id}")

    acs = replace_room_air_conditioners(session, room_id, payload.count, payload.capacity_kw)
    return [
        AcOut(ac_id=ac.ac_id, cooling_capacity_kw=ac.cooling_capacity_kw, power_kw=ac.power_kw)
        for ac in acs
    ]