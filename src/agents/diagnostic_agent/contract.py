from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from . import constants


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    output: dict[str, Any] | None
    errors: list[str] = field(default_factory=list)


class ProposedAction(BaseModel):
    """One corrective action. An out-of-enum or missing ``type`` is coerced to
    ``inspection_required`` instead of failing -- the spec's failure-mode table
    rejects the ACTION, not the whole diagnosis. Extra keys (``delta_c``,
    ``target_setpoint_c``, ...) are preserved."""

    model_config = ConfigDict(extra="allow")

    type: str | None = None

    @model_validator(mode="after")
    def _coerce_type(self) -> ProposedAction:
        if self.type not in constants.VALID_ACTION_TYPES:
            self.type = "inspection_required"
        return self


_DEFAULT_RECURRENCE = {"seen_before": False, "last_occurrence": None, "long_term_recommendation": None}


class DiagnosisContract(BaseModel):
    """Pydantic contract for the LLM's final verdict (replaces the manual
    per-field validation). Unknown top-level keys are ignored.

    The LLM only really decides ``cause``, ``evidence`` and ``message``.
    ``cause_confidence``, ``energy_wasted_kwh`` and ``proposed_action`` are
    recomputed deterministically from real data in ``evidence.finalize_*`` and
    overwrite whatever the LLM guessed here."""

    cause: str
    cause_confidence: str = "undetermined"
    evidence: list[str] = Field(default_factory=list)
    energy_wasted_kwh: float = 0.0
    energy_wasted_basis: str = "unavailable"
    proposed_action: ProposedAction = Field(default_factory=lambda: ProposedAction(type="inspection_required"))
    recurrence: dict[str, Any] = Field(default_factory=lambda: dict(_DEFAULT_RECURRENCE))
    message: str

    @field_validator("cause", mode="before")
    @classmethod
    def _non_empty_str(cls, value: Any) -> Any:
        if not isinstance(value, str) or len(value) == 0:
            raise ValueError("must be a non-empty string")
        return value

    @field_validator("cause", mode="after")
    @classmethod
    def _valid_cause(cls, value: Any) -> Any:
        if value not in constants.VALID_CAUSES:
            raise ValueError(f"must be one of {constants.VALID_CAUSES}, got {value!r}")
        return value

    @field_validator("cause_confidence", mode="before")
    @classmethod
    def _valid_confidence(cls, value: Any) -> Any:
        if not isinstance(value, str) or value not in constants.VALID_CAUSE_CONFIDENCE:
            raise ValueError(f"must be one of {constants.VALID_CAUSE_CONFIDENCE}, got {value!r}")
        return value

    @field_validator("evidence", mode="before")
    @classmethod
    def _list_of_strings(cls, value: Any) -> Any:
        if not isinstance(value, list) or not all(isinstance(e, str) for e in value):
            raise ValueError("must be a list of strings")
        return value

    @field_validator("energy_wasted_kwh", mode="before")
    @classmethod
    def _numeric(cls, value: Any) -> Any:
        if not isinstance(value, (int, float)):
            raise ValueError("must be numeric")
        return value

    @field_validator("recurrence", mode="before")
    @classmethod
    def _recurrence_default(cls, value: Any) -> Any:
        if value is None or not isinstance(value, dict):
            return dict(_DEFAULT_RECURRENCE)
        return value

    @model_validator(mode="after")
    def _undetermined_forces_inspection(self) -> DiagnosisContract:
        if self.cause_confidence == "undetermined" and self.proposed_action.type != "inspection_required":
            self.proposed_action.type = "inspection_required"
        return self

    def as_output(self, anomaly_id: int, room_id: str) -> dict[str, Any]:
        return {
            "anomaly_id": anomaly_id,
            "room_id": room_id,
            "cause": self.cause,
            "cause_confidence": self.cause_confidence,
            "evidence": self.evidence,
            "energy_wasted_kwh": float(self.energy_wasted_kwh),
            "energy_wasted_basis": self.energy_wasted_basis,
            "proposed_action": self.proposed_action.model_dump(),
            "recurrence": self.recurrence,
            "message": self.message,
        }


def validate_output(raw: Any, anomaly_id: int, room_id: str) -> ValidationResult:
    if not isinstance(raw, dict):
        return ValidationResult(False, None, ["top-level output is not a JSON object"])
    try:
        model = DiagnosisContract.model_validate(raw)
    except ValidationError as exc:
        errors: list[str] = []
        for error in exc.errors():
            loc = ".".join(str(part) for part in error.get("loc", ()))
            errors.append(f"{loc}: {error['msg']}" if loc else error["msg"])
        return ValidationResult(False, None, errors)
    return ValidationResult(True, model.as_output(anomaly_id, room_id), [])


def templated_fallback(anomaly_id: int, room_id: str, raw_anomaly: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "anomaly_id": anomaly_id,
        "room_id": room_id,
        "cause": "unknown",
        "cause_confidence": "undetermined",
        "evidence": [f"Automated diagnosis failed: {reason}", f"Raw anomaly: {raw_anomaly}"],
        "energy_wasted_kwh": 0.0,
        "energy_wasted_basis": "unavailable",
        "proposed_action": {"type": "inspection_required"},
        "recurrence": {"seen_before": False, "last_occurrence": None, "long_term_recommendation": None},
        "message": f"ALERT - Room {room_id} - Automated diagnosis could not complete ({reason}). Manual inspection required.",
    }
