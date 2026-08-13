from __future__ import annotations

"""Simulate an hvac_underperformance anomaly for djezzy-hq-floor-1-room-01.

Uses the 8 most recent 15-min readings ending NOW (so the LLM's now-relative
tool windows contain them) and rewrites them so temperature ramps
27.0 -> 32.0 degC while the HVAC stays ON (-3500 W). Inserts a
thermal_anomaly over the same [start, end] UTC window with residual 2.5.

Usage:
    python dev/scenario_hvac_underperformance.py [room_id]
"""

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from sqlalchemy import text

from agents.thermal_agent.db import get_engine

ROOM = "djezzy-hq-floor-1-room-01"
T0, T1 = 27.0, 32.0
HVAC_W = -3500.0


def main() -> None:
    room_id = sys.argv[1] if len(sys.argv) > 1 else ROOM
    engine = get_engine()
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=2)

    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT ts, temp_measured_c, q_hvac_w, q_occ_w FROM sensor_readings "
                "WHERE room_id=:room AND ts >= :start AND ts <= :end ORDER BY ts"
            ),
            {"room": room_id, "start": start, "end": now},
        ).fetchall()
        if len(rows) < 4:
            print(f"expected >=4 readings in last 2h window, found {len(rows)}; aborting")
            sys.exit(1)
        n = len(rows)
        for i, (ts, _old_temp, q_hvac, q_occ) in enumerate(rows):
            frac = i / (n - 1)
            temp = round(T0 + (T1 - T0) * frac, 2)
            conn.execute(
                text(
                    "UPDATE sensor_readings SET temp_measured_c=:t, q_hvac_w=:h "
                    "WHERE room_id=:room AND ts=:ts"
                ),
                {"t": temp, "h": HVAC_W, "room": room_id, "ts": ts},
            )
            print(
                f"  {ts.isoformat()}  temp -> {temp:.2f}  hvac -> {HVAC_W:.0f}W "
                f"(occ kept {q_occ})"
            )
        window_end = rows[-1][0]

    from agents.thermal_agent.db import insert_anomaly

    anomaly_id = insert_anomaly(
        engine,
        room_id,
        "thermal_anomaly",
        start,
        window_end,
        2.5,
        None,
        1.17857021192084,
        1,
    )
    print(f"inserted anomaly id={anomaly_id}  {start.isoformat()} -> {window_end.isoformat()}")


if __name__ == "__main__":
    main()