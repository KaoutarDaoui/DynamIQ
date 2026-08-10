"""Main orchestration interface for the Building Agent."""

from __future__ import annotations

import os
import uuid
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from typing import Any

from langchain_core.runnables import RunnableConfig
from sqlmodel import Session

from .config import get_session
from .db_manager import get_room_by_id
from .graph import BuildingAgentState, building_graph
from .schema_models import Building, RoomConfig, default_room_config


class BuildingAgent:
    """Process architectural inputs and persist them as institutional memory."""

    def __init__(self, session_factory: Callable[[], Iterator[Session]] = get_session) -> None:
        self._session_factory = session_factory

    @contextmanager
    def _session_scope(self) -> Generator[Session, None, None]:
        session_generator = self._session_factory()
        session = next(session_generator)
        try:
            yield session
        finally:
            session.close()
            try:
                next(session_generator)
            except StopIteration:
                pass

    def run_graph(
        self,
        file_bytes: bytes,
        filename: str,
        north_angle_deg: float,
        building_id: str,
        floor_level: int,
        floor_name: str | None = None,
        expected_room_count: int | None = None,
    ) -> dict[str, Any]:
        """Run Agent 1's LangGraph agentic loop for one floor and return the final state.

        Replaces the former one-shot `process_and_save_floor`: extraction,
        geometry normalization, a sanity-checking loop with budgeted Groq
        tool-calls for low-confidence rooms, and persistence all happen
        inside `graph.building_graph`. This method just validates the
        building exists, seeds the initial state, and invokes it.
        """

        with self._session_scope() as session:
            if session.get(Building, building_id) is None:
                raise LookupError(f"Building not found: {building_id}")

        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not configured")

        initial_state: BuildingAgentState = {
            "file_bytes": file_bytes,
            "filename": filename,
            "north_angle_deg": north_angle_deg,
            "building_id": building_id,
            "floor_level": floor_level,
            "floor_name": floor_name,
            "expected_room_count": expected_room_count,
            "api_key": api_key,
            "run_log": [],
        }
        # Each upload is its own independent run — a fresh thread_id per
        # call means MemorySaver's checkpoints never bleed between uploads.
        run_config: RunnableConfig = {"configurable": {"thread_id": str(uuid.uuid4())}}
        return building_graph.invoke(initial_state, config=run_config)

    def get_thermal_parameters(self, room_id: str) -> dict[str, float | str]:
        """Return the room's thermal resistance and capacitance for Agent 2."""

        with self._session_scope() as session:
            room = get_room_by_id(session, room_id)
            config = RoomConfig.model_validate(room.config_json or default_room_config())
            return {
                "room_id": room_id,
                "R": config.thermal.wall_r_value,
                "C": config.thermal.estimated_C_zone,
                "wall_r_value": config.thermal.wall_r_value,
                "estimated_C_zone": config.thermal.estimated_C_zone,
            }
