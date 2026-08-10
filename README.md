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
                         │       AGENT 4 — SUPERVISOR          │
                         │                                     │
                         │  Orchestration + Deterministic Gate │
                         │                                     │
                         │ autonomous / human_alert / log_only│
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
      │               │          │ Anomaly       │          │               │
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

They communicate through the shared PostgreSQL database, while **Agent 4 is the only coordinator** responsible for orchestrating the complete workflow.

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

**Role:** Determine **why** a thermal anomaly occurred and propose one action.

Agent 3 is event-driven and is triggered when an undiagnosed thermal anomaly is detected.

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

The diagnostic agent uses **7 read-only tools** to gather evidence from:

* sensor history
* inferred occupancy
* MPC trajectories
* HVAC state
* similar anomalies
* building context
* neighboring zones

The output is validated using a Pydantic `DiagnosisContract`.

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

## Agent 4 — Supervisor

**Role:** Coordinate the agents and make the final decision.

The Supervisor runs the complete cycle:

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

### Critical design principle

> **The LLM never makes the final control decision by itself.**

The final gate is deterministic and based on explicit rules such as anomaly severity, risky actions, inspection requirements, and recurrence.

---

# Database

DynamIQ uses **Supabase PostgreSQL** as the shared persistence layer.

The database contains 13 main tables covering:

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
    │   └── checkpointer.py
    │
    └── supervisor/
        ├── orchestrate.py
        ├── scheduler.py
        ├── channels.py
        └── db.py

frontend/
tests/
scripts/
dev/
```

---

# Testing & Verification

Each agent has dedicated pytest coverage.

The project also includes scripts for:

* end-to-end simulation
* Agent 3 live demonstration
* Agent 3 verification
* database seeding
* sensor data generation

The current implementation has been tested against the real Supabase environment.

---

# Current Status

### Phase 0 — Functional Core

| Component                       | Status  |
| ------------------------------- | ------- |
| Agent 1 — Building extraction   |         |
| Agent 2 — RC model              |         |
| Agent 2 — Calibration           |         |
| Agent 2 — MPC                   |         |
| Agent 2 — Anomaly detection     |         |
| Agent 3 — LLM diagnosis         |         |
| Agent 3 — Validation & fallback |         |
| Agent 4 — Orchestration         |         |
| Agent 4 — Alert dispatch        |         |
| Frontend                        | Mock    |

### Next phases

**Phase 1**

* ESP32 sensors
* improved wall geometry
* frontend connected to API
* deployment

**Phase 2**

* 2R2C multi-zone modeling
* autonomous actions
* advanced simulation

---

# Roadmap

```text
Phase 0
Functional multi-agent core
        ↓
Phase 1
Real sensors + production API + deployment
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
