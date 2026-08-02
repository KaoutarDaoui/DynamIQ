from __future__ import annotations

from agents.diagnostic_agent.contract import templated_fallback, validate_output


def _valid_raw(**overrides):
    base = {
        "cause": "schedule_mismatch",
        "cause_confidence": "high",
        "evidence": ["Occupancy zero since Monday", "HVAC continuously conditioning"],
        "energy_wasted_kwh": 57.0,
        "energy_wasted_basis": "mpc_counterfactual",
        "proposed_action": {"type": "setpoint_change", "target_setpoint_c": 16.0, "delta_c": 6.0},
        "recurrence": {"seen_before": False, "last_occurrence": None, "long_term_recommendation": None},
        "message": "ALERT - Zone 204 - Overheating since Monday",
    }
    base.update(overrides)
    return base


class TestValidateOutput:
    def test_valid_output_passes(self) -> None:
        result = validate_output(_valid_raw(), anomaly_id=1, room_id="room-204")
        assert result.valid is True
        assert result.output["anomaly_id"] == 1
        assert result.output["room_id"] == "room-204"
        assert result.errors == []

    def test_not_a_dict_fails(self) -> None:
        result = validate_output(["not", "a", "dict"], anomaly_id=1, room_id="room-204")
        assert result.valid is False
        assert result.output is None

    def test_invalid_cause_confidence_fails(self) -> None:
        result = validate_output(_valid_raw(cause_confidence="very_high"), anomaly_id=1, room_id="room-204")
        assert result.valid is False
        assert any("cause_confidence" in e for e in result.errors)

    def test_action_type_outside_enum_is_coerced_to_inspection_required(self) -> None:
        raw = _valid_raw(proposed_action={"type": "turn_off_the_building"})
        result = validate_output(raw, anomaly_id=1, room_id="room-204")
        assert result.valid is True
        assert result.output["proposed_action"]["type"] == "inspection_required"

    def test_undetermined_confidence_forces_inspection_required(self) -> None:
        raw = _valid_raw(
            cause_confidence="undetermined",
            proposed_action={"type": "setpoint_change", "target_setpoint_c": 16.0, "delta_c": 6.0},
        )
        result = validate_output(raw, anomaly_id=1, room_id="room-204")
        assert result.valid is True
        assert result.output["proposed_action"]["type"] == "inspection_required"

    def test_missing_evidence_fails(self) -> None:
        raw = _valid_raw()
        del raw["evidence"]
        result = validate_output(raw, anomaly_id=1, room_id="room-204")
        assert result.valid is False

    def test_missing_message_fails(self) -> None:
        raw = _valid_raw()
        del raw["message"]
        result = validate_output(raw, anomaly_id=1, room_id="room-204")
        assert result.valid is False

    def test_non_numeric_energy_wasted_fails(self) -> None:
        raw = _valid_raw(energy_wasted_kwh="a lot")
        result = validate_output(raw, anomaly_id=1, room_id="room-204")
        assert result.valid is False

    def test_missing_recurrence_defaults_gracefully(self) -> None:
        raw = _valid_raw()
        del raw["recurrence"]
        result = validate_output(raw, anomaly_id=1, room_id="room-204")
        assert result.valid is True
        assert result.output["recurrence"]["seen_before"] is False


class TestTemplatedFallback:
    def test_fallback_is_always_inspection_required_and_undetermined(self) -> None:
        fallback = templated_fallback(1, "room-204", {"anomaly_type": "overheating"}, reason="tool budget exhausted")
        assert fallback["cause_confidence"] == "undetermined"
        assert fallback["proposed_action"]["type"] == "inspection_required"

    def test_fallback_passes_its_own_validation(self) -> None:
        fallback = templated_fallback(1, "room-204", {"anomaly_type": "overheating"}, reason="model unreachable")
        result = validate_output(fallback, anomaly_id=1, room_id="room-204")
        assert result.valid is True
