from __future__ import annotations

from __future__ import annotations

from pathlib import Path

FAST_LOOP_INTERVAL_MINUTES = 15
CALIBRATION_INTERVAL_HOURS = 24
DIAGNOSIS_POLL_INTERVAL_MINUTES = 15

ALERT_LOG_PATH = str(Path(__file__).resolve().parents[2] / "logs" / "alerts.jsonl")
ALERT_WEBHOOK_URL_ENV = "SUPERVISOR_ALERT_WEBHOOK_URL"
ALERT_WEBHOOK_TIMEOUT_S = 10.0
