# DynamIQ

**Predictive HVAC intelligence for buildings without a Building Management System (BMS).**

DynamIQ transforms conventional buildings with independent split AC units into **predictive, data-driven thermal environments**. Instead of reacting after a room becomes uncomfortable, the system combines building geometry, physical thermal modeling, weather forecasts, optimization, anomaly detection, and AI-powered diagnosis to anticipate problems and optimize HVAC operation.

**Target environment:** ESI Algiers — a building without centralized BMS, using independent split AC units.

---

## Problem

Buildings without a centralized BMS face several challenges:

* HVAC units operate independently with limited centralized control.
* Thermal discomfort can only be detected after it occurs.
* HVAC anomalies are difficult to diagnose automatically.
* Energy consumption is not optimized according to future conditions.
* Maintenance teams may need to investigate problems manually.

DynamIQ addresses these challenges through a **multi-agent predictive HVAC architecture**.

---

## Solution

DynamIQ combines four specialized agents:

| Agent                    | Responsibility                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **Agent 1 — Building**   | Understands the building structure and thermal characteristics                           |
| **Agent 2 — Thermal**    | Predicts temperature, calibrates models, optimizes HVAC operation, and detects anomalies |
| **Agent 3 — Diagnostic** | Investigates anomalies and determines their probable causes                              |
| **Agent 4 — Supervisor** | Orchestrates the system and makes the final deterministic decision                       |

The key principle is:

> **The LLM reasons; deterministic components control critical decisions.**

---

# Architecture

```text
                         ┌─────────────────────────────────────┐
                         │          ORCHESTRATOR               │
                         │       (src/orchestration)           │
                         │                                     │
                         │  Calibration → Fast Loop →          │
                         │  Diagnosis → Alert dispatch         │
                         └───────────────┬─────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
      ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
      │   AGENT 1     │          │   AGENT 2     │          │   AGENT 3     │
      │   Building    │          │    Thermal    │          │  Diagnostic   │
      │               │          │               │          │               │
      │ Plan → Model  │          │ RC + MPC +    │          │ LLM + 7 tools │
      │               │          │ Anomaly       │          │ + gate        │
      └───────┬───────┘          └───────┬───────┘          └───────┬───────┘
              │                          │                          │
              └──────────────────────────┼──────────────────────────┘
                                         ▼
                         ┌─────────────────────────────────────┐
                         │         SUPABASE POSTGRES           │
                         │                                     │
                         │ buildings · rooms · sensors         │
                         │ RC models · MPC schedules           │
                         │ anomalies · diagnoses · audit logs  │
                         └─────────────────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │       ALERTS        │
                              │ Log + Webhook        │
                              └─────────────────────┘
```

### Architectural principle

Agents 1, 2, and 3 are independent modules. They do not import or directly call each other.

They communicate through the shared PostgreSQL database, while the **orchestrator** (`src/orchestration/`) is the only coordinator responsible for running the complete workflow. The deterministic safety gate (`autonomous` / `human_alert` / `log_only`) lives **inside Agent 3** (`diagnostic_agent/supervisor.py`) and is invoked by the orchestrator.

---

# End-to-End Workflow

DynamIQ operates through a continuous predictive cycle:

```text
Building & Sensor Data
        ↓
Agent 1 — Building Understanding
        ↓
Agent 2 — Thermal Prediction
        ↓
RC Model + MPC Optimization
        ↓
Anomaly Detection
        ↓
Agent 3 — Root-Cause Diagnosis
        ↓
Agent 4 — Deterministic Decision Gate
        ↓
 ┌──────────────┬───────────────┬──────────────┐
 │  autonomous  │  human_alert  │   log_only   │
 └──────────────┴───────────────┴──────────────┘
```

The system runs its fast thermal loop every **15 minutes**.

---

# The Four Agents

## Agent 1 — Building

**Role:** Convert a building floor plan into structured building and thermal information.

### Current implementation

The agent:

1. Detects the input file type.
2. Processes PDF and image floor plans.
3. Uses Groq Vision to identify rooms.
4. Extracts room properties such as:

   * room label
   * bounding box
   * area
   * external walls
   * windows
   * room type
   * orientation
5. Automatically numbers and maps rooms.
6. Computes cardinal orientations.
7. Builds the building configuration.
8. Persists the resulting structure in PostgreSQL.

### Stored data

`buildings`, `floors`, `rooms`, and `room_adjacencies`.

> **Planned:** a LangGraph-based extract → validate → correct workflow for low-confidence floor-plan analysis.

---

## Agent 2 — Thermal

**Role:** Predict, calibrate, optimize, and detect thermal anomalies.

**Implementation:** Python, deterministic, no LLM.

### 15-minute cycle

1. **Observe**
   Sensors, weather, occupancy, electricity price, and carbon intensity.

2. **Predict**
   First-order RC thermal model.

3. **Optimize**
   24-hour MPC optimization using CVXPY.

4. **Detect**
   Sensor faults, comfort violations, and thermal anomalies.

5. **Calibrate**
   Periodically updates the RC model using recent sensor history.

### Two types of prediction

|             | One-Step Prediction    | MPC Prediction                 |
| ----------- | ---------------------- | ------------------------------ |
| **Horizon** | 15 minutes             | 24 hours                       |
| **Purpose** | Validate thermal model | Optimize future HVAC operation |
| **Method**  | RC model               | CVXPY / MPC                    |
| **Output**  | Predicted temperature  | Optimal setpoints              |
| **Failure** | Can trigger anomaly    | Recomputed next cycle          |

The distinction is important:

> **The RC model predicts the next state to evaluate the system's health, while MPC plans the optimal future operation.**

---

## Agent 3 — Diagnostic

**Role:** Determine **why** a thermal anomaly occurred. Agent 3 is a **hybrid**:
the LLM classifies *what* the problem is, and deterministic Python computes
every number that can be derived from real data.

Agent 3 is event-driven and is triggered when an undiagnosed thermal anomaly is detected.

### Hybrid division of labour

```text
                       Agent 3
                          │
                   ┌──────┴──────┐
                   ↓             ↓
                  LLM           Python
                   │              │
                   ↓              ↓
                WHAT?            HOW?
                   │              │
            Cause + reason    Confidence
                              Energy
                              Action
                              Delta
                   │              │
                   └──────┬───────┘
                          ↓
                     Safety Gate
                          ↓
                autonomous / human_alert / log_only
```

The LLM provides the **intelligence**, Python provides the **facts**:

| Question | Who answers | Output |
| -------- | ----------- | ------ |
| What is the likely cause? | LLM | `cause` (closed taxonomy) |
| Why do I think that? | LLM | `evidence` list + `message` (free text) |
| How sure are we? | Python | `cause_confidence` (evidence-weighted) |
| How much energy was wasted? | Python | `energy_wasted_kwh` (sensors − MPC) |
| What action is allowed? | Python | `proposed_action` (cause → action map) |
| By how much should we correct? | Python | `delta_c` (residual, clamped) |
| Is it safe to act? | Python | Safety Gate decision |

### The Cause Taxonomy

The LLM no longer writes a free-text cause. It picks **exactly one** value from
a fixed taxonomy — this is what makes diagnoses comparable, filterable, and
cooldown-aware (two runs writing "sensor fault" and "sensor malfunction" no
longer drift apart):

* `sensor_failure` — readings missing/erratic, no sensor response, flat temperature.
* `hvac_underperformance` — HVAC was running but the room stayed hot anyway (system tried and failed).
* `window_open_occupancy_gain` — occupied room overheating despite HVAC (open window / doors).
* `unmodelled_internal_gain` — room overheats while the model fits well (heat source the model does not capture: equipment, servers, people density).
* `calibration_drift` — the RC model itself no longer fits (high RMSE); predictions are biased.
* `scheduling_error` — HVAC off/cooling at the wrong time vs occupancy (e.g. cooling an empty room).
* `unknown` — cannot tell despite best effort (→ always human inspection).

The Pydantic `DiagnosisContract` rejects any cause outside this taxonomy, so the
LLM cannot sneak a made-up cause through.

### Cause → Action mapping

Each cause maps to exactly **one** action family (defined in `constants.py`):

| Cause | Action | Gate behaviour |
| ----- | ------ | -------------- |
| `sensor_failure` | `inspection_required` | human_alert |
| `hvac_underperformance` | `setpoint_change` | autonomous-eligible |
| `window_open_occupancy_gain` | `setpoint_change` | autonomous-eligible |
| `unmodelled_internal_gain` | `inspection_required` | human_alert |
| `calibration_drift` | `schedule_correction` | autonomous-eligible |
| `scheduling_error` | `schedule_correction` | autonomous-eligible |
| `unknown` | `inspection_required` | human_alert |

A broken sensor can never be "fixed" by a setpoint change, and an unknown cause
never becomes an autonomous action.

### How confidence is computed

Python scores how many **real signals** corroborate the chosen cause:

* **Temperature trend** — rising / falling / flat over the anomaly window
* **HVAC behaviour** — was the system running and failing, or never trying?
* **Occupancy** — was the room occupied during the anomaly?
* **Model fit (RMSE)** — is the RC model itself trustworthy, or is *it* the problem?
* **Recurrence** — has this room+cause happened before?

Signal count → level (`CONFIDENCE_HIGH_AT` = 3, `CONFIDENCE_MEDIUM_AT` = 2,
`CONFIDENCE_LOW_AT` = 1):

| Corroborating signals | Confidence |
| --------------------- | ---------- |
| 3+ | `high` |
| 2 | `medium` |
| 1 | `low` |
| 0 / contradictory | `undetermined` |

`undetermined` always forces `inspection_required` → `human_alert`. The LLM no
longer *declares* confidence — it is measured from the evidence.

### How energy waste is computed

```
energy_wasted_kwh = Σ actual HVAC consumption during the anomaly (kWh)
                  − Σ MPC predicted consumption over the same window (kWh)
```

Both sums come from real tables (`sensor_readings.q_hvac_w` and
`mpc_schedules.predicted_kwh`), bounded by the anomaly window
`[opened_at, closed_at]`. The result is clamped at 0 and stored with its basis:

* `mpc_counterfactual` — real value computed (preferred)
* `no_sensor_data` — no readings in the window → `None` (never fabricated)
* `no_mpc_counterfactual` — no MPC schedule → `None` (never fabricated)

### How delta_c is computed

`delta_c` is derived from the **residual** (how far the room missed its band),
clamped to `±DEFAULT_COMFORT_BOUNDS_DELTA_C` (default 2.0 °C):

```text
residual = measured − predicted  (e.g. +3.0 °C)
delta_c  = clamp(residual × gain, −2.0, +2.0)
```

Because delta_c is bounded by the same constant the Safety Gate checks, an
oversized correction automatically trips `human_alert` — the two layers stay
consistent by construction.

### LangGraph workflow

```text
build_contract
      ↓
llm_reason
      ↓
tool_executor
      ↓
validate_output
      ↓
 ┌───────────────┐
 │ Valid JSON?   │
 └───────┬───────┘
         │
     Yes │ No
         │
         ▼
        END
         │
         └────→ json_repair → llm_reason
```

> `validate_output` runs the Pydantic `DiagnosisContract`. After the graph ends,
> `evidence.finalize_diagnosis` overwrites the LLM-guessed confidence, energy
> and action with the deterministic values before anything is persisted.

### The investigation loop

```text
Reason → Select tool → Execute tool → Update state → Reason again
   ↑                                                        │
   └────────────────────────────────────────────────────────┘
   (repeat until enough evidence, or the 8-call budget is exhausted)
```

* The LLM receives the current **state** — the anomaly contract, evidence
  gathered so far, tool history, and remaining budget.
* It asks *"what do I already know, and what is still missing?"*
* If more evidence is needed, it picks a tool; the Tool Executor runs it and the
  result is added back to the state; the LLM reasons again with the updated
  state.
* The loop is bounded by a **maximum of 8 tool calls** (`TOOL_CALL_BUDGET`) —
  the agent can never spin forever.
* If the budget runs out without a verdict, the fallback node produces a safe
  `unknown` / `inspection_required` result.

### The seven diagnostic tools

All tools are **read-only** — they provide evidence but never modify the
database or control the building. The LLM decides which to call (budget of 8):

| Tool | Evidence provided |
| ---- | ----------------- |
| `get_sensor_history` | Temperature evolution, shape of the deviation (mandatory 1st call) |
| `get_calendar` | Inferred occupancy blocks (mandatory 2nd call) |
| `get_mpc_trajectory` | What the system *intended* — setpoint + predicted temperature |
| `get_hvac_logs` | Distinguishes "system did nothing" from "system tried and failed" |
| `get_similar_anomalies` | Prior anomalies + their resolved causes (recurrence) |
| `get_building_context` | Room geometry, orientation, HVAC spec, model fit (RMSE) |
| `check_neighboring_zones` | Adjacent rooms — zone-local fault vs building-wide |

After each call the result (summarised, downsampled) is added to the state so
the LLM can decide whether it has enough evidence or needs another tool.

### Validation & fallback (two layers of protection)

1. **Pydantic (`DiagnosisContract`)** — "is the diagnosis *valid*?" Enforces the
   schema: taxonomy cause, confidence enum, numeric fields, action enum. On
   failure the system can repair the JSON up to **2 times**; if it still fails,
   the fallback node emits a safe `inspection_required` result.
2. **Safety Gate** — "is the proposed action *safe*?" A deterministic rule set
   that routes `autonomous` / `human_alert` / `log_only` (see the Orchestrator
   section).

**The principle:** the LLM provides the intelligence; deterministic rules
provide the control and safety.

If the LLM fails to produce a valid diagnosis, the system falls back to a deterministic `inspection_required` decision.

### Traceability

Every diagnostic run is persisted through:

* node traces
* tool calls
* model output
* timestamps
* supervisor decision
* diagnosis

This provides a complete audit trail.

---

## Orchestrator (formerly "Agent 4")

**Role:** Coordinate the agents and run the complete cycle. The orchestrator
(`src/orchestration/`) is *not* an LLM agent — it is the deterministic
coordinator that drives the workflow:

```text
Calibration if required
        ↓
Agent 2 — Fast Thermal Loop
        ↓
Agent 3 — Diagnosis
        ↓
Deterministic Gate
        ↓
Decision
```

Possible decisions:

* `autonomous`
* `human_alert`
* `log_only`

### Cycle audit

Every full cycle is recorded in `orchestration_runs` (one row per run): the
counts for calibration / fast loop / diagnoses, the dispatched alerts, and
per-room / per-diagnosis detail in JSONB columns. It is the orchestrator's
audit table — queryable ("which alerts fired last week, from which anomaly?"),
unlike the `logs/alerts.jsonl` notification feed.

### Technical logs

Each service also writes rotating **technical logs** (debugging/tracing only —
never audit) to `logs/`:

| Service            | File                    |
| ------------------ | ----------------------- |
| Agent 1 (building) | `logs/building_agent.log` |
| Agent 2 (thermal)  | `logs/thermal_agent.log`  |
| Agent 3 (diagnostic) | `logs/diagnostic_agent.log` |
| Orchestrator       | `logs/orchestration.log`  |
| Alerts (dispatch)  | `logs/alerts.jsonl`       |

The split: **structured audit → DB** (queryable, tied to entities);
**technical noise → files** (debug, exceptions, performance).

### Critical design principle

> **The LLM never makes the final control decision by itself.**

The final gate is deterministic and based on explicit rules such as anomaly severity, risky actions, inspection requirements, and recurrence.

---

# Database

DynamIQ uses **Supabase PostgreSQL** as the shared persistence layer.

The database contains 15 main tables covering:

* organizations
* buildings
* floors
* rooms
* HVAC units
* room relationships
* sensor readings
* RC model versions
* MPC schedules
* anomalies
* diagnoses
* alerts
* audit logs
* building agent runs
* orchestration runs

The database therefore acts as the **shared communication layer between the agents**.

---

# Technology Stack

| Layer            | Technology                              |
| ---------------- | --------------------------------------- |
| Backend          | Python ≥ 3.10                           |
| Database         | Supabase PostgreSQL                     |
| ORM / DB         | SQLModel / SQLAlchemy                   |
| Thermal Modeling | NumPy / SciPy                           |
| Optimization     | CVXPY + ECOS                            |
| Solar Modeling   | pvlib                                   |
| Weather          | Open-Meteo                              |
| Carbon Forecast  | Electricity Maps                        |
| Vision           | Groq Vision                             |
| LLM Diagnosis    | Groq + LangGraph                        |
| API              | FastAPI                                 |
| Frontend         | React 19 + Vite + TypeScript + Tailwind |
| Charts           | Recharts                                |
| Testing          | pytest                                  |

---

# Project Structure

```text
src/
└── agents/
    ├── building_agent/
    │   ├── vision_processor.py
    │   ├── geometry_processor.py
    │   ├── schema_models.py
    │   ├── db_manager.py
    │   └── api.py
    │
    ├── thermal_agent/
    │   ├── handler.py
    │   ├── zone_model.py
    │   ├── rc.py
    │   ├── mpc.py
    │   ├── calibrate.py
    │   ├── anomaly.py
    │   ├── weather.py
    │   └── carbon.py
    │
    ├── diagnostic_agent/
    │   ├── diagnose.py
    │   ├── input_contract.py
    │   ├── graph.py
    │   ├── tools.py
    │   ├── contract.py
    │   ├── supervisor.py
    │   ├── checkpointer.py
    │   └── api.py            # :8002 — health, anomaly queries, diagnose
    └── logging_config.py     # shared rotating-file logger for all services

orchestration/                    # (top-level, not an agent — coordinator)
    ├── orchestrate.py            # run_full_cycle: calibration → loop → diagnose → alert
    ├── scheduler.py              # run_forever / run_n_cycles (15-min cadence)
    ├── channels.py               # alert dispatch: log file + optional webhook
    ├── db.py                     # incl. orchestration_runs audit table
    └── api.py                    # :8003 — health, undiagnosed anomalies, run-cycle, orchestration-runs

frontend/
tests/
scripts/
dev/
```

## Agent HTTP APIs

Each agent exposes its own FastAPI process. Run from the repo root with
`uvicorn <app> --app-dir src --port <port>`:

| App     | Port | App                                       | Key endpoints                                                     |
| ------- | ---- | ----------------------------------------- | ----------------------------------------------------------------- |
| Agent 1 | 8010 | `agents.building_agent.api:app`           | `GET /health`, building catalog + vision pipeline metadata        |
| Agent 2 | 8001 | `agents.thermal_agent.api:app`            | `GET /health`, rooms, models, MPC schedules, reports, anomalies   |
| Agent 3 | 8002 | `agents.diagnostic_agent.api:app`         | `GET /health`, `GET /anomalies/{id}`, `POST /anomalies/{id}/diagnose` |
| Orch.   | 8003 | `orchestration.api:app`                   | `GET /health`, `GET /buildings/{id}/undiagnosed-anomalies`, `GET /buildings/{id}/orchestration-runs`, `POST /buildings/{id}/run-cycle` |

The frontend (`frontend/.env.example`) points at Agent 2 (`:8001`) and Agent 1
(`:8010`); Agents 3 and 4 are called directly for live diagnosis and on-demand
cycle runs.

---

# Testing & Verification

Each agent has dedicated pytest coverage (`tests/`).

`scripts/` also has manual/operational tools, all run against the real Supabase
environment (no mocking):

| Script | Purpose |
| ------ | ------- |
| `simulate_live_sensors.py` | Generates sensor readings for every room in every building on a fixed interval; runs the anomaly pipeline synchronously right after each reading |
| `run_orchestration_loop.py` | Drives the full cycle (calibration → MPC fast loop → diagnosis → alerts) for every building on a fixed interval |
| `run_simulation.py` | Scripted end-to-end scenario ("window left open") for demonstrating the full pipeline |
| `demo_agent3.py` | Live, node-by-node walkthrough of Agent 3's investigation for a presentation |
| `verify_agent3.py` | Exit-code-driven verification that Agent 3's persistence (diagnosis, alerts, audit log) is correct |
| `create_user.py` | Creates a login user for the frontend (there is no self-serve signup) |

In production, `simulate_live_sensors.py` and `run_orchestration_loop.py` run as
scheduled GitHub Actions workflows (`.github/workflows/`) instead of perpetual
processes — see the Deployment section.

---

# Current Status

### Phase 0 — Functional Core

| Component                             | Status |
| -------------------------------------- | ------ |
| Agent 1 — Building extraction          | ✅ Done |
| Agent 2 — RC model                     | ✅ Done |
| Agent 2 — Calibration                  | ✅ Done |
| Agent 2 — MPC                          | ✅ Done |
| Agent 2 — Anomaly detection            | ✅ Done |
| Agent 3 — LLM cause classification     | ✅ Done |
| Agent 3 — Evidence computation         | ✅ Done |
| Agent 3 — Validation & fallback        | ✅ Done |
| Orchestrator — Cycle + alert dispatch  | ✅ Done |
| Frontend — connected to live APIs      | ✅ Done |
| Deployment (Vercel + Render + GitHub Actions) | ✅ Done |

### Next phases

**Phase 1**

* ESP32 sensors (real hardware, replacing the sensor simulator)
* improved wall geometry

**Phase 2**

* 2R2C multi-zone modeling
* autonomous actions
* advanced simulation

---

# Roadmap

```text
Phase 0 — done
Functional multi-agent core, deployed (Vercel + Render + GitHub Actions)
        ↓
Phase 1
Real ESP32 sensors + improved wall geometry
        ↓
Phase 2
Multi-zone modeling + autonomous HVAC actions
        ↓
Future
Scalable predictive HVAC intelligence
```

---

# Key Design Principles

### 1. LLM reasoning ≠ critical control

The LLM is used where reasoning and evidence exploration are valuable.

Deterministic algorithms handle physical modeling, optimization, anomaly detection, and final decisions.

### 2. Every decision should be auditable

Diagnostic traces, tool calls, model outputs, and supervisor decisions are persisted.

### 3. Physics remains interpretable

Thermal predictions and HVAC optimization rely on explicit mathematical models rather than black-box reasoning.

### 4. Agents remain decoupled

The shared database provides the communication layer, while Agent 4 coordinates the overall workflow.

---

# Key Takeaway

DynamIQ combines **physical modeling, predictive optimization, anomaly detection, and LLM-based reasoning** into a single multi-agent HVAC intelligence system.

Its core philosophy is simple:

> **Use AI where reasoning is useful. Use deterministic systems where safety, control, and auditability matter.**

---

# TL;DR

* **Agent 1** understands the building.
* **Agent 2** predicts, calibrates, optimizes, and detects anomalies.
* **Agent 3** investigates *why* anomalies happen.
* **Agent 4** coordinates the system and makes the final deterministic decision.
* **PostgreSQL** provides the shared communication and persistence layer.
* **LLMs never control critical decisions alone.**
