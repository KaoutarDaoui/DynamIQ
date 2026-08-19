from __future__ import annotations

import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Engine, func, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import registry as orm_registry
from sqlmodel import Column, Field, Session, SQLModel, select

load_dotenv()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set (see .env.example)")
    return create_engine(database_url, pool_size=3, max_overflow=2, pool_pre_ping=True)


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


class BuildingsTable(SupervisorBase, table=True):
    __tablename__ = "buildings"
    building_id: str = Field(primary_key=True)
    org_id: str | None = None


class OrganisationsTable(SupervisorBase, table=True):
    __tablename__ = "organisations"
    org_id: str = Field(primary_key=True)
    email: str | None = None


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


def fetch_org_alert_email(engine: Engine, building_id: str) -> str | None:
    with Session(engine) as session:
        result = session.exec(
            select(OrganisationsTable.email)
            .join(BuildingsTable, BuildingsTable.org_id == OrganisationsTable.org_id)
            .where(BuildingsTable.building_id == building_id)
        ).first()
    return result


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


# ── orchestration_runs ──────────────────────────────────────────────────
# Owns its own table definition (not shared schema) per the same file-scope
# convention as building_agent.graph. One row per full orchestration cycle.

ORCHESTRATION_RUNS_DDL = """
CREATE TABLE IF NOT EXISTS public.orchestration_runs (
    id serial PRIMARY KEY,
    building_id varchar,
    ran_at timestamptz,
    calibration_count integer,
    fast_loop_count integer,
    diagnoses_count integer,
    alerts_dispatched jsonb,
    fast_loop_detail jsonb,
    diagnosis_detail jsonb,
    calibration_detail jsonb,
    created_at timestamptz
);
"""


class OrchestrationRunsTable(SupervisorBase, table=True):
    __tablename__ = "orchestration_runs"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    building_id: str | None = None
    ran_at: datetime | None = None
    calibration_count: int | None = None
    fast_loop_count: int | None = None
    diagnoses_count: int | None = None
    alerts_dispatched: Any = Field(default=None, sa_column=Column(JSONB))
    fast_loop_detail: Any = Field(default=None, sa_column=Column(JSONB))
    diagnosis_detail: Any = Field(default=None, sa_column=Column(JSONB))
    calibration_detail: Any = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime | None = None


def ensure_orchestration_runs_table(engine: Engine) -> None:
    """Create orchestration_runs if it doesn't exist yet. Safe to call repeatedly."""
    with engine.begin() as conn:
        conn.exec_driver_sql(ORCHESTRATION_RUNS_DDL)


def insert_orchestration_run(engine: Engine, record: dict[str, Any]) -> int:
    with Session(engine) as session:
        row = OrchestrationRunsTable(
            building_id=record["building_id"],
            ran_at=record["ran_at"],
            calibration_count=record.get("calibration_count"),
            fast_loop_count=record.get("fast_loop_count"),
            diagnoses_count=record.get("diagnoses_count"),
            alerts_dispatched=record.get("alerts_dispatched"),
            fast_loop_detail=record.get("fast_loop_detail"),
            diagnosis_detail=record.get("diagnosis_detail"),
            calibration_detail=record.get("calibration_detail"),
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id


def fetch_recent_orchestration_runs(engine: Engine, building_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with Session(engine) as session:
        rows = session.exec(
            select(OrchestrationRunsTable)
            .where(OrchestrationRunsTable.building_id == building_id)
            .order_by(OrchestrationRunsTable.ran_at.desc())
            .limit(limit)
        ).all()
    return [
        {
            "id": r.id,
            "building_id": r.building_id,
            "ran_at": r.ran_at,
            "calibration_count": r.calibration_count,
            "fast_loop_count": r.fast_loop_count,
            "diagnoses_count": r.diagnoses_count,
            "alerts_dispatched": r.alerts_dispatched,
            "fast_loop_detail": r.fast_loop_detail,
            "diagnosis_detail": r.diagnosis_detail,
            "calibration_detail": r.calibration_detail,
            "created_at": r.created_at,
        }
        for r in rows
    ]
