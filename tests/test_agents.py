"""Tests for the agent layer — to be filled in once the agents are
implemented.

Planned cases:
    - Supervisor.decide() sends deltas beyond comfort_bounds_delta_c to
      human alert, regardless of what the Diagnostic agent proposed.
    - Supervisor.decide() routes shutdown/lockout actions to human alert.
    - Supervisor.decide() logs only (no autonomous action) while a
      zone's diagnostic cooldown is active.
    - BuildingAgent.get_context() returns the zone that was loaded.
"""


def test_placeholder() -> None:
    assert True
