# dev/ — local test data, do not depend on this from src/

**Schema is now managed directly in Supabase**, not from this repo — the
DDL that used to live here (`ddl.sql`, `sensor_readings_ddl.sql`,
`agent2_tables.sql`) has been removed. `DATABASE_URL` should point at the
real Supabase Postgres instance (see `.env.example`); this directory no
longer creates any tables.

What's left is only useful against a database that already has the
schema (real Supabase, or a throwaway local Postgres you've applied a
matching schema to yourself): `seed.py` (3 ESI Algiers classrooms),
`seed_sensor_readings.py` (synthetic sensor history), and
`inspect_zone_models.py` / `webapp.py` for poking at the results. Nothing
under `src/` may import from `dev/`; the reverse (dev/ scripts importing
`src/thermal_agent`) is expected and fine.

**Be careful running the seed scripts against real Supabase data** —
`seed.py` and `seed_sensor_readings.py` insert/delete rows for the
specific `room_id`s they hardcode (`room-a101`, `room-b205`, `room-c301`)
and will collide with real rows using those same ids. Point `DATABASE_URL`
at a scratch/staging project, not production, before running them.

`docker-compose.yml` / `.env.dev` still spin up a throwaway local
Postgres if you want one, but you'd need to apply a schema to it
yourself first (there's no DDL here anymore to do that for you).

## Usage (against a database that already has the schema)

```bash
python dev/seed.py
python dev/seed_sensor_readings.py room-a101 21
python dev/inspect_zone_models.py
```

## Seed data

Three rooms, one per floor, chosen to exercise different parts of the
§5 formula:

| room_id    | floor        | orientation | exterior walls | thermal_mass |
|------------|---------------|-------------|-----------------|---------------|
| room-a101  | ground (L1)   | south       | south, west (corner room) | heavy |
| room-b205  | middle (L2)   | north       | north only                | heavy |
| room-c301  | top (L3)      | west        | west only + roof           | heavy |

`buildings.total_floors = 3`, so `floors.level == total_floors` (i.e.
`level == 3`) is what makes `room-c301` top-floor per zone_model.is_top_floor.

`room-c301` is deliberately *not* tuned to pass the §5 sanity gate — see
the note in `inspect_zone_models.py`'s output.
