from __future__ import annotations

import os

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_DIAGNOSTIC_MODEL = os.getenv("GROQ_DIAGNOSTIC_MODEL", "llama-3.3-70b-versatile")
GROQ_DIAGNOSTIC_MAX_TOKENS = 4000

GROQ_REASONING_EFFORT = {
    "qwen/qwen3.6-27b": "none",
    "openai/gpt-oss-20b": "low",
    "openai/gpt-oss-120b": "low",
}


def groq_extra_payload(model: str) -> dict[str, str]:
    """Reasoning-model params so qwen/gpt-oss don't burn max_tokens on hidden
    reasoning; non-reasoning models (llama family) get none."""
    if model in GROQ_REASONING_EFFORT:
        return {"reasoning_effort": GROQ_REASONING_EFFORT[model], "reasoning_format": "hidden"}
    if "gpt-oss" in model or "qwen" in model:
        return {"reasoning_effort": "low", "reasoning_format": "hidden"}
    return {}

TOOL_CALL_BUDGET = 8
MINIMUM_EVIDENCE_TOOLS = ("get_sensor_history", "get_calendar")

DEFAULT_COMFORT_BOUNDS_DELTA_C = 2.0

COOLDOWN_DAYS = 30

JSON_REPAIR_RETRIES = 2

VALID_ACTION_TYPES = (
    "setpoint_change",
    "schedule_correction",
    "shutdown",
    "lockout",
    "inspection_required",
    "no_action",
)

VALID_CAUSE_CONFIDENCE = ("high", "medium", "low", "undetermined")

HUMAN_ALERT_ACTION_TYPES = ("shutdown", "lockout")

SENSOR_HISTORY_DEFAULT_HOURS = 48
CALENDAR_DEFAULT_DAYS = 7
HVAC_LOGS_DEFAULT_HOURS = 24
SIMILAR_ANOMALIES_DEFAULT_DAYS = 30
