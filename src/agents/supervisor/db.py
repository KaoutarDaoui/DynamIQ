from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Engine, func
from sqlalchemy.orm import registry as orm_registry
from sqlmodel import Field, Session, SQLModel, select


class SupervisorBase(SQLModel, registry=orm_registry()):
    pass


class RoomsTable(SupervisorBase, table=True):
    __tablename__ = "rooms"
    room_id: str = Field(primary_key=True)
    floor_id: str


class FloorsTable(SupervisorBase, table=True):
    __tablename__ = "floors"
    floor_id: str = Field(primary_key=True)
    building_id: str


class AnomaliesTable(SupervisorBase, table=True):
    __tablename__ = "anomalies"
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    anomaly_type: str
    opened_at: datetime
    diagnosed: bool = False


class RcModelParamsTable(SupervisorBase, table=True):
    __tablename__ = "rc_model_params"
    id: int | None = Field(default=None, primary_key=True)
    room_id: str
    created_at: datetime | None = None


def fetch_undiagnosed_anomaly_ids(engine: Engine, building_id: str) -> list[int]:
    with Session(engine) as session:
        rows = session.exec(
            select(AnomaliesTable.id)
            .join(RoomsTable, RoomsTable.room_id == AnomaliesTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id, AnomaliesTable.anomaly_type == "thermal_anomaly", AnomaliesTable.diagnosed == False)
            .order_by(AnomaliesTable.opened_at.asc())
        ).all()
    return list(rows)


def fetch_last_calibration_time(engine: Engine, building_id: str) -> datetime | None:
    with Session(engine) as session:
        result = session.exec(
            select(func.max(RcModelParamsTable.created_at))
            .join(RoomsTable, RoomsTable.room_id == RcModelParamsTable.room_id)
            .join(FloorsTable, FloorsTable.floor_id == RoomsTable.floor_id)
            .where(FloorsTable.building_id == building_id)
        ).first()
    if result is not None and result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result
