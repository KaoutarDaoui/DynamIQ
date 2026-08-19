"""Create a login user for the DynamIQ frontend.

Usage:
    python scripts/create_user.py --name "Kaoutar Daoui" --email mk_daoui@esi.dz --org-id ORG_AMAZON --role admin
    python scripts/create_user.py --name "..." --email "..." --org-id ORG_AMAZON --password "chosen-password"

org_id determines which buildings this user can see (buildings.org_id is
the same scoping already used everywhere else) -- pick the org that already
owns the buildings this person should have access to.

If --password is omitted, a random one is generated and printed once --
it is hashed before being stored, so this is the only time you'll see it.
"""
from __future__ import annotations

import argparse
import secrets
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from sqlmodel import Session

from agents.building_agent.auth import create_user, ensure_users_tables, get_user_by_email
from agents.building_agent.config import engine


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--org-id", required=True, help="Which organisation's buildings this user can see.")
    parser.add_argument("--role", default="viewer", choices=["admin", "facility_manager", "technician", "viewer"])
    parser.add_argument("--password", default=None, help="Omit to auto-generate a random password.")
    args = parser.parse_args()

    ensure_users_tables(engine)
    password = args.password or secrets.token_urlsafe(12)

    with Session(engine, expire_on_commit=False) as session:
        existing = get_user_by_email(session, args.email)
        if existing is not None:
            raise SystemExit(f"A user with email {args.email!r} already exists (user_id={existing.user_id}).")
        user = create_user(
            session,
            user_id=f"user-{uuid.uuid4().hex[:8]}",
            name=args.name,
            email=args.email,
            password=password,
            org_id=args.org_id,
            role=args.role,
        )

    print(f"Created user {user.user_id} ({user.email}), org={user.org_id}, role={user.role}")
    if not args.password:
        print(f"Generated password: {password}")
        print("Save this now -- it is hashed in the database and cannot be recovered.")


if __name__ == "__main__":
    main()
