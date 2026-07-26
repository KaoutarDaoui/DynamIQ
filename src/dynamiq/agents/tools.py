"""Tool functions exposed to Agent Diagnostic via Claude tool use.

Mirrors the tool list from the brief. Each tool is a plain Python
function; the agent module wraps them into Claude tool-use schemas.

TODO: implement each tool against the in-memory / synthetic data sources
(sensor history, calendar, MPC trajectories, HVAC logs, past anomalies,
building context, neighboring zones).
"""
from __future__ import annotations


def get_sensor_history(zone_id: str, hours: int = 48) -> list:
    raise NotImplementedError


def get_calendar(zone_id: str, days: int = 7) -> list:
    raise NotImplementedError


def get_mpc_trajectory(zone_id: str) -> dict:
    raise NotImplementedError


def get_hvac_logs(zone_id: str, hours: int = 24) -> list:
    raise NotImplementedError


def get_similar_anomalies(zone_id: str, days: int = 30) -> list:
    raise NotImplementedError


def get_building_context(zone_id: str) -> dict:
    raise NotImplementedError


def check_neighboring_zones(zone_id: str) -> list:
    raise NotImplementedError
