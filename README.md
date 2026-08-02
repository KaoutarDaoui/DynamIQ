# DynamIQ

Predictive HVAC control for buildings without a Building Management System.
This repo holds the **agents and Python engine** only — the RC thermal
model, the MPC optimizer, and the four-agent architecture (Bâtiment,
Thermique, Diagnostic, Superviseur) described in the project brief.
No AWS deployment, no database — everything runs locally against
synthetic (Phase 0) or, later, real sensor data.

## Layout

```
src/dynamiq/
  config.py            Settings loaded from .env
  data/
    schemas.py          Pydantic models: Building, Zone, SensorReading,
                         RCParams, SetpointTrajectory, Anomaly, Alert
    weather.py           Open-Meteo forecast client (stub)
    carbon.py            ElectricityMaps carbon intensity client (stub)
    simulator.py         Synthetic sensor data generator for Phase 0 (stub)
  models/
    rc_model.py          Grey-box RC thermal network: simulate + calibrate (stub)
    mpc.py                24h setpoint optimizer (stub)
  agents/
    base.py               Shared Agent base
    building_agent.py     Agent Bâtiment — building/zone context (stub)
    thermal_agent.py      Agent Thermique — wraps rc_model + mpc (stub)
    diagnostic_agent.py   Agent Diagnostic — Claude tool-use agent (stub)
    tools.py               Tool functions for Agent Diagnostic (stub)
    supervisor.py          Agent Superviseur — orchestration + decision rule (stub)
scripts/run_simulation.py  End-to-end demo wiring (stub)
examples/sample_building.json  One-zone sample building (ESI Algiers, Room 204)
tests/                      pytest placeholders, one per module to fill in
```

Every non-schema module currently raises `NotImplementedError` — this is
scaffolding: interfaces, docstrings, and the dependency graph are in
place so implementation can proceed module by module.

## Setup

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -e ".[dev]"
cp .env.example .env          # fill in ANTHROPIC_API_KEY when working on the Diagnostic agent
```

## Run tests

```bash
pytest
```

## Agent 2 — Thermal Agent (`src/agents/thermal_agent/`)

Deterministic numerical service, no LLM. For each instrumented room it: builds a lumped RC thermal model from geometry, fits R/C against sensor history, solves a 24h MPC for a cost/carbon-optimal setpoint schedule, and flags rooms whose real temperature disagrees with what the model predicted. Reads Agent 1's `buildings`/`floors`/`rooms`/`room_adjacencies` tables directly over SQL (never imports Agent 1's code) and owns its own tables: `rc_model_params`, `mpc_schedules`, `anomalies`, `sensor_readings`.

Verified end-to-end against the real Supabase database — calibration, MPC solve, and anomaly detection all confirmed working on real rooms, not just synthetic tests. Current limitation: no real sensors are deployed yet, so `sensor_readings` is synthetic/demo data, and most real rooms are missing the wall-geometry data (from Agent 1's floor-plan extraction) needed for a physically meaningful model. Full details and rationale in `src/agents/thermal_agent/README.md`.

## Agent 3 — Diagnostic Agent (`src/agents/diagnostic_agent/`)

Event-driven: runs only when Agent 2 raises a `thermal_anomaly`. Gathers evidence via 7 read-only tools, produces a cause + a proposed action, then hands the decision to a fully deterministic Supervisor layer (`supervisor.py`) that decides autonomous / human-alert / log-only — the LLM's own opinion never decides whether an action is safe. Uses Groq (its own `DIAGNOSTIC_GROQ_API_KEY`, isolated from Agent 1's vision-extraction key) rather than the Bedrock/Claude the original brief specified. Owns `diagnoses`/`alerts`/`audit_log`; never imports Agent 1 or Agent 2's code, even to read their tables.

Verified live end-to-end: a real anomaly raised by Agent 2's own detection logic, diagnosed through the real Groq API, correctly persisted and routed by the Supervisor. Full details and rationale in `src/agents/diagnostic_agent/README.md`.

## Agent 4 — Supervisor / Orchestration (`src/agents/supervisor/`)

The runtime that actually wires the other three together — polls for undiagnosed anomalies and invokes Agent 3, runs Agent 2's fast loop and (only when due) its calibration sweep, and dispatches a real alert (a local log file, or a webhook if one's configured) whenever the deterministic decision layer routes a diagnosis to `human_alert`. Unlike Agent 2/3, this one *is* meant to import the other agents' packages directly — it's the coordinator sitting above them, not a peer.

Verified live: one `run_full_cycle()` call ran all three other agents against the real Supabase database in sequence — fast loop, a correctly-skipped calibration (not due yet), and a live Groq diagnosis of a real anomaly — and persisted correctly throughout. Full details in `src/agents/supervisor/README.md`.

## Notes on scope

- **LLM provider**: the brief specifies Amazon Bedrock (Claude) for the
  Supervisor and Diagnostic agents. The actual Diagnostic Agent build
  (`src/agents/diagnostic_agent/`) uses Groq instead — see that package's
  README for why. `src/dynamiq/agents/diagnostic_agent.py` (Anthropic,
  `ANTHROPIC_API_KEY`) is the original Phase-0 stub and was superseded by
  the real build, not deleted.
- **Storage**: no database. The Supervisor keeps an in-memory
  `audit_log`; persistence (RDS in the brief) is a deployment concern
  and out of scope here.
- **Data**: `data/simulator.py` is meant to generate synthetic sensor
  histories (per the Phase 0 roadmap in the brief) so the RC model, MPC,
  and Diagnostic agent can be built and demoed before real ESP32 sensors
  are installed.
