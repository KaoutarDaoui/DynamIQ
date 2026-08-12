# DynamIQ frontend

React + TypeScript + Vite + Tailwind v4 scaffold for the full DynamIQ page set.

## Run it

```bash
npm install
npm run dev
```

## Pages

- `/login` — sign in
- `/` — portfolio (multi-building)
- `/onboarding` — 5-step new building wizard (floors → plans → rooms/AC → agent analysis → save)
- `/help` — help center
- `/b/:buildingId` — dashboard
- `/b/:buildingId/floors/:floorId` — floor view (room grid, deviation-colored)
- `/b/:buildingId/rooms/:roomId` — room detail (RC params, MPC chart, envelope)
- `/b/:buildingId/registry` — AC registry table
- `/b/:buildingId/anomalies` — anomalies feed
- `/b/:buildingId/anomalies/:anomalyId` — diagnosis detail (Agent 3 evidence + Agent 4 decision)
- `/b/:buildingId/alerts` — alert inbox
- `/b/:buildingId/reports` — energy/carbon reports + efficiency leaderboard
- `/b/:buildingId/audit` — audit log
- `/b/:buildingId/settings` — users & roles, building, integrations, calibration

## Data

Most pages are mocked in `src/data/mock.ts`, typed in `src/types.ts` — matches the
Agent 1-4 schema (rooms/config_json, rc_model_params, anomalies, diagnoses, alerts,
audit_log) so it's a straight swap to real Supabase calls later. Roles supported:
admin, facility_manager, technician, viewer.

**`/b/:buildingId/thermal`, `/b/:buildingId/mpc`, `/b/:buildingId/anomalies`,
`/b/:buildingId/anomalies/:anomalyId`, `/b/:buildingId/diagnoses`,
`/b/:buildingId/alerts` and `/b/:buildingId/reports` are live**, not mocked.
All seven call the Thermal Agent's own read API
(`src/agents/thermal_agent/api.py`) via `src/lib/api.ts`:

- Thermal page: `GET /buildings/{id}/thermal-models` — real `rc_model_params`
  per room (R/C, validation RMSE, calibration version and timestamp).
- MPC page: `GET /buildings/{id}/mpc-rooms` (room picker) + `GET
  /buildings/{id}/rooms/{room_id}/mpc-schedule` — the most recently solved
  24h `mpc_schedules` trajectory for the selected room, with "actual" room
  temperature left null for any slot still in the future (no fabricated
  comparison), and a flat tariff badge instead of a fake per-hour price line
  (the real MPC objective in `mpc.py` uses one constant currency rate, not a
  time-varying one — there's nothing to chart there).
- Anomalies list + detail: `GET /buildings/{id}/anomalies` and `GET
  /buildings/{id}/anomalies/{anomaly_id}` — real `anomalies` rows (residual vs.
  threshold, not a fabricated predicted/measured pair the schema doesn't
  store) LEFT JOINed against `diagnoses` when Agent 3 has run. `severity` and
  `status` are derived server-side from real fields (residual/threshold
  ratio; `closed_at`/`diagnosed`) — there's no persisted "diagnosing"
  in-progress state in this architecture (diagnosis is synchronous), so that
  mock status was dropped rather than faked.
- Diagnoses page (previously a "Coming soon" placeholder, built fresh, not a
  mock swap): `GET /buildings/{id}/diagnoses` — every diagnosis Agent 3 has
  ever produced for the building, filterable by confidence/decision, sortable
  by energy wasted. Each row links into the same anomaly detail page above
  rather than duplicating a detail view.
- Alerts page: `GET /buildings/{id}/alerts` — real `alerts` rows (only ever
  written when the safety gate's `decide()` in `diagnostic_agent/supervisor.py`
  returns `human_alert`). No `acknowledged` column exists in the real schema, so that
  mock toggle/button was dropped rather than faked. As of this integration
  every diagnosis produced so far has resolved `autonomous`, so the page
  correctly renders an empty state — that's real system behavior, not a bug.
- Reports page: `GET /buildings/{id}/reports/summary` — daily predicted
  kWh/gCO2 totals aggregated from real `mpc_schedules` rows, a predicted-cost
  figure (kWh × the flat tariff), and a "comfort tracking" leaderboard
  (deviation of each instrumented room's latest real reading from the
  comfort-band midpoint). The mock's "energy saved / CO2 avoided vs baseline"
  framing was dropped entirely, not approximated — there is no reactive
  baseline stored anywhere in this system to compare against, so reporting a
  "savings" number would mean inventing one. The mock's "efficiency
  leaderboard" (rooms closest to a `targetTempC` that doesn't exist in the
  real schema) became the comfort-band-deviation leaderboard instead. "Export
  PDF" is real: `src/lib/pdf.ts` uses `jspdf` (client-side, no backend
  endpoint) to render the same real summary/daily/leaderboard data the page
  shows into an actual downloadable PDF — not a stub button. One thing worth
  knowing if you touch that file: jsPDF's default font can't render the `₂`
  subscript (renders as garbled characters), so labels use plain `gCO2`
  there even though the page itself shows `gCO₂`.

Run the API alongside the frontend:

```bash
# from the repo root, with .venv active
uvicorn agents.thermal_agent.api:app --app-dir src --port 8001
```

`VITE_THERMAL_API_URL` (see `.env.example`) points both pages at it; defaults
to `http://localhost:8001`. Two buildings have real data in Supabase —
`esi-algiers` (real id `1`) and `djezzy-hq` (same id both places, see
`scripts/seed_djezzy_building.py`) — `src/lib/api.ts` maps the former, the
latter needs no mapping. Every other building in the Portfolio page is still a
mock and these two pages will show empty/404 states for them.