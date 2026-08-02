from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import constants


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    output: dict[str, Any] | None
    errors: list[str] = field(default_factory=list)


def _require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validate_output(raw: Any, anomaly_id: int, room_id: str) -> ValidationResult:
    errors: list[str] = []

    if not isinstance(raw, dict):
        return ValidationResult(False, None, ["top-level output is not a JSON object"])

    cause = raw.get("cause")
    _require(isinstance(cause, str) and len(cause) > 0, "cause must be a non-empty string", errors)

    cause_confidence = raw.get("cause_confidence")
    _require(
        cause_confidence in constants.VALID_CAUSE_CONFIDENCE,
        f"cause_confidence must be one of {constants.VALID_CAUSE_CONFIDENCE}, got {cause_confidence!r}",
        errors,
    )

    evidence = raw.get("evidence")
    _require(isinstance(evidence, list) and all(isinstance(e, str) for e in evidence), "evidence must be a list of strings", errors)

    energy_wasted_kwh = raw.get("energy_wasted_kwh")
    _require(isinstance(energy_wasted_kwh, (int, float)), "energy_wasted_kwh must be numeric", errors)

    proposed_action = raw.get("proposed_action")
    _require(isinstance(proposed_action, dict), "proposed_action must be an object", errors)

    action_type = proposed_action.get("type") if isinstance(proposed_action, dict) else None
    action_type_valid = action_type in constants.VALID_ACTION_TYPES
    # An out-of-enum action type is NOT a validation failure -- the spec's own
    # failure-mode table says to reject the ACTION and coerce to
    # inspection_required, not throw away an otherwise-sound diagnosis.

    message = raw.get("message")
    _require(isinstance(message, str) and len(message) > 0, "message must be a non-empty string", errors)

    if errors:
        return ValidationResult(False, None, errors)

    corrected_action = dict(proposed_action)
    if cause_confidence == "undetermined" and corrected_action.get("type") != "inspection_required":
        corrected_action["type"] = "inspection_required"
    if not action_type_valid:
        corrected_action["type"] = "inspection_required"

    recurrence = raw.get("recurrence")
    if not isinstance(recurrence, dict):
        recurrence = {"seen_before": False, "last_occurrence": None, "long_term_recommendation": None}

    output = {
        "anomaly_id": anomaly_id,
        "room_id": room_id,
        "cause": cause,
        "cause_confidence": cause_confidence,
        "evidence": evidence,
        "energy_wasted_kwh": float(energy_wasted_kwh),
        "energy_wasted_basis": raw.get("energy_wasted_basis", "mpc_counterfactual"),
        "proposed_action": corrected_action,
        "recurrence": recurrence,
        "message": message,
    }
    return ValidationResult(True, output, [])


def templated_fallback(anomaly_id: int, room_id: str, raw_anomaly: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "anomaly_id": anomaly_id,
        "room_id": room_id,
        "cause": "undetermined",
        "cause_confidence": "undetermined",
        "evidence": [f"Automated diagnosis failed: {reason}", f"Raw anomaly: {raw_anomaly}"],
        "energy_wasted_kwh": 0.0,
        "energy_wasted_basis": "unavailable",
        "proposed_action": {"type": "inspection_required"},
        "recurrence": {"seen_before": False, "last_occurrence": None, "long_term_recommendation": None},
        "message": f"ALERT - Room {room_id} - Automated diagnosis could not complete ({reason}). Manual inspection required.",
    }
