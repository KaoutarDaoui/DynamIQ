from __future__ import annotations

from typing import Any, Callable

from sqlalchemy import Engine

from . import constants, db


MAX_SERIES_POINTS = 48


def _wrap(fn: Callable[[], Any]) -> dict[str, Any]:
    try:
        return {"ok": True, "data": fn()}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _downsample(items: list, max_points: int = MAX_SERIES_POINTS) -> list:
    if len(items) <= max_points:
        return items
    step = len(items) / max_points
    return [items[int(i * step)] for i in range(max_points)]


def get_sensor_history(engine: Engine, room_id: str, hours: int = constants.SENSOR_HISTORY_DEFAULT_HOURS) -> dict[str, Any]:
    def run() -> Any:
        rows = db.fetch_sensor_history(engine, room_id, hours)
        series = [
            {
                "ts": r["ts"].isoformat(),
                "temp_measured_c": r["temp_measured_c"],
                "temp_ext_c": r["temp_ext_c"],
                "occupied": r["q_occ_w"] > 0,
                "hvac_power_w": r["q_hvac_w"],
            }
            for r in rows
        ]
        downsampled = _downsample(series)
        return {
            "room_id": room_id,
            "hours": hours,
            "samples_total": len(rows),
            "samples_returned": len(downsampled),
            "series": downsampled,
            "note": "No humidity data exists anywhere in this system yet -- omitted, not fabricated. Series downsampled if the raw window had more than "
            f"{MAX_SERIES_POINTS} points.",
        }

    return _wrap(run)


def get_calendar(engine: Engine, room_id: str, days: int = constants.CALENDAR_DEFAULT_DAYS) -> dict[str, Any]:
    def run() -> Any:
        rows = db.fetch_occupancy_pattern(engine, room_id, days)
        blocks: list[dict[str, Any]] = []
        current_start = None
        prev_occupied = False
        prev_ts = None
        for r in rows:
            occupied = r["q_occ_w"] > 0
            if occupied and not prev_occupied:
                current_start = r["ts"]
            if not occupied and prev_occupied and current_start is not None:
                blocks.append({"start": current_start.isoformat(), "end": prev_ts.isoformat()})
                current_start = None
            prev_occupied = occupied
            prev_ts = r["ts"]
        if current_start is not None and prev_ts is not None:
            blocks.append({"start": current_start.isoformat(), "end": prev_ts.isoformat()})
        blocks_total = len(blocks)
        # A noisy/flapping occupancy signal can produce thousands of tiny
        # blocks over `days` -- unbounded, this was large enough to blow past
        # Groq's request size limit (413).
        downsampled = _downsample(blocks)
        return {
            "room_id": room_id,
            "days": days,
            "blocks_total": blocks_total,
            "blocks_returned": len(downsampled),
            "occupancy_blocks_observed": downsampled,
            "note": "Retrospective, inferred from sensor_readings.q_occ_w history -- there is no real scheduling/calendar system in this stack yet, so this cannot show FUTURE scheduled blocks, only what was observed.",
        }

    return _wrap(run)


def get_mpc_trajectory(engine: Engine, room_id: str) -> dict[str, Any]:
    def run() -> Any:
        rows = db.fetch_mpc_trajectory(engine, room_id)
        trajectory = [
            {
                "slot_ts": r["slot_ts"].isoformat(),
                "setpoint_c": r["setpoint_c"],
                "predicted_temp_c": r["predicted_temp_c"],
                "predicted_kwh": r["predicted_kwh"],
                "predicted_gco2": r["predicted_gco2"],
                "model_version": r["model_version"],
            }
            for r in rows
        ]
        downsampled = _downsample(trajectory)
        return {
            "room_id": room_id,
            "slots_total": len(rows),
            "slots_returned": len(downsampled),
            "trajectory": downsampled,
        }

    return _wrap(run)


def get_hvac_logs(engine: Engine, room_id: str, hours: int = constants.HVAC_LOGS_DEFAULT_HOURS) -> dict[str, Any]:
    def run() -> Any:
        rows = db.fetch_hvac_power_history(engine, room_id, hours)
        changes: list[dict[str, Any]] = []
        prev_power = None
        for r in rows:
            power = r["q_hvac_w"]
            if prev_power is None or power != prev_power:
                changes.append({"ts": r["ts"].isoformat(), "hvac_power_w": power, "state": "cooling" if power < 0 else "off"})
            prev_power = power
        downsampled = _downsample(changes)
        window_seconds = (rows[-1]["ts"] - rows[0]["ts"]).total_seconds() if len(rows) >= 2 else 0.0
        cooling_seconds = sum(
            (b["ts"] - a["ts"]).total_seconds()
            for a, b in zip(rows, rows[1:])
            if a["q_hvac_w"] < constants.HVAC_COOLING_POWER_W
        )
        return {
            "room_id": room_id,
            "hours": hours,
            "changes_total": len(changes),
            "changes_returned": len(downsampled),
            "state_changes": downsampled,
            "window_seconds": window_seconds,
            "cooling_seconds": cooling_seconds,
            "note": "Derived from sensor_readings.q_hvac_w (the model's own control signal) -- there is no separate equipment command/state-change log table in this stack.",
        }

    return _wrap(run)


def get_similar_anomalies(engine: Engine, room_id: str, days: int = constants.SIMILAR_ANOMALIES_DEFAULT_DAYS, exclude_anomaly_id: int | None = None, hours: int | None = None) -> dict[str, Any]:
    def run() -> Any:
        lookback_days = days
        if hours is not None:
            lookback_days = max(1, int(-(-hours // 24)))
        rows = db.fetch_similar_anomalies(engine, room_id, lookback_days, exclude_anomaly_id)
        prior_anomalies = [
            {
                "anomaly_id": r["id"],
                "opened_at": r["opened_at"].isoformat(),
                "closed_at": r["closed_at"].isoformat() if r["closed_at"] else None,
                "residual_c": r["residual_c"],
                "resolved_cause": r["cause"],
                "resolved_cause_confidence": r["cause_confidence"],
            }
            for r in rows
        ]
        downsampled = _downsample(prior_anomalies)
        return {
            "room_id": room_id,
            "days": lookback_days,
            "anomalies_total": len(prior_anomalies),
            "anomalies_returned": len(downsampled),
            "prior_anomalies": downsampled,
        }

    return _wrap(run)


def get_building_context(engine: Engine, room_id: str) -> dict[str, Any]:
    def run() -> Any:
        context = db.fetch_building_context(engine, room_id)
        if context is None:
            raise LookupError(f"Room not found: {room_id}")
        return context

    return _wrap(run)


def check_neighboring_zones(engine: Engine, room_id: str) -> dict[str, Any]:
    def run() -> Any:
        neighbors = db.fetch_neighboring_zones(engine, room_id)
        return {
            "room_id": room_id,
            "neighbors": neighbors,
            "note": "room_adjacencies is sparsely populated in the real data (0 rows as of this build) -- an empty list here usually means no adjacency data exists yet for this room, not that it has no real neighbors.",
        }

    return _wrap(run)


TOOL_REGISTRY: dict[str, Callable[..., dict[str, Any]]] = {
    "get_sensor_history": get_sensor_history,
    "get_calendar": get_calendar,
    "get_mpc_trajectory": get_mpc_trajectory,
    "get_hvac_logs": get_hvac_logs,
    "get_similar_anomalies": get_similar_anomalies,
    "get_building_context": get_building_context,
    "check_neighboring_zones": check_neighboring_zones,
}

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_sensor_history",
            "description": "Time series of temperature and occupancy/HVAC state for a room. Always call this first -- establishes the shape of the deviation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "room_id": {"type": "string"},
                    "hours": {"type": "integer", "default": constants.SENSOR_HISTORY_DEFAULT_HOURS},
                },
                "required": ["room_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_calendar",
            "description": "Observed occupancy blocks for a room (retrospective, from sensor history -- not a forward-looking schedule). Always call this -- most anomalies are schedule mismatches.",
            "parameters": {
                "type": "object",
                "properties": {
                    "room_id": {"type": "string"},
                    "days": {"type": "integer", "default": constants.CALENDAR_DEFAULT_DAYS},
                },
                "required": ["room_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_mpc_trajectory",
            "description": "The most recently solved 24h setpoint/prediction trajectory for a room -- what the system intended.",
            "parameters": {
                "type": "object",
                "properties": {"room_id": {"type": "string"}},
                "required": ["room_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_hvac_logs",
            "description": "HVAC power state changes for a room -- distinguishes 'system did nothing' from 'system tried and failed'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "room_id": {"type": "string"},
                    "hours": {"type": "integer", "default": constants.HVAC_LOGS_DEFAULT_HOURS},
                },
                "required": ["room_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_similar_anomalies",
            "description": "Prior anomalies for this room with their resolved causes, if diagnosed -- detects recurrence.",
            "parameters": {
                "type": "object",
                "properties": {
                    "room_id": {"type": "string"},
                    "days": {"type": "integer", "default": constants.SIMILAR_ANOMALIES_DEFAULT_DAYS},
                    "hours": {"type": "integer", "description": "Optional override; converted to days (ceil)."},
                },
                "required": ["room_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_building_context",
            "description": "Room geometry, orientation, HVAC spec, and the active thermal model's fit quality (RMSE) -- use to test envelope/solar hypotheses or to check whether the RC model itself is untrustworthy here.",
            "parameters": {
                "type": "object",
                "properties": {"room_id": {"type": "string"}},
                "required": ["room_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_neighboring_zones",
            "description": "Current state of rooms adjacent to this one -- separates a zone-local fault from a building-wide one.",
            "parameters": {
                "type": "object",
                "properties": {"room_id": {"type": "string"}},
                "required": ["room_id"],
            },
        },
    },
]
