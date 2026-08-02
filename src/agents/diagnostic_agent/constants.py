from __future__ import annotations

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_DIAGNOSTIC_MODEL = "llama-3.3-70b-versatile"

TOOL_CALL_BUDGET = 8
MINIMUM_EVIDENCE_TOOLS = ("get_sensor_history", "get_calendar")

DEFAULT_COMFORT_BOUNDS_DELTA_C = 2.0

COOLDOWN_DAYS = 7

JSON_REPAIR_RETRIES = 1

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
