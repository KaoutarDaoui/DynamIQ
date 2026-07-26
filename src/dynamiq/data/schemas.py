"""Pydantic data models shared across agents.

These mirror the RDS tables described in the project brief
(sensor_readings, rc_model_params, mpc_schedules, anomalies, alerts,
buildings, zones) without requiring a database to exist yet.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Orientation(str, Enum):
    NORTH = "N"
    SOUTH = "S"
    EAST = "E"
    WEST = "W"


class HVACType(str, Enum):
    SPLIT_UNIT = "split_unit"
    CENTRAL_AHU = "central_ahu"
    RADIATOR = "radiator"
    NONE = "none"


class Building(BaseModel):
    building_id: str
    name: str
    lat: float
    lon: float
    floor_area_m2: float


class Zone(BaseModel):
    zone_id: str
    building_id: str
    name: str
    area_m2: float
    orientation: Orientation
    glazing_ratio: float = Field(ge=0.0, le=1.0)
    hvac_type: HVACType
    t_min_c: float = 19.0
    t_max_c: float = 24.0
    t_standby_c: float = 16.0


class SensorReading(BaseModel):
    zone_id: str
    timestamp: datetime
    temperature_c: float
    humidity_pct: float | None = None
    occupancy: bool | None = None
    hvac_on: bool | None = None


class RCParams(BaseModel):
    """Calibrated grey-box RC network parameters for one zone."""

    zone_id: str
    r_wall: float  # K/W, thermal resistance of opaque envelope
    r_window: float  # K/W, thermal resistance of glazing
    c_zone: float  # J/K, thermal capacitance (mass) of the zone
    rmse_c: float | None = None  # calibration fit quality, reported honestly
    calibrated_at: datetime = Field(default_factory=datetime.utcnow)
    version: int = 1


class SetpointTrajectory(BaseModel):
    zone_id: str
    computed_at: datetime = Field(default_factory=datetime.utcnow)
    horizon_hours: int
    timestamps: list[datetime]
    setpoints_c: list[float]
    predicted_temps_c: list[float]
    energy_kwh: float
    carbon_gco2: float


class AnomalyType(str, Enum):
    OVERHEATING = "overheating"
    OVERCOOLING = "overcooling"
    STUCK_DAMPER = "stuck_damper"
    SIMULTANEOUS_HEAT_COOL = "simultaneous_heat_cool"
    SCHEDULE_MISMATCH = "schedule_mismatch"


class Anomaly(BaseModel):
    zone_id: str
    detected_at: datetime = Field(default_factory=datetime.utcnow)
    anomaly_type: AnomalyType
    delta_c: float
    expected_temp_c: float
    actual_temp_c: float
    since: datetime | None = None


class ActionType(str, Enum):
    SETPOINT_CHANGE = "setpoint_change"
    STANDBY = "standby"
    SHUTDOWN = "shutdown"
    LOCKOUT = "lockout"
    LOG_ONLY = "log_only"


class ProposedAction(BaseModel):
    zone_id: str
    action_type: ActionType
    target_setpoint_c: float | None = None
    rationale: str


class Alert(BaseModel):
    zone_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    title: str
    finding: str
    cause: str
    energy_wasted_kwh: float | None = None
    recommended_action: ProposedAction
    autonomous: bool
