"""FastAPI routes for the Building Agent onboarding flow."""

from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select, text

from agents.logging_config import configure_agent_logging
from .auth import authenticate, create_session, delete_session, ensure_users_tables, get_user_by_token
from .building_agent import BuildingAgent
from .config import engine, get_session
from .db_manager import replace_room_air_conditioners, save_building, save_floor
from .graph import ensure_building_agent_runs_table
from .plan_annotator import annotate_plan_with_room_numbers
from .schema_models import AirConditioner, Building, Floor, Room, User
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
    # BUILDING_API_CORS_ORIGINS (comma-separated) adds the deployed frontend
    # origin(s) on top of that -- same pattern as the other 3 services.
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_origins=[o for o in os.getenv("BUILDING_API_CORS_ORIGINS", "").split(",") if o],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _ensure_run_log_table() -> None:
    ensure_building_agent_runs_table(engine)
    ensure_users_tables(engine)


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


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    user_id: str
    name: str
    email: str
    org_id: str | None
    role: str


class LoginResponse(BaseModel):
    token: str
    user: UserOut


def _user_out(user: User) -> UserOut:
    return UserOut(user_id=user.user_id, name=user.name, email=user.email, org_id=user.org_id, role=user.role)


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip()


def current_user(session: SessionDep, authorization: Annotated[str | None, Header()] = None) -> User:
    token = _bearer_token(authorization)
    user = get_user_by_token(session, token) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


CurrentUserDep = Annotated[User, Depends(current_user)]


@app.post("/auth/login", response_model=LoginResponse, summary="Sign in with email + password")
async def login(payload: LoginRequest, session: SessionDep) -> LoginResponse:
    user = authenticate(session, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_session(session, user.user_id)
    return LoginResponse(token=token, user=_user_out(user))


@app.get("/auth/me", response_model=UserOut, summary="Current user for a session token")
async def me(user: CurrentUserDep) -> UserOut:
    return _user_out(user)


@app.post("/auth/logout", response_model=None, status_code=204, summary="Invalidate the current session token")
async def logout(session: SessionDep, authorization: Annotated[str | None, Header()] = None) -> None:
    token = _bearer_token(authorization)
    if token:
        delete_session(session, token)


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


# The onboarding wizard doesn't collect latitude/longitude, so a building
# created without them would otherwise get NULL coordinates -- harmless
# until Agent 2's weather-dependent code (live sensor simulation, solar
# gain, MPC) tries to use them and crashes on `round(None, 3)`. Default to
# Algiers, matching this product's scoped deployment target (see README).
_DEFAULT_LATITUDE = 36.749
_DEFAULT_LONGITUDE = 3.033


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
    data = payload.model_dump()
    if data["latitude"] is None:
        data["latitude"] = _DEFAULT_LATITUDE
    if data["longitude"] is None:
        data["longitude"] = _DEFAULT_LONGITUDE
    building = save_building(
        session,
        Building(building_id=building_id, org_id=DEFAULT_ORG_ID, **data),
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


# sensor_readings / rc_model_params / anomalies / mpc_schedules / diagnoses /
# alerts belong to Agent 2/3's own SQLModel registry (thermal_agent.db), not
# this one, and have no foreign key back to rooms -- deleting a building
# only cascades buildings -> floors -> rooms -> room_adjacencies /
# air_conditioners at the DB level. These tables are cleaned up by name
# instead of importing Agent 2/3's models, per the "agents don't import each
# other" rule -- they share the database, not each other's code.
_ROOM_KEYED_TABLES_WITHOUT_FK = (
    "sensor_readings",
    "rc_model_params",
    "anomalies",
    "mpc_schedules",
    "diagnoses",
    "alerts",
)


@app.delete(
    "/buildings/{building_id}",
    response_model=None,
    status_code=204,
    summary="Delete a building and every room, floor, and thermal record under it",
)
async def delete_building(building_id: str, session: SessionDep) -> None:
    building = session.get(Building, building_id)
    if building is None:
        raise HTTPException(status_code=404, detail=f"Building not found: {building_id}")

    room_ids = session.exec(
        select(Room.room_id).join(Floor, Floor.floor_id == Room.floor_id).where(Floor.building_id == building_id)
    ).all()

    if room_ids:
        params = {f"r{i}": room_id for i, room_id in enumerate(room_ids)}
        placeholders = ", ".join(f":{key}" for key in params)
        for table in _ROOM_KEYED_TABLES_WITHOUT_FK:
            session.execute(text(f"DELETE FROM {table} WHERE room_id IN ({placeholders})"), params)

    session.execute(text("DELETE FROM orchestration_runs WHERE building_id = :building_id"), {"building_id": building_id})
    session.delete(building)
    session.commit()


class AcRegistryEntry(BaseModel):
    room_id: str
    room_label: str
    floor_id: str
    floor_level: int
    ac_id: str
    manufacturer: str | None
    model: str | None
    cooling_capacity_kw: float | None
    heating_capacity_kw: float | None
    power_kw: float | None
    status: str


@app.get(
    "/buildings/{building_id}/ac-registry",
    response_model=list[AcRegistryEntry],
    summary="List every room and its AC units for a building",
)
async def get_ac_registry(building_id: str, session: SessionDep) -> list[AcRegistryEntry]:
    floor_rows = session.exec(
        select(Floor.floor_id, Floor.level).where(Floor.building_id == building_id)
    ).all()
    level_by_floor = {floor_id: level for floor_id, level in floor_rows}
    if not level_by_floor:
        return []
    room_rows = session.exec(
        select(Room).where(Room.floor_id.in_(level_by_floor.keys())).order_by(Room.room_label.asc())
    ).all()
    room_labels = {r.room_id: r.room_label for r in room_rows}
    if not room_labels:
        return []
    ac_rows = session.exec(
        select(AirConditioner)
        .where(AirConditioner.room_id.in_(room_labels.keys()))
        .order_by(AirConditioner.ac_id.asc())
    ).all()
    acs_by_room: dict[str, list[AirConditioner]] = {}
    for ac in ac_rows:
        acs_by_room.setdefault(ac.room_id, []).append(ac)
    entries: list[AcRegistryEntry] = []
    for room in room_rows:
        level = level_by_floor.get(room.floor_id, 0)
        hvac = (room.config_json or {}).get("hvac", {}) if isinstance(room.config_json, dict) else {}
        room_acs = acs_by_room.get(room.room_id, [])
        if room_acs:
            for ac in room_acs:
                entries.append(
                    AcRegistryEntry(
                        room_id=ac.room_id,
                        room_label=room_labels[ac.room_id],
                        floor_id=room.floor_id,
                        floor_level=level,
                        ac_id=ac.ac_id,
                        manufacturer=ac.manufacturer,
                        model=ac.model,
                        cooling_capacity_kw=ac.cooling_capacity_kw,
                        heating_capacity_kw=ac.heating_capacity_kw,
                        power_kw=ac.power_kw,
                        status=ac.status,
                    )
                )
        else:
            entries.append(
                AcRegistryEntry(
                    room_id=room.room_id,
                    room_label=room.room_label,
                    floor_id=room.floor_id,
                    floor_level=level,
                    ac_id=f"{room.room_id}-ac-01",
                    manufacturer=None,
                    model=None,
                    cooling_capacity_kw=hvac.get("capacity_kw"),
                    heating_capacity_kw=None,
                    power_kw=None,
                    status="active",
                )
            )
    return entries


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