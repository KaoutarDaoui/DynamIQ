"""SQLModel tables and nested taxonomies for building memory."""

from __future__ import annotations

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


class Building(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    address: str


class Floor(SQLModel, table=True):
    id: str = Field(primary_key=True)
    building_id: str = Field(foreign_key="building.id", index=True)
    floor_level: int


class Room(SQLModel, table=True):
    room_id: str = Field(primary_key=True)
    floor_id: str = Field(foreign_key="floor.id", index=True)
    room_label: str
    area_m2: float
    primary_orientation: str
    config_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


def default_room_config() -> dict[str, Any]:
    """Return the standard room configuration payload."""

    return RoomConfig().model_dump()
