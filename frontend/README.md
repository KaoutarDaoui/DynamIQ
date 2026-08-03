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

Everything is mocked in `src/data/mock.ts`, typed in `src/types.ts` — matches the
Agent 1-4 schema (rooms/config_json, rc_model_params, anomalies, diagnoses, alerts,
audit_log) so it's a straight swap to real Supabase calls later. Roles supported:
admin, facility_manager, technician, viewer.