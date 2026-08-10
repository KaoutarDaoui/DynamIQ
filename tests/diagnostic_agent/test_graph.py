from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from agents.diagnostic_agent import constants, db, graph


NOW = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)


def _verdict(**overrides):
    base = {
        "cause": "AC failed to restart after power outage",
        "cause_confidence": "high",
        "evidence": ["Temp rose sharply at 13:00", "Room empty 12h-14h"],
        "energy_wasted_kwh": 12.5,
        "energy_wasted_basis": "delta_T x volume x Cp / 3600",
        "proposed_action": {"type": "setpoint_change", "delta_c": -2.0},
        "recurrence": {"seen_before": True, "last_occurrence": "2026-07-20", "long_term": True},
        "message": "The AC did not restart after the power outage.",
    }
    base.update(overrides)
    return base


def _anomaly_row():
    return db.AnomalyRow(
        id=456,
        room_id="room-101",
        anomaly_type="thermal_anomaly",
        opened_at=datetime(2026, 8, 2, 11, 15, tzinfo=timezone.utc),
        closed_at=None,
        residual_c=5.0,
        residual_trace=[{"residual_c": 5.0}],
        threshold_c=1.5,
        model_version=3,
        diagnosed=False,
    )


class FakeLLM:
    def __init__(self, reason_responses, repair_response=None):
        self.reason_responses = list(reason_responses)
        self.repair_response = repair_response or _verdict()
        self.calls: list[list[dict]] = []

    def __call__(self, messages, api_key):
        self.calls.append(messages)
        if "strict JSON repair assistant" in messages[0]["content"]:
            return json.dumps(self.repair_response)
        return self.reason_responses.pop(0)


@pytest.fixture
def env(monkeypatch):
    fake_tools = {
        "get_sensor_history": lambda engine, room_id, hours=4: {"ok": True, "data": {"series": [{"ts": "2026-08-02T13:00:00Z", "temp_measured_c": 29.0}], "samples_total": 1, "samples_returned": 1}},
        "get_calendar": lambda engine, room_id, days=7: {"ok": True, "data": {"days": days, "occupancy_blocks_observed": [{"start": "2026-08-02T12:00:00Z", "end": "2026-08-02T14:00:00Z"}]}},
        "get_hvac_logs": lambda engine, room_id, hours=24: {"ok": True, "data": {"changes_total": 1, "state_changes": [{"ts": "2026-08-02T12:55:00Z", "state": "off"}]}},
        "get_similar_anomalies": lambda engine, room_id, days=30: {"ok": True, "data": {"days": days, "prior_anomalies": [{"anomaly_id": 100, "opened_at": "2026-07-20T09:00:00Z", "residual_c": 5.0, "cause": "reset_hvac_breaker"}]}},
    }
    monkeypatch.setattr(graph.tools, "TOOL_REGISTRY", fake_tools)
    monkeypatch.setattr(graph.db, "fetch_anomaly", lambda engine, anomaly_id: _anomaly_row())
    monkeypatch.setattr(
        graph,
        "build_input_contract",
        lambda anomaly, engine, now: {"anomaly_id": anomaly.id, "room_id": anomaly.room_id, "type": "overheating", "residual_c": 5.0, "threshold_c": 1.5, "duration_min": 45, "hvac_running": False},
    )
    return graph


class TestRouteFromLLM:
    def test_budget_exhausted_routes_to_fallback(self):
        state = {"budget_remaining": 0, "llm_raw_output": json.dumps({"tool": "get_calendar"})}
        assert graph.route_from_llm(state) == "fallback_node"

    def test_tool_call_routes_to_tool_executor(self):
        state = {"budget_remaining": 5, "llm_raw_output": json.dumps({"tool": "get_sensor_history", "params": {"hours": 4}})}
        assert graph.route_from_llm(state) == "tool_executor"

    def test_verdict_routes_to_validate_output(self):
        state = {"budget_remaining": 5, "llm_raw_output": json.dumps(_verdict())}
        assert graph.route_from_llm(state) == "validate_output"

    def test_garbage_routes_to_fallback(self):
        state = {"budget_remaining": 5, "llm_raw_output": "I am not sure what happened here"}
        assert graph.route_from_llm(state) == "fallback_node"

    def test_unparseable_json_routes_to_fallback(self):
        state = {"budget_remaining": 5, "llm_raw_output": "not json at all"}
        assert graph.route_from_llm(state) == "fallback_node"


class TestRouteFromValidation:
    def test_valid_output_ends(self):
        assert graph.route_from_validation({"validated_output": {"cause": "x"}}) == "END"

    def test_invalid_with_repair_slot_repairs(self):
        assert graph.route_from_validation({"validated_output": None, "repair_attempts": 0}) == "json_repair"
        assert graph.route_from_validation({"validated_output": None, "repair_attempts": 1}) == "json_repair"

    def test_invalid_without_repair_slot_falls_back(self):
        assert graph.route_from_validation({"validated_output": None, "repair_attempts": constants.JSON_REPAIR_RETRIES}) == "fallback_node"


class TestRouteFromRepair:
    def test_repair_under_limit_returns_to_llm(self):
        assert graph.route_from_repair({"repair_attempts": 0}) == "llm_reason"

    def test_repair_at_limit_falls_back(self):
        assert graph.route_from_repair({"repair_attempts": constants.JSON_REPAIR_RETRIES}) == "fallback_node"


class TestExtractJson:
    def test_clean_json(self):
        assert graph._extract_json('{"tool": "get_calendar"}') == {"tool": "get_calendar"}

    def test_think_block_stripped(self):
        text = "<think>Let me reason here.</think>{\"tool\": \"get_sensor_history\"}"
        assert graph._extract_json(text) == {"tool": "get_sensor_history"}

    def test_backtick_fenced_json_with_trailing_prose(self):
        text = "reasoning...\n`{\"tool\": \"get_calendar\", \"params\": {\"room_id\": \"r\", \"days\": 7}}`\nDone."
        assert graph._extract_json(text) == {"tool": "get_calendar", "params": {"room_id": "r", "days": 7}}

    def test_prefers_tool_shaped_json_over_params_echo(self):
        text = 'the params are {"room_id": "r", "days": 7} but the call is {"tool": "get_calendar", "params": {"room_id": "r", "days": 7}}'
        assert graph._extract_json(text) == {"tool": "get_calendar", "params": {"room_id": "r", "days": 7}}

    def test_markdown_json_fence(self):
        text = "Here is the answer:\n```json\n{\"cause\": \"sensor_failure\", \"cause_confidence\": \"high\"}\n```"
        parsed = graph._extract_json(text)
        assert parsed["cause"] == "sensor_failure"

    def test_truncated_json_returns_none(self):
        assert graph._extract_json('{"tool": "get_hvac_logs", "params') is None

    def test_undetermined_verdict_extracted(self):
        text = "<think>Not sure.</think>{\"cause\": \"undetermined\", \"cause_confidence\": \"undetermined\", \"proposed_action\": {\"type\": \"inspection_required\"}, \"message\": \"x\"}"
        parsed = graph._extract_json(text)
        assert parsed["cause_confidence"] == "undetermined"


class TestCheckpointResume:
    @staticmethod
    def _saver(tmp_path):
        import sqlite3

        from langgraph.checkpoint.sqlite import SqliteSaver

        conn = sqlite3.connect(str(tmp_path / "ckpt.sqlite"), check_same_thread=False)
        saver = SqliteSaver(conn)
        saver.setup()
        return saver

    class _CrashLLM:
        def __init__(self):
            self.calls = 0

        def __call__(self, messages, api_key):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("SIMULATED PROCESS CRASH")
            return json.dumps({"tool": "get_sensor_history"})

    class _WorkingLLM:
        def __init__(self):
            self.calls = 0

        def __call__(self, messages, api_key):
            self.calls += 1
            return json.dumps(_verdict())

    def test_run_investigation_resumes_after_crash(self, env, tmp_path):
        saver = self._saver(tmp_path)
        with pytest.raises(RuntimeError):
            graph.run_investigation(object(), 999, "test-key", now=NOW, checkpointer=saver, llm_caller=self._CrashLLM())

        working = self._WorkingLLM()
        result = graph.run_investigation(object(), 999, "test-key", now=NOW, checkpointer=saver, llm_caller=working)
        assert result["validated_output"]["cause"] == _verdict()["cause"]
        assert result["node_trace"] == [
            "build_contract",
            "llm_reason",
            "tool_executor",
            "llm_reason",
            "validate_output",
        ]
        assert working.calls == 1

    def test_completed_run_starts_fresh_on_second_call(self, env, tmp_path):
        saver = self._saver(tmp_path)
        first = self._WorkingLLM()
        graph.run_investigation(object(), 999, "test-key", now=NOW, checkpointer=saver, llm_caller=first)

        second = self._WorkingLLM()
        result = graph.run_investigation(object(), 999, "test-key", now=NOW, checkpointer=saver, llm_caller=second)
        assert result["node_trace"][0] == "build_contract"
        assert second.calls == 1


class TestGraphHappyPath:
    def test_full_investigation_reaches_verdict(self, env):
        fake = FakeLLM(
            [
                json.dumps({"tool": "get_sensor_history", "params": {"room_id": "room-101", "hours": 4}}),
                json.dumps({"tool": "get_calendar", "params": {"room_id": "room-101"}}),
                json.dumps({"tool": "get_hvac_logs", "params": {"room_id": "room-101", "hours": 2}}),
                json.dumps({"tool": "get_similar_anomalies", "params": {"room_id": "room-101", "days": 30}}),
                json.dumps(_verdict()),
            ]
        )
        result = graph.run_investigation(object(), 456, "test-key", now=NOW, llm_caller=fake)
        assert result["validated_output"]["cause"] == _verdict()["cause"]
        assert result["validated_output"]["cause_confidence"] == "high"
        assert result["fallback_used"] is False
        assert len(result["tool_calls_made"]) == 4
        assert result["budget_remaining"] == constants.TOOL_CALL_BUDGET - 4
        assert result["node_trace"][0] == "build_contract"
        assert result["node_trace"][-1] == "validate_output"
        assert len(fake.calls) == 5

    def test_node_trace_records_tool_loop(self, env):
        fake = FakeLLM(
            [
                json.dumps({"tool": "get_sensor_history"}),
                json.dumps({"tool": "get_calendar"}),
                json.dumps(_verdict()),
            ]
        )
        result = graph.run_investigation(object(), 456, "test-key", now=NOW, llm_caller=fake)
        assert result["node_trace"] == [
            "build_contract",
            "llm_reason",
            "tool_executor",
            "llm_reason",
            "tool_executor",
            "llm_reason",
            "validate_output",
        ]

    def test_evidence_gathered_mirrors_tool_calls(self, env):
        fake = FakeLLM(
            [
                json.dumps({"tool": "get_sensor_history"}),
                json.dumps({"tool": "get_calendar"}),
                json.dumps(_verdict()),
            ]
        )
        result = graph.run_investigation(object(), 456, "test-key", now=NOW, llm_caller=fake)
        assert len(result["evidence_gathered"]) == 2
        assert result["evidence_gathered"][0].startswith("get_sensor_history:")


class TestGraphBudgetExhaustion:
    def test_tool_spam_until_budget_hits_zero_falls_back(self, env):
        fake = FakeLLM([json.dumps({"tool": "get_sensor_history"}) for _ in range(constants.TOOL_CALL_BUDGET + 1)])
        result = graph.run_investigation(object(), 456, "test-key", now=NOW, llm_caller=fake)
        assert result["fallback_used"] is True
        assert result["validated_output"]["cause_confidence"] == "undetermined"
        assert result["validated_output"]["proposed_action"]["type"] == "inspection_required"
        assert len(result["tool_calls_made"]) == constants.TOOL_CALL_BUDGET
        assert result["budget_remaining"] == 0
        assert result["node_trace"][-1] == "fallback_node"


class TestGraphRepair:
    def test_invalid_verdict_is_repaired_once(self, env):
        broken = _verdict()
        del broken["message"]
        fake = FakeLLM([json.dumps(broken), json.dumps(_verdict())])
        result = graph.run_investigation(object(), 456, "test-key", now=NOW, llm_caller=fake)
        assert result["fallback_used"] is False
        assert result["validated_output"]["cause"] == _verdict()["cause"]
        assert "json_repair" in result["node_trace"]
        assert result["repair_attempts"] == 1

    def test_irreparable_verdict_falls_back_after_two_repairs(self, env):
        broken = _verdict()
        del broken["message"]
        fake = FakeLLM([json.dumps(broken), json.dumps(broken)], repair_response={"not": "a valid verdict"})
        result = graph.run_investigation(object(), 456, "test-key", now=NOW, llm_caller=fake)
        assert result["fallback_used"] is True
        assert result["repair_attempts"] == constants.JSON_REPAIR_RETRIES
        assert result["validated_output"]["cause_confidence"] == "undetermined"
