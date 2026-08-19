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
            # Port 465 is implicit TLS from the first byte (SMTP_SSL); every
            # other port (587, 25, ...) is plaintext-then-upgrade (STARTTLS)
            # -- the convention nearly every SMTP provider follows, Gmail
            # included. Branching on the port lets the same channel work
            # with Gmail (465) and providers like Brevo/SendGrid (587)
            # without a separate config knob.
            if self.smtp_port == 465:
                with smtplib.SMTP_SSL(self.smtp_host, self.smtp_port, timeout=self.timeout_s) as smtp:
                    smtp.login(self.username, self.password)
                    smtp.send_message(message)
            else:
                with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=self.timeout_s) as smtp:
                    smtp.starttls()
                    smtp.login(self.username, self.password)
                    smtp.send_message(message)
            return True
        except (smtplib.SMTPException, OSError):
            return False


class EmailJsChannel:
    # Same "email" name as EmailChannel -- they're alternative ways to reach
    # the same alert_email recipient, not meant to both be configured at
    # once. EmailJS is a REST call (https://api.emailjs.com/api/v1.0/email/send)
    # rather than raw SMTP, so it needs its own account setup (a "service",
    # a "template", and a public/private key pair from emailjs.com) instead
    # of SMTP host/user/password.
    name = "email"

    def __init__(
        self,
        service_id: str,
        template_id: str,
        public_key: str,
        private_key: str,
        to_addr: str,
        timeout_s: float = constants.ALERT_EMAILJS_TIMEOUT_S,
    ) -> None:
        self.service_id = service_id
        self.template_id = template_id
        self.public_key = public_key
        self.private_key = private_key
        self.to_addr = to_addr
        self.timeout_s = timeout_s

    def send(self, payload: dict[str, Any]) -> bool:
        to_addr = payload.get("alert_email") or self.to_addr
        if not to_addr:
            return False
        room_id = payload.get("room_id", "unknown room")
        body = {
            "service_id": self.service_id,
            "template_id": self.template_id,
            "user_id": self.public_key,
            "accessToken": self.private_key,
            "template_params": {
                "to_email": to_addr,
                "subject": f"DynamIQ alert — {room_id}",
                "message": _format_email_body(payload),
            },
        }
        try:
            response = httpx.post(constants.ALERT_EMAILJS_URL, json=body, timeout=self.timeout_s)
            return response.status_code < 400
        except httpx.HTTPError:
            return False


def get_configured_channels() -> list[AlertChannel]:
    channels: list[AlertChannel] = [LogChannel()]
    webhook_url = os.getenv(constants.ALERT_WEBHOOK_URL_ENV)
    if webhook_url:
        channels.append(WebhookChannel(webhook_url))

    # *_to env vars below are only a fallback default for buildings whose
    # organisation has no email on file — the real per-building recipient
    # normally comes from orchestration.db.fetch_org_alert_email /
    # fetch_org_user_emails at dispatch time, so it's not required to
    # activate the channel.
    #
    # EmailJS and raw SMTP are alternative ways to reach the same "email"
    # channel -- EmailJS takes priority if both happen to be configured,
    # since it's what's actually documented in .env.example as the default
    # path (no SMTP/app-password setup needed).
    service_id = os.getenv(constants.ALERT_EMAILJS_SERVICE_ID_ENV)
    template_id = os.getenv(constants.ALERT_EMAILJS_TEMPLATE_ID_ENV)
    public_key = os.getenv(constants.ALERT_EMAILJS_PUBLIC_KEY_ENV)
    private_key = os.getenv(constants.ALERT_EMAILJS_PRIVATE_KEY_ENV)
    if service_id and template_id and public_key and private_key:
        emailjs_to = os.getenv(constants.ALERT_EMAILJS_TO_ENV) or ""
        channels.append(EmailJsChannel(service_id, template_id, public_key, private_key, emailjs_to))
    else:
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
