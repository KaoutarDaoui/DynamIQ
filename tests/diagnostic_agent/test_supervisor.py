from __future__ import annotations

from datetime import datetime, timedelta, timezone

from agents.diagnostic_agent import constants
from agents.diagnostic_agent.supervisor import cooldown_active, decide, get_comfort_bounds_delta_c

NOW = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)


def _output(action: dict, cause: str = "schedule_mismatch") -> dict:
    return {
        "cause": cause,
        "cause_confidence": "high",
        "proposed_action": action,
    }


class TestAcceptanceScenarios:
    def test_1_empty_room_hvac_on_is_autonomous(self) -> None:
        output = _output({"type": "setpoint_change", "target_setpoint_c": 16.0, "delta_c": 6.0})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "autonomous"

    def test_2_equipment_fault_inspection_required_is_human_alert(self) -> None:
        output = _output({"type": "inspection_required"}, cause="equipment_fault")
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "human_alert"

    def test_3_undetermined_cause_forces_inspection_required_and_human_alert(self) -> None:
        # contract.validate_output is what forces the action type; here we just
        # confirm the supervisor routes an already-corrected undetermined case
        # to a human, same as test 2.
        output = _output({"type": "inspection_required"}, cause="undetermined")
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "human_alert"

    def test_4_second_occurrence_within_cooldown_is_log_only(self) -> None:
        output = _output({"type": "setpoint_change", "target_setpoint_c": 16.0, "delta_c": 6.0})
        recent = [{"created_at": NOW - timedelta(days=2), "id": 1}]
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=recent, now=NOW)
        assert result.decision == "log_only"

    def test_5_delta_exceeding_comfort_bounds_overrides_agents_own_opinion(self) -> None:
        # The model proposes this as a normal setpoint_change (implicitly "safe" in
        # its own framing) -- the Supervisor must override based on delta_c alone,
        # regardless of what the model itself believed about the action.
        output = _output({"type": "setpoint_change", "target_setpoint_c": 10.0, "delta_c": 12.0})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "human_alert"
        assert "delta_c" in result.reason


class TestDecisionPrecedence:
    def test_shutdown_always_human_alert_even_within_bounds(self) -> None:
        output = _output({"type": "shutdown"})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "human_alert"

    def test_lockout_always_human_alert(self) -> None:
        output = _output({"type": "lockout"})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "human_alert"

    def test_delta_within_bounds_and_no_cooldown_is_autonomous(self) -> None:
        output = _output({"type": "setpoint_change", "delta_c": 3.0})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "autonomous"

    def test_action_with_no_delta_c_does_not_trigger_bounds_check(self) -> None:
        output = _output({"type": "no_action"})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "autonomous"

    def test_negative_delta_c_uses_absolute_value(self) -> None:
        output = _output({"type": "setpoint_change", "delta_c": -12.0})
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=[], now=NOW)
        assert result.decision == "human_alert"

    def test_cooldown_outside_window_does_not_suppress(self) -> None:
        output = _output({"type": "setpoint_change", "delta_c": 3.0})
        recent = [{"created_at": NOW - timedelta(days=constants.COOLDOWN_DAYS + 1), "id": 1}]
        result = decide(output, comfort_bounds_delta_c=8.0, recent_diagnoses_same_cause=recent, now=NOW)
        assert result.decision == "autonomous"


class TestCooldownActive:
    def test_recent_diagnosis_within_window_is_active(self) -> None:
        recent = [{"created_at": NOW - timedelta(days=1)}]
        assert cooldown_active(recent, NOW) is True

    def test_old_diagnosis_outside_window_is_not_active(self) -> None:
        recent = [{"created_at": NOW - timedelta(days=constants.COOLDOWN_DAYS + 1)}]
        assert cooldown_active(recent, NOW) is False

    def test_empty_history_is_not_active(self) -> None:
        assert cooldown_active([], NOW) is False


class TestComfortBoundsDeltaLookup:
    def test_missing_context_uses_default(self) -> None:
        assert get_comfort_bounds_delta_c(None) == constants.DEFAULT_COMFORT_BOUNDS_DELTA_C

    def test_no_diagnostic_config_uses_default(self) -> None:
        assert get_comfort_bounds_delta_c({"config_json": {}}) == constants.DEFAULT_COMFORT_BOUNDS_DELTA_C

    def test_per_zone_override_is_used(self) -> None:
        context = {"config_json": {"diagnostic": {"comfort_bounds_delta_c": 4.5}}}
        assert get_comfort_bounds_delta_c(context) == 4.5
