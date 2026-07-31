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

    # Without this, every commit inside a multi-row loop (e.g. saving each
    # room) expires *all* previously loaded ORM objects in the session, not
    # just the one just committed — so by the time the caller reads
    # attributes off earlier objects (e.g. building the API response), it
    # triggers a DetachedInstanceError once the session is closed. Verified
    # live: DB writes succeeded, but response construction crashed.
    with Session(engine, expire_on_commit=False) as session:
        yield session