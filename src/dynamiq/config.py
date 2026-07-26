"""Runtime configuration loaded from environment variables / .env."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY")
    electricitymaps_api_key: str | None = os.getenv("ELECTRICITYMAPS_API_KEY")
    electricitymaps_zone: str = os.getenv("ELECTRICITYMAPS_ZONE", "DZ")
    building_lat: float = float(os.getenv("BUILDING_LAT", "36.7538"))
    building_lon: float = float(os.getenv("BUILDING_LON", "3.0588"))

    # Control loop cadence, matches the brief's 15-minute MPC cycle
    mpc_interval_minutes: int = 15
    mpc_horizon_hours: int = 24

    # Comfort / decision thresholds used by the Supervisor
    comfort_bounds_delta_c: float = 2.0
    diagnostic_cooldown_days: int = 7


settings = Settings()
