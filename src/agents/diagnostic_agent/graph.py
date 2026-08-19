from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from functools import partial
from typing import Any, Callable, TypedDict

import httpx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from sqlalchemy import Engine

from . import constants, contract, db, tools
from .input_contract import build_input_contract

_MAX_RATE_LIMIT_RETRIES = 5
_RETRY_AFTER_PATTERN = re.compile(r"try again in ([\d.]+)s", re.IGNORECASE)

SYSTEM_PROMPT = """You are the Diagnostic Agent for DynamIQ, an expert thermal detective. A thermal anomaly was detected: the physical RC model predicted one temperature but the sensor disagrees. Your job: classify WHICH cause best explains it and explain your reasoning. You never execute anything yourself. A deterministic system computes the confidence, energy waste and corrective action after you answer -- you only choose the cause and the explanation.

Rules you MUST follow:
1. You MUST call get_sensor_history FIRST -- see the temperature evolution and the shape of the deviation.
2. You MUST call get_calendar SECOND -- check whether the room was occupied.
3. You have a budget of 8 tool calls maximum (shown in your input). Every tool call costs 1.
4. You MUST NOT produce a final verdict before you have called both get_sensor_history and get_calendar.
5. If you are still not sure after 6 tool calls, stop and answer with cause "unknown".
6. Always answer with exactly ONE strict JSON object and nothing else (no markdown, no prose).

A TOOL-CALL answer looks like: {"tool": "get_sensor_history", "params": {"room_id": "room-101", "hours": 4}}
Available tools: get_sensor_history, get_calendar, get_mpc_trajectory, get_hvac_logs, get_similar_anomalies, get_building_context, check_neighboring_zones.
Tool parameters: get_calendar takes "days" (not "hours"); get_hvac_logs and get_sensor_history take "hours"; the others take only "room_id".

A FINAL-VERDICT answer looks like:
{"cause": "sensor_failure"|"hvac_underperformance"|"window_open_occupancy_gain"|"unmodelled_internal_gain"|"calibration_drift"|"scheduling_error"|"unknown", "evidence": [string, ...], "message": string}

Cause taxonomy -- pick the SINGLE closest match:
- "sensor_failure": readings missing/erratic, no sensor response, flat temperature.
- "hvac_underperformance": HVAC was running but the room stayed hot anyway (system tried and failed).
- "window_open_occupancy_gain": OCCUPIED room overheating while HVAC IS running and compensating (open window / doors let heat in, HVAC cannot recover). NOT this if HVAC is off.
- "unmodelled_internal_gain": room overheats with the HVAC INACTIVE or unable to explain the rise, from a heat source the model does not capture (equipment, servers, people density, or a load unrelated to weather/envelope). Prefer this when there is no cooling response.
- "calibration_drift": the RC model itself no longer fits (high RMSE) -- predictions are biased.
- "scheduling_error": HVAC off/cooling at the wrong time vs occupancy (e.g. cooling an empty room).
- "unknown": you cannot tell despite your best effort.

Do NOT output cause_confidence, energy_wasted_kwh, proposed_action or delta_c -- those are computed by the system. Output only the JSON object -- end your response immediately after it, with no trailing text."""


class DiagnosisState(TypedDict, total=False):
    anomaly_id: int
    room_id: str
    contract: dict[str, Any]
    tool_calls_made: list[dict[str, Any]]
    evidence_gathered: list[str]
    budget_remaining: int
    iteration_count: int
    llm_raw_output: str | None
    validated_output: dict[str, Any] | None
    validation_errors: list[str]
    fallback_used: bool
    node_trace: list[str]
    timestamps: dict[str, str]
    repair_attempts: int


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _try_load(block: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(block)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _extract_json(text: str | None) -> Any:
    if not text:
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for block in re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL):
        parsed = _try_load(block)
        if parsed is not None:
            return parsed
    for block in re.findall(r"`([^`]*\{(?:[^`]*)\}[^`]*)`", text):
        parsed = _try_load(block)
        if parsed is not None:
            return parsed
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for match in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text[match.start() :])
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(obj, dict):
            if "tool" in obj or "cause" in obj:
                return obj
            candidates.append(obj)
    return candidates[0] if candidates else None


def _call_groq(messages: list[dict[str, Any]], api_key: str, timeout_s: float = 60.0) -> str:
    payload = {
        "model": constants.GROQ_DIAGNOSTIC_MODEL,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": constants.GROQ_DIAGNOSTIC_MAX_TOKENS,
        **constants.groq_extra_payload(constants.GROQ_DIAGNOSTIC_MODEL),
    }
    with httpx.Client(timeout=timeout_s) as client:
        for attempt in range(_MAX_RATE_LIMIT_RETRIES + 1):
            response = client.post(
                constants.GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code == 429 and attempt < _MAX_RATE_LIMIT_RETRIES:
                match = _RETRY_AFTER_PATTERN.search(response.text)
                retry_after = response.headers.get("retry-after")
                if match:
                    delay = float(match.group(1)) + 0.5
                elif retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                else:
                    delay = 2.0 * (attempt + 1)
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
    raise AssertionError("unreachable")


def _run_tool(engine: Engine, name: Any, args: Any, room_id: str) -> dict[str, Any]:
    if not isinstance(name, str) or name not in tools.TOOL_REGISTRY:
        return {"ok": False, "error": f"unknown tool {name!r}"}
    fn = tools.TOOL_REGISTRY[name]
    args = dict(args or {})
    args = {**args, "room_id": args.get("room_id", room_id)}
    try:
        return fn(engine, **args)
    except TypeError as exc:
        return {"ok": False, "error": f"bad arguments for {name}: {exc}"}


def _summarize_tool_result(name: str, result: dict[str, Any]) -> str:
    if not result.get("ok"):
        return f"{name}: tool failed ({result.get('error')})"
    data = result.get("data") or {}
    if name == "get_sensor_history":
        series = data.get("series") or []
        temps = [p.get("temp_measured_c") for p in series if p.get("temp_measured_c") is not None]
        occupied = [p.get("occupied") for p in series if p.get("occupied") is not None]
        occ_desc = "yes" if any(occupied) else "no"
        if not temps:
            return f"{name}: no temperature readings in the window"
        trend = "stable"
        if len(temps) >= 2 and temps[-1] > temps[0] + 0.3:
            trend = "rising"
        elif len(temps) >= 2 and temps[0] > temps[-1] + 0.3:
            trend = "falling"
        return f"{name}: {len(temps)} readings, T in [{min(temps):.1f}, {max(temps):.1f}] C, latest {temps[-1]:.1f} C ({trend}), occupied during window: {occ_desc}"
    if name == "get_calendar":
        blocks = data.get("occupancy_blocks_observed") or []
        if blocks:
            first = blocks[0].get("start")
            last = blocks[-1].get("end")
            return f"{name}: {len(blocks)} observed occupancy block(s) over {data.get('days')} days, first {first}, last {last}"
        return f"{name}: {len(blocks)} observed occupancy block(s) over {data.get('days')} days"
    if name == "get_mpc_trajectory":
        trajectory = data.get("trajectory") or []
        if not trajectory:
            return f"{name}: no MPC trajectory solved for this room"
        last = trajectory[-1]
        return (
            f"{name}: MPC plan of {data.get('slots_total')} slots, latest setpoint "
            f"{last.get('setpoint_c')} C vs predicted {last.get('predicted_temp_c')} C"
        )
    if name == "get_hvac_logs":
        changes = data.get("state_changes") or []
        last_state = changes[-1].get("state") if changes else "unknown"
        cooling_seconds = data.get("cooling_seconds", 0)
        window_seconds = data.get("window_seconds", 0)
        share = f" ({100.0 * cooling_seconds / window_seconds:.0f}% of the window cooling)" if window_seconds else ""
        return (
            f"{name}: {data.get('changes_total')} HVAC state change(s), current state {last_state}, "
            f"cooling was active ~{cooling_seconds / 3600.0:.1f}h of the {window_seconds / 3600.0:.1f}h window{share}"
        )
    if name == "get_similar_anomalies":
        prior = data.get("prior_anomalies") or []
        causes = [p.get("resolved_cause") for p in prior if p.get("resolved_cause")]
        text = f"{name}: {len(prior)} similar prior anomal{'y' if len(prior) == 1 else 'ies'} in {data.get('days')} days"
        if causes:
            text += f", past causes: {causes}"
        return text
    if name == "get_building_context":
        model = data.get("active_model") or {}
        rmse = model.get("rmse_validation")
        return (
            f"{name}: room {data.get('room_label')} ({data.get('area_m2')} m2, {data.get('volume_m3')} m3, "
            f"{data.get('primary_orientation')}), RC model RMSE {rmse if rmse is not None else 'n/a'}"
        )
    if name == "check_neighboring_zones":
        neighbors = data.get("neighbors") or []
        return f"{name}: {len(neighbors)} adjacent zone(s) found"
    return f"{name}: {json.dumps(data)[:300]}"


def _build_llm_messages(state: DiagnosisState) -> list[dict[str, Any]]:
    user_content = {
        "contract": state.get("contract") or {},
        "budget_remaining": state.get("budget_remaining", constants.TOOL_CALL_BUDGET),
        "iteration_count": state.get("iteration_count", 0),
        "tool_history": state.get("tool_calls_made") or [],
        "evidence_gathered": state.get("evidence_gathered") or [],
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user_content, indent=2)},
    ]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

def _build_contract_node(state: DiagnosisState, engine: Engine, now: datetime) -> dict[str, Any]:
    anomaly_id = state["anomaly_id"]
    anomaly = db.fetch_anomaly(engine, anomaly_id)
    if anomaly is None:
        raise LookupError(f"Anomaly not found: {anomaly_id}")
    return {
        "room_id": anomaly.room_id,
        "contract": build_input_contract(anomaly, engine, now),
        "budget_remaining": constants.TOOL_CALL_BUDGET,
        "iteration_count": 0,
        "repair_attempts": 0,
        "tool_calls_made": [],
        "evidence_gathered": [],
        "llm_raw_output": None,
        "validated_output": None,
        "fallback_used": False,
        "node_trace": ["build_contract"],
        "timestamps": {"build_contract": now.isoformat()},
    }


def _llm_reason_node(state: DiagnosisState, api_key: str, llm_caller: Callable[..., str]) -> dict[str, Any]:
    raw = llm_caller(_build_llm_messages(state), api_key)
    return {
        "llm_raw_output": raw,
        "node_trace": (state.get("node_trace") or []) + ["llm_reason"],
        "timestamps": {**(state.get("timestamps") or {}), "llm_reason": _now_iso()},
    }


def _tool_executor_node(state: DiagnosisState, engine: Engine) -> dict[str, Any]:
    parsed = _extract_json(state.get("llm_raw_output"))
    if isinstance(parsed, dict):
        name = parsed.get("tool")
        params = parsed.get("params") or {}
    else:
        name = None
        params = {}
    result = _run_tool(engine, name, params, state["room_id"])
    summary = _summarize_tool_result(name, result)
    return {
        "tool_calls_made": (state.get("tool_calls_made") or []) + [
            {
                "tool": name,
                "params": params,
                "result_summary": summary,
                "result": result.get("data") if result.get("ok") else {},
                "ok": result.get("ok", False),
                "timestamp": _now_iso(),
            }
        ],
        "evidence_gathered": (state.get("evidence_gathered") or []) + [summary],
        "budget_remaining": state.get("budget_remaining", 0) - 1,
        "iteration_count": state.get("iteration_count", 0) + 1,
        "node_trace": (state.get("node_trace") or []) + ["tool_executor"],
        "timestamps": {**(state.get("timestamps") or {}), "tool_executor": _now_iso()},
    }


def _validate_output_node(state: DiagnosisState) -> dict[str, Any]:
    parsed = _extract_json(state.get("llm_raw_output"))
    if not isinstance(parsed, dict):
        result = contract.ValidationResult(False, None, ["no parseable JSON object in model output"])
    else:
        result = contract.validate_output(parsed, state["anomaly_id"], state["room_id"])
    return {
        "validated_output": result.output,
        "validation_errors": result.errors,
        "node_trace": (state.get("node_trace") or []) + ["validate_output"],
        "timestamps": {**(state.get("timestamps") or {}), "validate_output": _now_iso()},
    }


def _json_repair_node(state: DiagnosisState, api_key: str, llm_caller: Callable[..., str]) -> dict[str, Any]:
    messages = [
        {
            "role": "system",
            "content": "You are a strict JSON repair assistant. Reformate le JSON fourni, ne change JAMAIS le contenu : corrige uniquement la syntaxe (virgules, guillemets, blocs ```json). Reponds avec le JSON corrige uniquement.",
        },
        {
            "role": "user",
            "content": f"JSON invalide:\n{state.get('llm_raw_output') or ''}\n\nErreurs de validation:\n{state.get('validation_errors') or []}\n\nCorrige la syntaxe et renvoie le JSON seul.",
        },
    ]
    repaired = llm_caller(messages, api_key)
    return {
        "llm_raw_output": repaired,
        "repair_attempts": state.get("repair_attempts", 0) + 1,
        "node_trace": (state.get("node_trace") or []) + ["json_repair"],
        "timestamps": {**(state.get("timestamps") or {}), "json_repair": _now_iso()},
    }


def _fallback_node(state: DiagnosisState) -> dict[str, Any]:
    fallback = contract.templated_fallback(
        state["anomaly_id"],
        state.get("room_id", ""),
        state.get("contract") or {},
        "fallback triggered (budget exhausted or LLM failure)",
    )
    return {
        "validated_output": fallback,
        "fallback_used": True,
        "node_trace": (state.get("node_trace") or []) + ["fallback_node"],
        "timestamps": {**(state.get("timestamps") or {}), "fallback_node": _now_iso()},
    }


# ---------------------------------------------------------------------------
# Conditional routing
# ---------------------------------------------------------------------------

def route_from_llm(state: DiagnosisState) -> str:
    if state.get("budget_remaining", 0) <= 0:
        return "fallback_node"
    parsed = _extract_json(state.get("llm_raw_output"))
    if isinstance(parsed, dict):
        if "tool" in parsed:
            return "tool_executor"
        if "cause" in parsed:
            return "validate_output"
    return "fallback_node"


def route_from_validation(state: DiagnosisState) -> str:
    if state.get("validated_output") is not None:
        return "END"
    if state.get("repair_attempts", 0) < constants.JSON_REPAIR_RETRIES:
        return "json_repair"
    return "fallback_node"


def route_from_repair(state: DiagnosisState) -> str:
    if state.get("repair_attempts", 0) < constants.JSON_REPAIR_RETRIES:
        return "llm_reason"
    return "fallback_node"


# ---------------------------------------------------------------------------
# Graph assembly
# ---------------------------------------------------------------------------

def build_graph(
    engine: Engine,
    api_key: str,
    now: datetime | None = None,
    llm_caller: Callable[..., str] | None = None,
    checkpointer: Any | None = None,
):
    now = now or datetime.now(timezone.utc)
    llm_caller = llm_caller or _call_groq

    builder = StateGraph(DiagnosisState)
    builder.add_node("build_contract", partial(_build_contract_node, engine=engine, now=now))
    builder.add_node("llm_reason", partial(_llm_reason_node, api_key=api_key, llm_caller=llm_caller))
    builder.add_node("tool_executor", partial(_tool_executor_node, engine=engine))
    builder.add_node("validate_output", _validate_output_node)
    builder.add_node("json_repair", partial(_json_repair_node, api_key=api_key, llm_caller=llm_caller))
    builder.add_node("fallback_node", _fallback_node)

    builder.add_edge(START, "build_contract")
    builder.add_edge("build_contract", "llm_reason")

    builder.add_conditional_edges(
        "llm_reason",
        route_from_llm,
        {"tool_executor": "tool_executor", "validate_output": "validate_output", "fallback_node": "fallback_node"},
    )
    builder.add_edge("tool_executor", "llm_reason")

    builder.add_conditional_edges(
        "validate_output",
        route_from_validation,
        {"END": END, "json_repair": "json_repair", "fallback_node": "fallback_node"},
    )
    builder.add_conditional_edges(
        "json_repair",
        route_from_repair,
        {"llm_reason": "llm_reason", "fallback_node": "fallback_node"},
    )
    builder.add_edge("fallback_node", END)

    return builder.compile(checkpointer=checkpointer or InMemorySaver())


def run_investigation(
    engine: Engine,
    anomaly_id: int,
    api_key: str,
    now: datetime | None = None,
    llm_caller: Callable[..., str] | None = None,
    checkpointer: Any | None = None,
) -> DiagnosisState:
    graph = build_graph(engine, api_key, now=now, llm_caller=llm_caller, checkpointer=checkpointer)
    config = thread_config(anomaly_id)
    if graph.get_state(config).next:
        return graph.invoke(None, config=config)
    return graph.invoke({"anomaly_id": anomaly_id}, config=config)


def thread_config(anomaly_id: int) -> dict[str, dict[str, str]]:
    return {"configurable": {"thread_id": f"anomaly-{anomaly_id}"}}
