"""Agent Bâtiment — the building's long-term memory.

Knows the floor plan, zone orientations, glazing, networks, and HVAC
types per zone, plus scheduled occupancy from the academic calendar.
Other agents query it in natural language; it returns structured
context (zones, orientation, scheduled occupancy).

In the target architecture this is backed by a Bedrock Knowledge Base
(RAG over building plan documents in S3). Locally, it is backed by an
in-memory building registry — no vector store, no deployment.

TODO:
    - load_building(): register a Building + its Zones from a local
      JSON/dict definition (see examples/sample_building.json).
    - get_context(zone_id): return structured zone context.
    - get_occupancy(zone_id, days): return scheduled occupancy windows
      from the synced calendar.
"""
from __future__ import annotations

from dynamiq.agents.base import Agent
from dynamiq.data.schemas import Building, Zone


class BuildingAgent(Agent):
    name = "agent_batiment"

    def load_building(self, building: Building, zones: list[Zone]) -> None:
        raise NotImplementedError

    def get_context(self, zone_id: str) -> Zone:
        raise NotImplementedError

    def get_occupancy(self, zone_id: str, days: int = 7) -> list:
        raise NotImplementedError
