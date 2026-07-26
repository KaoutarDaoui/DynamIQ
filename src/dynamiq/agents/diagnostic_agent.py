"""Agent Diagnostic — the only real-time LLM, triggered on anomaly only.

Turns a detected temperature deviation into a human-readable finding +
cause + recommended action, using Claude tool use over the functions in
tools.py. Uses the Anthropic API directly (a stand-in for Amazon Bedrock
at deployment time — no AWS wiring here).

Reasoning flow (per the brief):
    1. Receive an Anomaly from Agent Thermique.
    2. Call tools to gather facts (sensor history, calendar, HVAC logs,
       past anomalies).
    3. Synthesize a causal explanation.
    4. Propose an action with a classification (autonomous vs human
       alert is *enforced* by the Supervisor, not decided by the LLM).
    5. Return an Alert.

TODO:
    - build_tool_schemas(): translate agents.tools functions into Claude
      tool-use JSON schemas.
    - diagnose(anomaly): run the tool-use conversation loop against
      Claude and parse the result into an Alert.
"""
from __future__ import annotations

from dynamiq.agents.base import Agent
from dynamiq.data.schemas import Alert, Anomaly


class DiagnosticAgent(Agent):
    name = "agent_diagnostic"

    def diagnose(self, anomaly: Anomaly) -> Alert:
        raise NotImplementedError
