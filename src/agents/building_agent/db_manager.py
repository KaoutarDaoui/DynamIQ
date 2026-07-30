"""CRUD helpers for SQLModel persistence."""

from __future__ import annotations

from sqlmodel import Session, select

from .schema_models import Building, Floor, Room


def _save_model(session: Session, model: Building | Floor | Room) -> Building | Floor | Room:
    persisted_model = session.merge(model)
    session.commit()
    session.refresh(persisted_model)
    return persisted_model


def save_building(session: Session, building: Building) -> Building:
    """Persist a building row and return the managed instance."""

    return _save_model(session, building)  # type: ignore[return-value]


def save_floor(session: Session, floor: Floor) -> Floor:
    """Persist a floor row and return the managed instance."""

    return _save_model(session, floor)  # type: ignore[return-value]


def save_room(session: Session, room: Room) -> Room:
    """Persist or update a room row and return the managed instance."""

    return _save_model(session, room)  # type: ignore[return-value]


def get_room_by_id(session: Session, room_id: str) -> Room:
    """Fetch a room by primary key."""

    room = session.get(Room, room_id)
    if room is None:
        raise LookupError(f"Room not found: {room_id}")
    return room


def get_rooms_by_orientation(session: Session, orientation: str) -> list[Room]:
    """Fetch all rooms whose primary orientation matches the requested value."""

    statement = select(Room).where(Room.primary_orientation == orientation)
    return list(session.exec(statement).all())
