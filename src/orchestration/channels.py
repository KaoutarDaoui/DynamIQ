from __future__ import annotations

import json
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
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


def _format_email_body(payload: dict[str, Any]) -> str:
    lines = [f"{key}: {value}" for key, value in payload.items() if key != "alert_email"]
    return "\n".join(lines)


class EmailChannel:
    name = "email"

    def __init__(
        self,
        smtp_host: str,
        smtp_port: int,
        username: str,
        password: str,
        to_addr: str,
        timeout_s: float = constants.ALERT_EMAIL_TIMEOUT_S,
    ) -> None:
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.to_addr = to_addr
        self.timeout_s = timeout_s

    def send(self, payload: dict[str, Any]) -> bool:
        # A per-building recipient looked up from the organisation's real
        # contact email (see orchestration.db.fetch_org_alert_email) takes
        # priority; SUPERVISOR_ALERT_EMAIL_TO is only the fallback when a
        # building's org has no email on file.
        to_addr = payload.get("alert_email") or self.to_addr
        if not to_addr:
            return False
        message = EmailMessage()
        room_id = payload.get("room_id", "unknown room")
        message["Subject"] = f"DynamIQ alert — {room_id}"
        message["From"] = self.username
        message["To"] = to_addr
        message.set_content(_format_email_body(payload))
        try:
            with smtplib.SMTP_SSL(self.smtp_host, self.smtp_port, timeout=self.timeout_s) as smtp:
                smtp.login(self.username, self.password)
                smtp.send_message(message)
            return True
        except (smtplib.SMTPException, OSError):
            return False


def get_configured_channels() -> list[AlertChannel]:
    channels: list[AlertChannel] = [LogChannel()]
    webhook_url = os.getenv(constants.ALERT_WEBHOOK_URL_ENV)
    if webhook_url:
        channels.append(WebhookChannel(webhook_url))

    # email_to is only a fallback default for buildings whose organisation has
    # no email on file — the real per-building recipient normally comes from
    # orchestration.db.fetch_org_alert_email at dispatch time, so it's not
    # required to activate the channel.
    smtp_host = os.getenv(constants.ALERT_EMAIL_SMTP_HOST_ENV)
    smtp_user = os.getenv(constants.ALERT_EMAIL_SMTP_USER_ENV)
    smtp_password = os.getenv(constants.ALERT_EMAIL_SMTP_PASSWORD_ENV)
    if smtp_host and smtp_user and smtp_password:
        smtp_port = int(os.getenv(constants.ALERT_EMAIL_SMTP_PORT_ENV) or constants.ALERT_EMAIL_DEFAULT_SMTP_PORT)
        email_to = os.getenv(constants.ALERT_EMAIL_TO_ENV) or ""
        channels.append(EmailChannel(smtp_host, smtp_port, smtp_user, smtp_password, email_to))

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
