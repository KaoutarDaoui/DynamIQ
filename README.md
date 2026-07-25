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

## Notes on scope

- **LLM provider**: the brief specifies Amazon Bedrock (Claude) for the
  Supervisor and Diagnostic agents. Locally, `diagnostic_agent.py` is
  designed to call the Anthropic API directly (`ANTHROPIC_API_KEY`) —
  same model family, no AWS wiring. Swap in a Bedrock client at
  deployment time without changing the agent's interface.
- **Storage**: no database. The Supervisor keeps an in-memory
  `audit_log`; persistence (RDS in the brief) is a deployment concern
  and out of scope here.
- **Data**: `data/simulator.py` is meant to generate synthetic sensor
  histories (per the Phase 0 roadmap in the brief) so the RC model, MPC,
  and Diagnostic agent can be built and demoed before real ESP32 sensors
  are installed.
