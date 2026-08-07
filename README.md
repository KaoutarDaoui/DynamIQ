# DynamIQ

Predictive HVAC control for buildings without a Building Management System.
Instead of reacting *after* a room overheats, DynamIQ **predicts** what will
happen (physics + weather), **plans** the optimal cooling schedule 24h ahead,
and **acts** pre-emptively. This repo holds the agents and Python engine only
— no AWS deployment, no hosted database. Everything runs against a real
Supabase/Postgres instance (or a throwaway local one from `dev/`).

Versioned note: the prototype Phase-0 scaffolding originally lived under
`src/dynamiq/`; the four working agents live under `src/agents/` and are the
real builds. The `src/dynamiq/` package is now **legacy dead scaffolding** —
every module still raises `NotImplementedError`. See [Legacy scaffolding](#legacy-scaffolding).

## The problem DynamIQ solves

Most buildings (like ESI Algiers) have no BMS. Each room's AC works reactively:

```
Temp > 24°C  →  AC turns ON  →  Room cools  →  AC turns OFF  →  heats up →  repeat
```

DynamIQ flips this: instead of reacting after the fact, it predicts, plans,
and cools pre-emptively.

---

## Architecture — 4 Agents

```
                    BUILDING
                       │
                       ▼
   ┌────────────────────────────┐
   │ Agent 1 — Building          │  Describes the building:
   │ (geometry, envelope)       │  walls, windows, orientation, area
   └────────────┬───────────────┘
                │  R, C, envelope data  (via rooms/floors/... tables)
                ▼
   ┌────────────────────────────┐
   │ Agent 2 — Thermal          │  Physics brain (no LLM):
   │ RC Model + Calibration     │  predicts temp, self-calibrates,
   │ + MPC                       │  optimizes setpoints, flags anomalies
   └────────────┬───────────────┘
                │
     predicted ≠ measured ?
                │ yes  (thermal_anomaly)
                ▼
   ┌────────────────────────────┐
   │ Agent 3 — Diagnostic        │  Investigates WHY (Groq LLM, 7 tools):
   │ (event-driven)              │  cause + proposed action
   └────────────┬───────────────┘
                │ cause + action
                ▼
   ┌────────────────────────────┐
   │ Agent 4 — Supervisor        │  Deterministic decision layer:
   │ (orchestrator)               │  autonomous / human_alert / log_only
   └────────────────────────────┘  + runs the whole cycle
```

**Key rule:** Agents 2 and 3 never import each other's code (nor Agent 1's) —
they talk only through the shared Supabase tables they own/read. Agent 4
(`supervisor/orchestrate.py`) is the *only* place allowed to import the other
agents, because it sits above them as the coordinator.

---

## Repo layout (`src/agents/`)

The four packages mirror the four agents. `src/dynamiq/` is legacy and unused.

```
src/agents/
  __init__.py                 Lazy re-exports (PEP 562)

  building_agent/             Agent 1 — floor plan → structure
    __init__.py
    building_agent.py         BuildingAgent: process_and_save_floor(), get_thermal_parameters()
    vision_processor.py       Groq Vision: plan → rooms inventory (PDF/JPEG/PNG/WEBP/GIF)
    geometry_processor.py     wall positions → cardinal orientations; auto-number rooms
    schema_models.py          SQLModel: Building/Floor/Room/RoomAdjacency + config models
    db_manager.py             SQLModel CRUD (save/load buildings, floors, rooms)
    api.py                    FastAPI app: POST /buildings, POST /floors/{level}/upload
    config.py                 shared SQLAlchemy engine + get_session() from DATABASE_URL

  thermal_agent/              Agent 2 — physics brain (deterministic, no LLM)
    __init__.py
    handler.py                Fast-loop entry: fetch → build model → MPC → persist → anomalies
    db.py                     Raw-SQL access to buildings/floors/rooms/adjacencies/readings
    zone_model.py             Lumped RC zone model (envelope → R/C/UA, sanity gate)
    rc.py                     1st-order RC physics: fit_rc / simulate / one-step-ahead
    mpc.py                    cvxpy 24h setpoint optimizer (energy + carbon)
    calibrate.py              RC calibration sweep against sensor history
    anomaly.py                anomaly pipeline: sensor validity, comfort, thermal, drift
    weather.py                Open-Meteo (+pvlib) temp/GHI forecast; solar_gain_w()
    carbon.py                 ElectricityMaps grid carbon-intensity forecast
    constants.py              thermal/energy constants, tariffs, thresholds
    api.py                    Read-only FastAPI app for the frontend's Thermal, MPC,
                               Anomalies, Diagnoses, Alerts and Reports pages (own port, not
                               the fast loop)

  diagnostic_agent/           Agent 3 — WHY (Groq LLM, event-driven)
    __init__.py
    diagnose.py               diagnose_anomaly(): build contract → LLM+tools → validate → route
    tools.py                  TOOL_REGISTRY: 7 read-only tools + schemas
    contract.py               Output-contract validation + deterministic fallback
    supervisor.py             Deterministic decision gate: autonomous/human_alert/log_only
    db.py                     Raw-SQL reads (anomalies, readings, schedules) + writes diagnoses
    constants.py              Groq config, tool budget, defaults

  supervisor/                 Agent 4 — orchestration (the coordinator)
    __init__.py
    orchestrate.py            run_full_cycle(): fast loop + calibration-if-due + diagnosis
    scheduler.py              run_forever()/run_n_cycles() timed driver
    channels.py               AlertChannel: LogChannel / WebhookChannel / dispatch
    db.py                     poll undiagnosed anomalies, last-calibration time
    constants.py              loop intervals, alert log path, webhook timeout
```

Supporting files:

```
dev/                            throwaway test data (seed scripts + local Postgres compose)
examples/sample_building.json   one-zone sample (ESI Algiers, Room 204)
scripts/run_simulation.py       end-to-end demo run of all 4 agents against real Supabase,
                                 traced to scripts/simulation_runs/*.json
scripts/seed_djezzy_building.py one-time seed of the Djezzy HQ Annex demo building (18 rooms,
                                 3 floors, 3 instrumented + really calibrated) into real Supabase
tests/                          pytest suites, one package per agent
pyproject.toml / requirements.txt / .env.example
```

Every module in the four `src/agents/` packages is a real implementation with
tests; the only unimplemented code left in the repo is the legacy
`src/dynamiq/` package.

---

## Agent 1 — Building

**Job:** turn a floor plan into structured thermal-relevant data and persist
it. Built on the `rooms` table (Supabase Postgres):

| Column | Type | Description |
|---|---|---|
| `room_id` | text | e.g. `room-101` (auto-numbered) |
| `floor_id` | text | which floor |
| `room_label` | text | human label |
| `area_m2` | float | zone floor area |
| `primary_orientation` | text | N / S / E / W from plan alignment |
| `config_json` | JSONB | full envelope / thermal / HVAC / adjacency breakdown |

`config_json` structure (Pydantic models in `schema_models.py`):

```json
{
  "envelope": {
    "north_wall_m2": 15.5, "south_wall_m2": 0.0,
    "east_wall_m2": 10.2,  "west_wall_m2": 0.0,
    "external_walls": ["north", "east"],
    "internal_walls": ["south", "west"]
  },
  "thermal": {
    "wall_r_value": 1.8,        // R-value (m²·K/W)
    "window_u_value": 5.8,      // U-value (W/m²·K)
    "thermal_mass": "heavy",
    "estimated_C_zone": 145000.0 // heat capacity (J/K)
  },
  "hvac": {
    "type": "split_unit", "capacity_kw": 3.5,
    "cop_cooling": 2.8, "setpoint_occupied_c": 22.0
  },
  "adjacency": {
    "north": "external", "south": "room-102",
    "east": "external", "west": "room-103"
  }
}
```

- **envelope** → wall areas per direction + external vs. adjacent (for solar gain
  `Q_solar` and inter-zone transfer).
- **thermal** → the R and C values Agent 2's model needs.
- **hvac** → unit specs (capacity, efficiency, occupied setpoint).
- **adjacency** → what's on the other side of each wall (relevant for later
  multi-zone 2R2C models).

`BuildingAgent.get_thermal_parameters("room-101")` returns `R`, `C`,
`wall_r_value`, `estimated_C_zone` for a room — a convenience accessor. Agent 2
currently does *not* call this; it reads the same data straight from the `rooms`
table by SQL (see below).

---

## Agent 2 — Thermal (the physics core)

Deterministic, **no LLM**. For each instrumented room:

1. Builds a lumped **RC thermal model** from the geometry,
2. **Calibrates** R/C against real sensor history,
3. solves a 24h **MPC** for the cost/carbon-optimal setpoint schedule,
4. **flags** a `thermal_anomaly` when measured temperature disagrees with the
   model's prediction.

It reads Agent 1's tables (`rooms`, `floors`, `buildings`,
`room_adjacencies`) **over raw SQL** — it never imports Agent 1's code, and
owns/converts `rc_model_params`, `mpc_schedules`, `anomalies`,
`sensor_readings`. Nutrition: it fetches rooms direct from its own `db.py`
`fetch_*` helpers, not through `BuildingAgent`.

### The RC model, simply

Think of it as an electrical circuit analog:

```
Outside (38°C) ──[ R ]── Room [ C ] ──> 24°C
```

- **R** (resistance) = how well insulated the wall is. Thin wall → low R →
  heat enters fast; insulated wall → high R → slow.
- **C** (capacitance) = thermal mass. A coffee cup heats fast; a pool heats
  slowly.

Given outside temp, R and C, the model predicts room temperature evolution
minute by minute.

### Calibration

If the model predicts 25°C but the sensor reads 26°C, Agent 2 nudges R and C
until prediction ≈ measurement, over `sensor_readings` history
(`calibrate.run_calibration_sweep`, `rc.fit_rc`).

### MPC

Already able to predict, MPC answers "what setpoints over the next 24h?" using
weather forecast, electricity price, carbon intensity, and comfort constraints
(`mpc.solve` via cvxpy). The `carbon` signal lets it cool during low-carbon
hours (e.g. solar-heavy 13h) rather than gas-heavy 19h when flexible.

### Anomaly detection

If predicted and measured diverge past a threshold, Agent 2 raises a
`thermal_anomaly` — the *only* trigger that wakes Agent 3
(`anomaly.run_anomaly_pipeline`).

### Verified end-to-end (real Supabase)

Calibration, MPC solve, and anomaly detection all confirmed working on real
rooms.

**Current limits:** no real sensors deployed yet, so `sensor_readings` is
synthetic/demo; most real rooms still lack wall-geometry data from Agent 1's
floor-plan extraction, so their models aren't yet physically meaningful.

---

## Agent 3 — Diagnostic

Event-driven — only runs when Agent 2 raises `thermal_anomaly`.

- Gathers evidence via **7 read-only tools** (`tools.py`): sensor history,
  calibrate, MPC trajectory, HVAC logs, similar past anomalies, building
  context, neighboring zones.
- Produces a **cause + proposed action**.
- Hands the decision to the deterministic Supervisor gate (`supervisor.py`) —
  the LLM's opinion alone never decides whether an action is safe to run.
- Uses **Groq** (its own `DIAGNOSTIC_GROQ_API_KEY`), not the Bedrock/Claude the
  original brief specified. Owns `diagnoses` / `alerts` / `audit_log`; never
  imports Agent 1 or 2's code even to read their tables.

The LLM output is validated against a strict JSON contract (`contract.py`); if
the LLM misbehaves, a deterministic fallback kicks in.

Verified live end-to-end: a real anomaly raised by Agent 2's own detection was
diagnosed through the real Groq API and correctly persisted and routed.

---

## Agent 4 — Supervisor / Orchestration

The runtime that wires the other three together (`orchestrate.py`):

- **polls** for undiagnosed anomalies → invokes Agent 3 (`run_diagnosis_cycle`);
- **runs** Agent 2's fast loop, and (only when due) its calibration sweep
  (`run_fast_loop_cycle`, `run_cooling_calibration_cycle_if_due`);
- **dispatches a real alert** (local log file, or webhook if configured) when
  the decision layer routes a diagnosis to `human_alert` (`channels.py`).

Unlike Agents 2/3, this package **is** allowed to import the others — it's the
coordinator sitting above them. Decision categories: **autonomous fix** /
**human alert** / **log only**.

Verified live: a single `run_full_cycle()` ran all three agents against real
Supabase in sequence — fast loop, a correctly-skipped calibration (not due
yet), and a live Groq diagnosis — persisted correctly throughout.

---

## Data flow (one full cycle)

```
Floor plan
   ▼
Agent 1 (Building) ──► R, C, geometry, orientation ──► rooms table
   ▼
Agent 2 (Thermal)  RC predict + calibrate + MPC (24h)
   │                     maintenance loop only when due
   ▼
predicted vs measured
   ├ normal ─────────────► continue
   └ mismatch ─► thermal_anomaly
                     ▼
              Agent 3 (Diagnostic)  evidence → cause + action
                     ▼
              Agent 4 (Supervisor)  autonomous / human_alert / log_only
```

---

## Setup

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -e ".[dev]"
cp .env.example .env          # fill ANTHROPIC_API_KEY / DIAGNOSTIC_GROQ_API_KEY
pytest
```

`DATABASE_URL` should point at the real Supabase Postgres (see `.env.example`).
The schema (DDL) is now managed directly in Supabase, not in this repo; `dev/`
only holds seed/demo scripts that need an existing schema.

---

## Scope / deviations from the original brief

- **LLM provider:** brief specified AWS Bedrock (Claude) for the Supervisor and
  Diagnostic agents. The real Diagnostic build uses **Groq**. The original
  Anthropic stub in the legacy `src/dynamiq/` tree still exists but was
  superseded, not deleted.
- **Storage:** no persistent database for the Supervisor layer — it keeps an
  in-memory `audit_log`; RDS persistence is a deployment concern, out of scope.
- **Data:** sensor history is synthetic (Phase 0) until real ESP32 sensors are
  installed.

## Legacy scaffolding (`src/dynamiq/`, NOT used)

Deprecated prototype of the architecture, kept for reference. **Every module
raises `NotImplementedError`** and is not wired into any of the four live
agents:

```
src/dynamiq/
  data/{weather,carbon,simulator}.py
  models/{rc_model,mpc}.py
  agents/{base,building_agent,thermal_agent,diagnostic_agent,tools,supervisor}.py
```

If you're adding features or reading the code, ignore this package entirely —

## TL;DR

- **Agent 1** describes the building (geometry + envelope).
- **Agent 2** is the physics brain: RC predicts temperature, calibration keeps
  it accurate, MPC plans the optimal 24h cooling, and it flags anomalies.
- **Agent 3** figures out *why* an anomaly happened (Groq, 7 tools).
- **Agent 4** coordinates everything and makes the final call.

Master Agent 2 (RC + Calibration + MPC) and you understand ~80% of DynamIQ's
intelligence.