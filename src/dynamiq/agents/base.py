"""Shared base for the four agents in the DynamIQ architecture."""
from __future__ import annotations

from abc import ABC


class Agent(ABC):
    """Common identity for Building, Thermal, Diagnostic, and Supervisor agents."""

    name: str
