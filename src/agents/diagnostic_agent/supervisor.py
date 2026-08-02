from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from . import constants

Decision = Literal["autonomous", "human_alert", "log_only"]


@dataclass(frozen=True)
class SupervisorDecision:
    decision: Decision
    reason: str


def get_comfort_bounds_delta_c(building_context: dict[str, Any] | None) -> float:
    if building_context is None:
        return constants.DEFAULT_COMFORT_BOUNDS_DELTA_C
    config = building_context.get("config_json") or {}
    diagnostic_cfg = config.get("diagnostic") or {}
    value = diagnostic_cfg.get("comfort_bounds_delta_c")
    return float(value) if isinstance(value, (int, float)) else constants.DEFAULT_COMFORT_BOUNDS_DELTA_C


def cooldown_active(recent_diagnoses: list[dict[str, Any]], now: datetime, cooldown_days: int = constants.COOLDOWN_DAYS) -> bool:
    cutoff = now - timedelta(days=cooldown_days)
    return any(d["created_at"] >= cutoff for d in recent_diagnoses)


def decide(
    validated_output: dict[str, Any],
    comfort_bounds_delta_c: float,
    recent_diagnoses_same_cause: list[dict[str, Any]],
    now: datetime,
) -> SupervisorDecision:
    action = validated_output["proposed_action"]
    action_type = action.get("type")
    delta_c = action.get("delta_c")

    if delta_c is not None and abs(delta_c) > comfort_bounds_delta_c:
        return SupervisorDecision(
            "human_alert",
            f"proposed delta_c={delta_c} exceeds comfort_bounds_delta_c={comfort_bounds_delta_c}",
        )

    if action_type in constants.HUMAN_ALERT_ACTION_TYPES:
        return SupervisorDecision("human_alert", f"action type {action_type!r} always routes to a human")

    if action_type == "inspection_required":
        return SupervisorDecision("human_alert", "inspection_required has no autonomous actor -- a human must look at it")

    if cooldown_active(recent_diagnoses_same_cause, now):
        return SupervisorDecision("log_only", f"same room+cause diagnosed within the last {constants.COOLDOWN_DAYS} days -- suppressing re-alert")

    return SupervisorDecision("autonomous", "within comfort bounds, not a high-risk action type, no active cooldown")
