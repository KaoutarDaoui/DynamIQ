"""End-to-end Phase 0 demo skeleton.

Intended flow once the stubs in dynamiq.models and dynamiq.agents are
implemented:

    1. Load examples/sample_building.json into a BuildingAgent.
    2. Generate synthetic sensor history for each zone (data.simulator).
    3. Calibrate the RC model per zone (ThermalAgent.calibrate_zone).
    4. Run one Supervisor cycle per zone (Supervisor.run_cycle) and
       print the resulting trajectory / anomalies / alerts.

Not implemented yet — this file is a placeholder for that wiring.
"""
from __future__ import annotations


def main() -> None:
    raise NotImplementedError


if __name__ == "__main__":
    main()
