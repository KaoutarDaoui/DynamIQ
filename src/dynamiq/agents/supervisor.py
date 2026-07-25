"""Agent Superviseur — single entry point, orchestration, and the
deterministic autonomous-vs-human decision rule.

15-minute cycle (per the brief):
    1. Trigger Agent Thermique with context from Agent Bâtiment; receive
       trajectory + anomalies.
    2. If anomalies are detected, mandate Agent Diagnostic; receive an
       Alert with a proposed action.
    3. Apply the decision rule deterministically (NOT via the LLM):
         - delta_c beyond comfort bounds        -> human alert
         - action_type in {shutdown, lockout}    -> human alert
         - cooldown active for this zone         -> log only
         - otherwise                             -> autonomous + log
    4. Record the cycle result (audit trail).

No database or deployment wiring here — the audit trail is an in-memory
list for now; swap in real persistence and Lambda/SNS at deployment
time.

TODO:
    - run_cycle(zone): execute the four steps above for one zone.
    - decide(alert): apply the deterministic decision rule.
"""
from __future__ import annotations

from dynamiq.agents.base import Agent
from dynamiq.agents.building_agent import BuildingAgent
from dynamiq.agents.diagnostic_agent import DiagnosticAgent
from dynamiq.agents.thermal_agent import ThermalAgent
from dynamiq.data.schemas import Alert, Zone


class Supervisor(Agent):
    name = "agent_superviseur"

    def __init__(
        self,
        building_agent: BuildingAgent,
        thermal_agent: ThermalAgent,
        diagnostic_agent: DiagnosticAgent,
    ) -> None:
        self.building_agent = building_agent
        self.thermal_agent = thermal_agent
        self.diagnostic_agent = diagnostic_agent
        self.audit_log: list[dict] = []

    def run_cycle(self, zone: Zone) -> None:
        raise NotImplementedError

    def decide(self, alert: Alert) -> bool:
        """Return True if the proposed action may run autonomously."""
        raise NotImplementedError
