"""Synthetic sensor data generator — Phase 0, before real ESP32 sensors exist.

Lets the RC model, MPC, and Diagnostic agent be built and demoed end to
end on plausible data before Phase 1 field deployment.

TODO:
    - simulate_zone_readings(zone, days): generate a SensorReading series
      for one zone by forward-running the RC model under a synthetic
      weather + occupancy + HVAC schedule, with injected anomalies
      (e.g. a stale schedule after a timetable change) for the
      Diagnostic agent to detect.
"""
from __future__ import annotations

from dynamiq.data.schemas import SensorReading, Zone


def simulate_zone_readings(zone: Zone, days: int = 14) -> list[SensorReading]:
    """Generate a synthetic sensor reading history for one zone."""
    raise NotImplementedError
