from __future__ import annotations

import json

import httpx
import pytest

from agents.supervisor.channels import LogChannel, WebhookChannel, dispatch


class TestLogChannel:
    def test_writes_a_json_line(self, tmp_path) -> None:
        path = tmp_path / "alerts.jsonl"
        channel = LogChannel(path=str(path))
        assert channel.send({"room_id": "room-1", "cause": "schedule_mismatch"}) is True
        lines = path.read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 1
        record = json.loads(lines[0])
        assert record["room_id"] == "room-1"
        assert "sent_at" in record

    def test_appends_multiple_alerts(self, tmp_path) -> None:
        path = tmp_path / "alerts.jsonl"
        channel = LogChannel(path=str(path))
        channel.send({"n": 1})
        channel.send({"n": 2})
        lines = path.read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 2

    def test_creates_parent_directory(self, tmp_path) -> None:
        path = tmp_path / "nested" / "dir" / "alerts.jsonl"
        channel = LogChannel(path=str(path))
        assert channel.send({"n": 1}) is True
        assert path.exists()


class TestWebhookChannel:
    def test_success_returns_true(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_post(url, json, timeout):
            class Resp:
                status_code = 200
            return Resp()

        monkeypatch.setattr(httpx, "post", fake_post)
        channel = WebhookChannel("https://example.com/webhook")
        assert channel.send({"room_id": "room-1"}) is True

    def test_http_error_status_returns_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_post(url, json, timeout):
            class Resp:
                status_code = 500
            return Resp()

        monkeypatch.setattr(httpx, "post", fake_post)
        channel = WebhookChannel("https://example.com/webhook")
        assert channel.send({"room_id": "room-1"}) is False

    def test_network_failure_returns_false_not_raise(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_post(url, json, timeout):
            raise httpx.ConnectError("no route to host")

        monkeypatch.setattr(httpx, "post", fake_post)
        channel = WebhookChannel("https://example.com/webhook")
        assert channel.send({"room_id": "room-1"}) is False


class TestDispatch:
    def test_dispatches_to_all_configured_channels(self, tmp_path) -> None:
        log_channel = LogChannel(path=str(tmp_path / "alerts.jsonl"))
        results = dispatch({"room_id": "room-1"}, channels=[log_channel])
        assert results == {"log": True}

    def test_a_failing_channel_does_not_block_others(self, tmp_path) -> None:
        class BrokenChannel:
            name = "broken"

            def send(self, payload):
                raise RuntimeError("simulated failure")

        log_channel = LogChannel(path=str(tmp_path / "alerts.jsonl"))
        results = dispatch({"room_id": "room-1"}, channels=[BrokenChannel(), log_channel])
        assert results == {"broken": False, "log": True}
