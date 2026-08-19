from __future__ import annotations

import os

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_DIAGNOSTIC_MODEL = os.getenv("GROQ_DIAGNOSTIC_MODEL", "qwen/qwen3.6-27b")
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

VALID_CAUSES = (
    "sensor_failure",
    "hvac_underperformance",
    "window_open_occupancy_gain",
    "unmodelled_internal_gain",
    "calibration_drift",
    "scheduling_error",
    "unknown",
)

# Cause -> allowed autonomous action type. Mapping is exclusive: each cause
# yields exactly one action family. "unknown" and causes without a safe
# autonomous actor always route to inspection_required (-> human at the gate).
CAUSE_TO_ACTION: dict[str, str] = {
    "sensor_failure": "inspection_required",
    "hvac_underperformance": "setpoint_change",
    "window_open_occupancy_gain": "setpoint_change",
    "unmodelled_internal_gain": "inspection_required",
    "calibration_drift": "schedule_correction",
    "scheduling_error": "schedule_correction",
    "unknown": "inspection_required",
}

# Evidence-weighted confidence thresholds (number of corroborating signals).
CONFIDENCE_HIGH_AT = 3
CONFIDENCE_MEDIUM_AT = 2
CONFIDENCE_LOW_AT = 1

# delta_c severity scale: how much of the residual to offset as a setpoint
# correction (fraction of the comfort band), applied as a clamp.
DELTA_C_GAIN = 1.0

# Energy waste: treat HVAC consumption below this many W as "not cooling".
HVAC_COOLING_POWER_W = 0.0

VALID_CAUSE_CONFIDENCE = ("high", "medium", "low", "undetermined")

HUMAN_ALERT_ACTION_TYPES = ("shutdown", "lockout")

SENSOR_HISTORY_DEFAULT_HOURS = 48
CALENDAR_DEFAULT_DAYS = 7
HVAC_LOGS_DEFAULT_HOURS = 24
SIMILAR_ANOMALIES_DEFAULT_DAYS = 30
