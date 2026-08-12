from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import httpx

from . import constants


class AlertChannel(Protocol):
    name: str

    def send(self, payload: dict[str, Any]) -> bool: ...


class LogChannel:
    name = "log"

    def __init__(self, path: str = constants.ALERT_LOG_PATH) -> None:
        self.path = Path(path)

    def send(self, payload: dict[str, Any]) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {"sent_at": datetime.now(timezone.utc).isoformat(), **payload}
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        return True


class WebhookChannel:
    name = "webhook"

    def __init__(self, url: str, timeout_s: float = constants.ALERT_WEBHOOK_TIMEOUT_S) -> None:
        self.url = url
        self.timeout_s = timeout_s

    def send(self, payload: dict[str, Any]) -> bool:
        try:
            response = httpx.post(self.url, json=payload, timeout=self.timeout_s)
            return response.status_code < 400
        except httpx.HTTPError:
            return False


def get_configured_channels() -> list[AlertChannel]:
    channels: list[AlertChannel] = [LogChannel()]
    webhook_url = os.getenv(constants.ALERT_WEBHOOK_URL_ENV)
    if webhook_url:
        channels.append(WebhookChannel(webhook_url))
    return channels


def dispatch(payload: dict[str, Any], channels: list[AlertChannel] | None = None) -> dict[str, bool]:
    channels = channels if channels is not None else get_configured_channels()
    results: dict[str, bool] = {}
    for channel in channels:
        try:
            results[channel.name] = channel.send(payload)
        except Exception:
            results[channel.name] = False
    return results
