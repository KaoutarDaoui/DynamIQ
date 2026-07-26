"""Database configuration for the Building Agent."""

from __future__ import annotations

import os
from collections.abc import Iterator

from dotenv import load_dotenv
from sqlmodel import Session, create_engine


load_dotenv()


DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be defined in .env for the Building Agent")

engine = create_engine(DATABASE_URL, echo=True)


def get_session() -> Iterator[Session]:
    """Yield an active SQLModel session bound to the shared engine."""

    with Session(engine) as session:
        yield session
from sqlmodel import SQLModel
from .config import engine

# Cette ligne crée automatiquement les tables 'building', 'floor', et 'room' dans Supabase si elles n'existent pas encore !
SQLModel.metadata.create_all(engine)