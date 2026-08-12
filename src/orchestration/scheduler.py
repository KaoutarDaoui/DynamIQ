from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Callable

import numpy as np
from sqlalchemy import Engine

from . import constants, orchestrate


def run_n_cycles(
    engine: Engine,
    building_id: str,
    occupied_provider: Callable[[], dict[str, np.ndarray]],
    n: int,
    offline: bool = False,
    sleep_between: bool = True,
    on_cycle: Callable[[orchestrate.OrchestrationCycleResult], None] | None = None,
) -> list[orchestrate.OrchestrationCycleResult]:
    interval_s = constants.FAST_LOOP_INTERVAL_MINUTES * 60
    results = []
    for i in range(n):
        now = datetime.now(timezone.utc)
        result = orchestrate.run_full_cycle(engine, building_id, occupied_provider(), now=now, offline=offline)
        results.append(result)
        if on_cycle is not None:
            on_cycle(result)
        if sleep_between and i < n - 1:
            time.sleep(interval_s)
    return results


def run_forever(
    engine: Engine,
    building_id: str,
    occupied_provider: Callable[[], dict[str, np.ndarray]],
    offline: bool = False,
    on_cycle: Callable[[orchestrate.OrchestrationCycleResult], None] | None = None,
) -> None:
    interval_s = constants.FAST_LOOP_INTERVAL_MINUTES * 60
    while True:
        now = datetime.now(timezone.utc)
        result = orchestrate.run_full_cycle(engine, building_id, occupied_provider(), now=now, offline=offline)
        if on_cycle is not None:
            on_cycle(result)
        time.sleep(interval_s)
