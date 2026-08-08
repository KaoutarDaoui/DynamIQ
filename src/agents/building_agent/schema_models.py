"""SQLModel tables and nested taxonomies for building memory.

Table/column names must match the hand-written Supabase DDL exactly —
SQLModel does not infer plurals, so every table needs an explicit
__tablename__.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Envelope(BaseModel):
    north_wall_m2: float = 0.0
    south_wall_m2: float = 0.0
    east_wall_m2: float = 0.0
    west_wall_m2: float = 0.0
    external_walls: list[str] = PydanticField(default_factory=list)
    internal_walls: list[str] = PydanticField(default_factory=list)


class Thermal(BaseModel):
    wall_r_value: float = 1.8
    window_u_value: float = 5.8
    thermal_mass: str = "heavy"
    estimated_C_zone: float = 145000.0


class HVAC(BaseModel):
    type: str = "split_unit"
    capacity_kw: float = 3.5
    cop_cooling: float = 2.8
    setpoint_occupied_c: float = 22.0


class Adjacency(BaseModel):
    north: str = "external"
    south: str = "external"
    east: str = "external"
    west: str = "external"


class RoomConfig(BaseModel):
    envelope: Envelope = PydanticField(default_factory=Envelope)
    thermal: Thermal = PydanticField(default_factory=Thermal)
    hvac: HVAC = PydanticField(default_factory=HVAC)
    adjacency: Adjacency = PydanticField(default_factory=Adjacency)


class Organisation(SQLModel, table=True):
    __tablename__ = "organisations"

    org_id: str = Field(primary_key=True)
    name: str
    email: str | None = None
    country_code: str = "DZ"
    plan: str = "free"
    created_at: datetime | None = None


class Building(SQLModel, table=True):
    __tablename__ = "buildings"

    building_id: str = Field(primary_key=True)
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    total_floors: int
    country_code: str = "DZ"
    created_at: datetime | None = None
    org_id: str | None = Field(default=None, foreign_key="organisations.org_id")


class Floor(SQLModel, table=True):
    __tablename__ = "floors"

    floor_id: str = Field(primary_key=True)
    building_id: str = Field(foreign_key="buildings.building_id", index=True)
    level: int
    name: str | None = None
    floor_plan_url: str | None = None
    created_at: datetime | None = None


class Room(SQLModel, table=True):
    __tablename__ = "rooms"

    room_id: str = Field(primary_key=True)
    floor_id: str = Field(foreign_key="floors.floor_id", index=True)
    room_label: str
    room_type: str = "classroom"
    area_m2: float
    volume_m3: float
    primary_orientation: str
    r_wall: float = 1.8
    c_zone: float = 145000.0
    sensor_id: str | None = None
    config_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime | None = None


class RoomAdjacency(SQLModel, table=True):
    __tablename__ = "room_adjacencies"

    room_id: str = Field(foreign_key="rooms.room_id", primary_key=True)
    adjacent_room_id: str = Field(primary_key=True)
    direction: str
    wall_type: str = "internal"


class AirConditioner(SQLModel, table=True):
    __tablename__ = "air_conditioners"

    ac_id: str = Field(primary_key=True)
    room_id: str = Field(foreign_key="rooms.room_id", index=True)
    manufacturer: str | None = None
    model: str | None = None
    serial_number: str | None = Field(default=None, unique=True)
    cooling_capacity_kw: float | None = None
    heating_capacity_kw: float | None = None
    power_kw: float | None = None
    installation_date: date | None = None
    status: str = "active"
    created_at: datetime | None = None
    pos_x: float | None = None
    pos_y: float | None = None


def default_room_config() -> dict[str, Any]:
    """Return the standard room configuration payload."""

    return RoomConfig().model_dump()
