"""Top-level agent namespace.

No eager imports here on purpose: importing any one agent (e.g.
`agents.thermal_agent`) must not transitively import another agent's
package and its dependency tree. `agents.BuildingAgent` still works as a
convenience via PEP 562 lazy attribute access -- it just doesn't run
until something actually asks for it.
"""

from __future__ import annotations

from typing import Any

__all__ = ["BuildingAgent"]


def __getattr__(name: str) -> Any:
    if name == "BuildingAgent":
        from .building_agent import BuildingAgent

        return BuildingAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
