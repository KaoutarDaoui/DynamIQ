"""Password hashing, session tokens, and user/session persistence for login.

Uses only stdlib primitives (hashlib.pbkdf2_hmac + secrets) rather than a new
dependency — this is a small internal tool, not a public-facing auth service.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .schema_models import User, UserSession

_PBKDF2_ITERATIONS = 260_000
SESSION_TTL = timedelta(days=30)

USERS_TABLES_DDL = """
CREATE TABLE IF NOT EXISTS public.users (
    user_id varchar PRIMARY KEY,
    name varchar NOT NULL,
    email varchar UNIQUE NOT NULL,
    password_hash varchar NOT NULL,
    password_salt varchar NOT NULL,
    org_id varchar REFERENCES organisations(org_id),
    role varchar NOT NULL DEFAULT 'viewer',
    created_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    token varchar PRIMARY KEY,
    user_id varchar NOT NULL REFERENCES users(user_id),
    created_at timestamptz,
    expires_at timestamptz
);
"""


def ensure_users_tables(engine) -> None:
    """Create users/user_sessions if they don't exist yet. Safe to call repeatedly."""

    with engine.begin() as conn:
        conn.exec_driver_sql(USERS_TABLES_DDL)


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), _PBKDF2_ITERATIONS)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return secrets.compare_digest(candidate, password_hash)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def create_user(session: Session, user_id: str, name: str, email: str, password: str, org_id: str | None, role: str = "viewer") -> User:
    password_hash, password_salt = hash_password(password)
    user = User(
        user_id=user_id,
        name=name,
        email=email.lower(),
        password_hash=password_hash,
        password_salt=password_salt,
        org_id=org_id,
        role=role,
        created_at=datetime.now(timezone.utc),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_user_by_email(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email.lower())).first()


def authenticate(session: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(session, email)
    if user is None:
        return None
    if not verify_password(password, user.password_hash, user.password_salt):
        return None
    return user


def create_session(session: Session, user_id: str) -> str:
    token = generate_token()
    now = datetime.now(timezone.utc)
    session.add(UserSession(token=token, user_id=user_id, created_at=now, expires_at=now + SESSION_TTL))
    session.commit()
    return token


def get_user_by_token(session: Session, token: str) -> User | None:
    row = session.get(UserSession, token)
    if row is None:
        return None
    expires_at = row.expires_at
    if expires_at is not None:
        # Some drivers hand back a naive datetime for a timestamptz column —
        # assume UTC (what create_session wrote) rather than comparing a
        # naive and an aware datetime, which raises instead of just being
        # wrong.
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return None
    return session.get(User, row.user_id)


def delete_session(session: Session, token: str) -> None:
    row = session.get(UserSession, token)
    if row is not None:
        session.delete(row)
        session.commit()
