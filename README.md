# DynamIQ

**HVAC prédictive pour bâtiments sans BMS.**

Au lieu de réagir après qu'une pièce surchauffe, DynamIQ **prédit** (physique +
météo), **planifie** le refroidissement optimal 24 h à l'avance, et **agit**
préventivement.

**Cible : ESI Alger** — bâtiment sans système de gestion centralisé, climatiseurs
split unitaires indépendants.

---

## Architecture Globale

```
      ┌────────────────────── AGENT 4 · SUPERVISOR ──────────────────────┐
      │  Orchestrateur — boucle toutes les 15 min                       │
      │  Seul paquet autorisé à importer les 3 autres agents            │
      │  Gate déterministe : autonomous / human_alert / log_only        │
      └──────────────┬──────────────────┬──────────────────┬────────────┘
                     │                  │                  │
                     ▼                  ▼                  ▼
      ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
      │ AGENT 1      │    │ AGENT 2      │    │ AGENT 3      │
      │ Building     │    │ Thermal      │    │ Diagnostic   │
      │ Plan → R/C   │    │ RC+MPC+Anom. │    │ LLM, 7 outils │
      └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
             │                   │                   │
             └───────────────────┼───────────────────┘
                                 ▼
      ┌──────────────── BDD POSTGRES PARTAGÉE (Supabase) ───────────────┐
      │ rooms · sensor_readings · rc_model_params · anomalies         │
      │ mpc_schedules · diagnoses · audit_log · alerts · …            │
      └────────────────────────────────┬──────────────────────────────┘
                                       ▼
      ┌──────────────────────────────────────────────────────────┐
      │ ALERTES — dispatch par Agent 4 (log local + webhook)     │
      └──────────────────────────────────────────────────────────┘
```

**Règle d'or :** les Agents 1, 2 et 3 ne s'importent jamais mutuellement — ils
communiquent uniquement via les tables Postgres partagées. **Agent 4 est le seul
coordinateur** (il est le seul autorisé à faire `import` des trois autres).

---

## Les 4 Agents

### Agent 1 — Building (`src/agents/building_agent/`)

**Rôle :** transformer un plan d'étage (PDF/JPEG/PNG/WEBP/GIF) en données
thermiques structurées et persistées.

**Aujourd'hui (fonctionne)**
1. `vision_processor.py` : détection du type de fichier (magic bytes), conversion
   image en JPEG 512 px (budget tokens Groq), **Groq Vision** `qwen/qwen3.6-27b`
   → JSON array de pièces (`room_label`, `bbox`, `area_m2`, `external_walls`,
   `has_windows`, `room_type`, `primary_orientation`).
2. `geometry_processor.py` : `auto_number_and_map_rooms` (numérotation
   `room-101`…), `compute_cardinal_orientations` (N/S/E/W via clic "nord").
3. `building_agent.py` : construction de `config_json` (envelope / thermal /
   hvac / adjacency) + persistance via `db_manager.py`.

**Écrit :** `buildings`, `floors`, `rooms`, `room_adjacencies`.

> ⚠️ **Évolution prévue — NON VALIDÉ** *(graphe LangGraph "extract / validate /
> correct")* :
> ```
> extract_initial (Groq Vision) → geometry_process → sanity_gate
>   ├─ confident ───────────────► persist
>   ├─ faible confiance + budget ► decide_action → run_tool → loop
>   │        (zoom_room · detect_scale · check_adjacency · recount_rooms)
>   └─ budget épuisé ─────────────► flag_for_review → persist
> ```
> Budget cible : max 3 itérations, 2 appels Groq Vision / itération.

  thermal_agent/              Agent 2 — physics brain (deterministic, no LLM)
    __init__.py
    handler.py                Fast-loop entry: fetch → build model → MPC → persist → anomalies
    db.py                     Raw-SQL access to buildings/floors/rooms/adjacencies/readings
    zone_model.py             Lumped RC zone model (envelope → R/C/UA, sanity gate)
    rc.py                     1st-order RC physics: fit_rc / simulate / one-step-ahead
    mpc.py                    cvxpy 24h setpoint optimizer (energy + carbon)
    calibrate.py              RC calibration sweep against sensor history
    anomaly.py                anomaly pipeline: sensor validity, comfort, thermal, drift
    weather.py                Open-Meteo (+pvlib) temp/GHI forecast; solar_gain_w()
    carbon.py                 ElectricityMaps grid carbon-intensity forecast
    constants.py              thermal/energy constants, tariffs, thresholds
    api.py                    Read-only FastAPI app for the frontend's Thermal, MPC,
                               Anomalies, Diagnoses, Alerts and Reports pages (own port, not
                               the fast loop)

  diagnostic_agent/           Agent 3 — WHY (Groq LLM, graphe LangGraph)
    __init__.py
    graph.py                  LangGraph: build_contract → llm_reason → tool_executor → validate
    diagnose.py               diagnose_anomaly(): runs the graph, gate + persistence
    input_contract.py         build_input_contract() / classify_anomaly_type()
    checkpointer.py           Checkpoint persistant sqlite (crash-reprise)
    tools.py                  TOOL_REGISTRY: 7 read-only tools + schemas
    contract.py               Pydantic DiagnosisContract + fallback déterministe
    supervisor.py             Gate déterministe: autonomous/human_alert/log_only
    db.py                     Raw-SQL reads (anomalies, readings, schedules) + writes diagnoses
    constants.py              Groq config, tool budget, defaults

  supervisor/                 Agent 4 — orchestration (the coordinator)
    __init__.py
    orchestrate.py            run_full_cycle(): fast loop + calibration-if-due + diagnosis
    scheduler.py              run_forever()/run_n_cycles() timed driver
    channels.py               AlertChannel: LogChannel / WebhookChannel / dispatch
    db.py                     poll undiagnosed anomalies, last-calibration time
    constants.py              loop intervals, alert log path, webhook timeout
```

Supporting files:

```
dev/                            throwaway test data (seed scripts + local Postgres compose)
scripts/run_simulation.py       end-to-end demo run of all 4 agents against real Supabase,
                                 traced to scripts/simulation_runs/*.json
scripts/seed_djezzy_building.py one-time seed of the Djezzy HQ Annex demo building (18 rooms,
                                 3 floors, 3 instrumented + really calibrated) into real Supabase
scripts/demo_agent3.py          démo live Agent 3 (streaming nœuds + gate + persistance)
scripts/verify_agent3.py        vérif e2e Agent 3 (reset + run + persistance)
tests/                          pytest suites, one package per agent
pyproject.toml / requirements.txt / .env.example
```

Every module in the four `src/agents/` packages is a real implementation with
tests; the legacy `src/dynamiq/` scaffolding has been removed.

---

### Agent 2 — Thermal (`src/agents/thermal_agent/`)

**Rôle :** cerveau physique — prédire, calibrer, optimiser, détecter. **Python
pur, zéro LLM** (100 % déterministe et auditable).

**Boucle (toutes les 15 min) par pièce instrumentée :**
1. **Observe** : capteurs, météo (Open-Meteo, cache 1 h, fallback offline pvlib),
   occupation, prix, carbone (ElectricityMaps, fallback offline).
2. **Prédit** : modèle RC 1er ordre, DT = 900 s.
3. **Optimise** : MPC (cvxpy/ECOS) sur 24 h — minimiser coût + λ·carbone,
   contraintes confort + puissance AC → écrit `mpc_schedules`.
4. **Détecte** (3 stages) :
   - `sensor_fault` : pas de lecture / figé ≥ 2 h / hors [5, 45] °C
   - `comfort_violation` : occupé et T hors [20, 26 °C]
   - `thermal_anomaly` : `|T_mesuré − T_prédit| > max(3·RMSE, 1.0 °C)` sur 4
     échantillons consécutifs.
5. **Calibre** (toutes les 24 h si due) : fit R/C (scipy `least_squares`),
   fenêtre 21 j, split 70/30 — **accepté uniquement si le RMSE de validation
   baisse**. Dérive → total `rc_model_params` versionnée.

### Les deux prédictions d'Agent 2 (ne pas confondre)

| | Prédiction One-Step (15 min) | Prédiction MPC (24 h) |
|---|---|---|
| **Question** | « Dans 15 min, quelle température ? » | « Sur 24 h, quels setpoints optimaux ? » |
| **Méthode** | Modèle RC 1er ordre (équation discrète, DT = 900 s) | Optimisation cvxpy/ECOS (96 pas de 15 min) |
| **But** | Détecter si le modèle diverge de la réalité | Minimiser coût énergie + carbone |
| **Comparaison** | Avec le capteur réel à t+15 min | Aucune — c'est un plan futur |
| **Si échec** | `thermal_anomaly` → réveille Agent 3 | Recalcule au prochain cycle |
| **Écrit dans** | `sensor_readings` (lecture) | `mpc_schedules` (96 lignes) |

**En clair :** le modèle RC prédit toutes les 15 min pour **vérifier sa propre
santé** ; le MPC prédit 24 h pour **planifier l'avenir**. Ce sont deux calculs
indépendants qui tournent au même cycle.

**Lit :** `rooms`, `floors`, `buildings`, `room_adjacencies`, `rc_model_params`,
`sensor_readings`.
**Écrit :** `rc_model_params`, `mpc_schedules`, `anomalies`.

> ⚠️ **Lookahead 2 h / 3 stratégies MP + Pareto (`select_by_pareto`) — NON
> VALIDÉ** : le CPU (solve) est aujourd'hui un solve simple.

**Constantes :** fast loop 15 min · calibration 24 h · DT 900 s · seuil `max(3·
RMSE, 1.0 °C)` sur 4 échantillons · fermeture 0,5 × seuil · confort [20, 26] /
[16, 30 °C] · tarif 4,67 (unité normale) · λ carbone 8.0 · fenêtre de
calibration 21 j (min 288 échantillons) · drift 0,5·RMSE sur 7 j.

---

### Agent 3 — Diagnostic (`src/agents/diagnostic_agent/`)

**Rôle :** répondre au POURQUOI d'une anomalie et proposer UNE action.
Événementiel — déclenché uniquement par une `thermal_anomaly` non diagnostiquée
(`diagnosed = false`).

**Aujourd'hui (fonctionne) — graphe LangGraph (`graph.py`) :**
1. `build_input_contract` (`input_contract.py`) : type (`overheating`/`overcooling`/`oscillation`/
   `no_response`), residual, threshold, durée, état HVAC.
2. Graphe LangGraph à 6 nœuds :
   ```
   build_contract → llm_reason → tool_executor (loop, ≤ 8 appels)
     → validate_output → (JSON valide → END | JSON invalide → json_repair → llm_reason)
     → budget épuisé / LLM déraillé → fallback_node
   ```
   - `llm_reason` (Groq `llama-3.3-70b-versatile`, overridable via `GROQ_DIAGNOSTIC_MODEL`) raisonne et choisit entre 7 outils ou
     un verdict final (JSON strict `{"tool": ...}` vs `{"cause": ...}`).
   - `tool_executor` exécute l'outil, décrémente `budget_remaining`, enrichit
     `evidence_gathered` (7 outils en lecture seule) :
     | Outil | Lit |
     |---|---|
     | `get_sensor_history` | `sensor_readings` |
     | `get_calendar` | occupation **déduite** de `sensor_readings.q_occ_w` (pas de table `occupancy_schedules`) |
     | `get_mpc_trajectory` | `mpc_schedules` (dernier solve) |
     | `get_hvac_logs` | état dérivé de `sensor_readings.q_hvac_w` (pas de table `hvac_events`) |
     | `get_similar_anomalies` | `anomalies` + `diagnoses` |
     | `get_building_context` | `rooms` + `buildings` (+ modèle RC actif) |
     | `check_neighboring_zones` | `room_adjacencies` + `sensor_readings` |
     Règles : `get_sensor_history` + `get_calendar` obligatoires avant conclusion.
   - `validate_output` : validation **JSON strict via Pydantic `DiagnosisContract`**
     (`contract.py`) + `json_repair` (2 tentatives) +
     **fallback déterministe** (`inspection_required` si cause indéterminée).
   - Le state (TypedDict) est checkpointé après chaque nœud (`node_trace`,
     `tool_calls_made`, `budget_remaining`, …) → traçabilité et reprise en cas de crash.
   - **Checkpoint persistant** (`checkpointer.py`) : SqliteSaver dans
     `data/agent3_checkpoints.sqlite` (overridable via `DIAGNOSTIC_CHECKPOINT_DB`).
     En cas de crash, `diagnose_anomaly` reprend automatiquement le thread
     (`anomaly-<id>`) au nœud interrompu — les nœuds déjà terminés ne sont pas rejoués
     (`run_investigation` vérifie `get_state().next`).
3. `supervisor.py` (gate, appelée par Agent 4 via orchestrate, **hors LangGraph**) :
   `delta_c` hors bornes / action à risque / `inspection_required` →
   `human_alert` ; même cause + pièce < 30 j → `log_only` ; sinon `autonomous`.
4. Persiste `diagnoses` + `audit_log` (trace complète : `node_trace`, `timestamps`)
   et `alerts` si `human_alert`.

**Écrit :** `diagnoses`, `alerts`, `audit_log`.

---

### Agent 4 — Supervisor (`src/agents/supervisor/`)

**Rôle :** orchestrateur + seule décision finale. **Gate déterministe = argument
légal : "le LLM ne décide jamais seul."**

**Cycle (`orchestrate.py · run_full_cycle`) :**
1. Calibration (si due, 24 h) · 2) Fast loop Agent 2 (chaque pièce · 15 min) ·
3. Diagnostic Agent 3 (anomalies `diagnosed=false`) · 4. Gate → `autonomous /
human_alert / log_only` · 5. Dispatch si `human_alert` (`channels.py` :
`LogChannel` → `logs/alerts.jsonl`, + Webhook).
Scheduler : `scheduler.py` (`run_n_cycles` / `run_forever`).

**Écrit :** `alerts` (via dispatch), marquage `anomalies.diagnosed = true`.

---

## Base de données (Supabase Postgres) — 13 tables

| Table | Colonnes |
|---|---|
| `organisations` | `org_id` PK, `name`, `email`, `country_code`, `plan`, `created_at` |
| `buildings` | `building_id` PK, `name`, `address`, `latitude`, `longitude`, `total_floors`, `country_code`, `org_id`, `created_at` |
| `floors` | `floor_id` PK, `building_id`, `level`, `name`, `floor_plan_url`, `created_at` |
| `rooms` | `room_id` PK, `floor_id`, `building_id`, `room_label`, `room_type`, `area_m2`, `volume_m3`, `primary_orientation`, `r_wall`, `c_zone`, `sensor_id`, `config_json` (JSONB), `created_at` |
| `air_conditioners` | `ac_id` PK, `room_id`, `manufacturer`, `model`, `serial_number`, `cooling_capacity_kw`, `heating_capacity_kw`, `power_kw`, `installation_date`, `status`, `pos_x`, `pos_y`, `created_at` |
| `room_adjacencies` | PK `(room_id, adjacent_room_id)`, `direction`, `wall_type` |
| `sensor_readings` | `id` PK, `room_id`, `ts` (= 15 min), `temp_measured_c`, `temp_ext_c`, `q_solar_w`, `q_occ_w`, `q_hvac_w` · `UNIQUE(room_id, ts)` |
| `rc_model_params` | `id` PK, `room_id`, `version`, `r_lumped`, `c_lumped`, `rmse_validation`, `anomaly_threshold_c`, `data_window_start`, `data_window_end`, `is_active`, `created_at` · `UNIQUE(room_id, version)` |
| `mpc_schedules` | `id` PK, `room_id`, `solved_at`, `slot_ts`, `setpoint_c`, `predicted_temp_c`, `predicted_kwh`, `predicted_gco2`, `model_version` · `UNIQUE(room_id, solved_at, slot_ts)` |
| `anomalies` | `id` PK, `room_id`, `anomaly_type` (`thermal_anomaly` / `sensor_fault` / `comfort_violation`), `opened_at`, `closed_at`, `residual_c`, `residual_trace` JSONB, `threshold_c`, `model_version`, `diagnosed` |
| `diagnoses` | `id` PK, `anomaly_id`, `room_id`, `cause`, `cause_confidence`, `evidence` JSONB, `energy_wasted_kwh`, `energy_wasted_basis`, `proposed_action` JSONB, `recurrence` JSONB, `message`, `supervisor_decision`, `created_at` |
| `alerts` | `id` PK, `diagnosis_id`, `room_id`, `channel`, `recipient`, `payload` JSONB, `sent_at` |
| `audit_log` | `id` PK, `anomaly_id`, `room_id`, `invoked_at`, `tool_calls` JSONB, `model_output` JSONB, `supervisor_decision` JSONB, `diagnosis_id`, `created_at` |

> Les FKs HTTP concernent : `buildings.org_id → organisations`,
> `floors.building_id → buildings`, `rooms.floor_id → floors`,
> `air_conditioners.room_id → rooms`, `room_adjacencies.room_id → rooms`.

---

## Index appliqués sur la base (juin 2026)

```sql
CREATE INDEX idx_mpc_room_solved    ON mpc_schedules(room_id, solved_at DESC);
CREATE INDEX idx_anom_undiagnosed   ON anomalies(anomaly_type, opened_at DESC) WHERE diagnosed = false;
CREATE INDEX idx_anom_open          ON anomalies(room_id, anomaly_type, opened_at DESC) WHERE closed_at IS NULL;
CREATE INDEX idx_anom_room_time     ON anomalies(room_id, opened_at DESC);
CREATE INDEX idx_diag_cooldown      ON diagnoses(room_id, cause, created_at DESC);
CREATE INDEX idx_rooms_floor        ON rooms(floor_id);
CREATE INDEX idx_floors_building    ON floors(building_id);
```

Déjà couverts (pas d'index supplémentaires) : `sensor_readings(room_id, ts)` via
`UNIQUE(room_id, ts)` ; `room_adjacencies(room_id)` via PK composite ;
`rc_model_params` (table petite).

---

## Stack technique

| Couche | Technologie | Rôle |
|---|---|---|
| Backend | Python ≥ 3.10 | Agents |
| ORM/DB | SQLModel / SQLAlchemy + psycopg2 | Postgres Supabase |
| Physique | numpy / scipy | RC, `least_squares` |
| Optmique | cvxpy + ECOS | MPC 24 h |
| Solaire | pvlib | position soleil, irradiance POA |
| Météo | Open-Meteo | prévision temp/rayonnement (cache 1 h) |
| Carbone | ElectricityMaps | intensité carbone (fallback offline) |
| Vision | Groq (`qwen/qwen3.6-27b`) | Agent 1 |
| Diagnostic | Groq + **LangGraph** | Agent 3 |
| Orchestration | Python pur (LangGraph : *prévu* Agent 1 — non validé) | Agent 4 |
| API | FastAPI | points d'entrée (`building_agent/api.py`) |
| Frontend | React 19 · Vite 8 · TypeScript · Tailwind 4 · Recharts | dashboard, heatmap… |
| Tests | pytest | par agent |
| Hébergement | Supabase Postgres | production |

---

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -e ".[dev]"
cp .env.example .env              # remplir (voir `.env`)
pytest
```

`.env` (racine, gitignored) : `DATABASE_URL`, `GROQ_API_KEY`,
`DIAGNOSTIC_GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_KEY` (optionnel : `ELECTRICITYMAPS_API_KEY`,
`SUPERVISOR_ALERT_WEBHOOK_URL`).

API : `uvicorn src.agents.building_agent.api:app --reload`.
Supervisor (boucle infinie) : lancer `run_n_cycles`/`run_forever` depuis
`supervisor/scheduler.py` (pas de CLI `python -m` encore).

> ⚠️ `dev/seed.py` n'est pas compatible avec le schéma Supabase actuel
> (contraintes NOT NULL) — à adapter avant usage en dev.

---

## Phase actuelle (Phase 0)

**Fonctionne (vérifié de bout en bout sur vraie Supabase)** :

| Brique | Statut |
|---|---|
| Agent 1 : plan → pièces + R/C + orientation + enveloppe | ✅ |
| Agent 2 : RC model · calibration · MPC 24 h · détection anomalie | ✅ |
| Agent 3 : anomalie réelle diagnostiquée via Groq, contrat validé, routée | ✅ |
| Agent 4 : `run_full_cycle()` (fast loop + calibration + diagnostic + dispatch) | ✅ |
| Frontend : dashboard, heatmap, anomalies, pages Thermal & MPC | ✅ (mock) |

**Limites / à venir** : capteurs ESP32 (Phase 1) · géométrie murs en cours (Phase
1) · frontend branché à l'API (Phase 1) · déploiement AWS/hébergé (Phase 1) ·
2R2C multi-zone (Phase 2) · actions autonomes (Phase 2) · `run_simulation.py`
Évalué Phase 2.

---

## Repo layout

```
src/agents/
├── building_agent/      Agent 1 — plan → structure
│   ├── vision_processor.py  Groq Vision (PDF/IMG)
│   ├── geometry_processor.py orientation + numérotation
│   ├── schema_models.py     modèles SQLModel + config_json
│   ├── db_manager.py        CRUD
│   └── api.py               FastAPI (POST /buildings, /floors/{level}/upload)
├── thermal_agent/        Agent 2 — physique (no LLM)
│   ├── handler.py  db.py  zone_model.py  rc.py  mpc.py
│   ├── calibrate.py anomaly.py weather.py carbon.py constants.py
├── diagnostic_agent/    Agent 3 — POURQUOI (Groq, graphe LangGraph)
│   ├── diagnose.py  input_contract.py  graph.py (LangGraph : 6 nœuds)
│   ├── tools.py (TOOL_REGISTRY, 7 outils RO)  contract.py (Pydantic DiagnosisContract)
│   ├── supervisor.py (gate déterministe, appelée par Agent 4)  db.py  constants.py
│   └── checkpointer.py (checkpoint persistant sqlite, crash-reprise)
└── supervisor/          Agent 4 — orchestration
    ├── orchestrate.py  scheduler.py  channels.py  db.py  constants.py

frontend/               React 19 + Vite + TS + Tailwind (mock)
dev/                    seed.py · seed_sensor_readings.py · webapp.py
tests/                  pytest par agent
scripts/run_simulation.py   stub (Phase 2)
scripts/demo_agent3.py      démo live Agent 3 (streaming nœuds + gate + persistance)
scripts/verify_agent3.py    vérif e2e Agent 3 (reset + run + persistance)
```

> `src/dynamiq/` a été **supprimé** (ancien scaffolding mort).

---

## Argumentaire clé (pour le jury)

« Notre architecture distingue le **raisonnement incertain** (LLM) du **contrôle
critique** (calcul déterministe). »

1. L'Agent 3 explore, l'Agent 4 décide avec des **règles fixes** — gate de 15
   lignes, triviable à auditer. Le LLM ne décide jamais seul.
2. Le cerveau physique reste auditable : des solutions mathématiques (cvxpy +
   argmin), pas des intuitions.
3. LangGraph (en cours) sera utilisé avec parcimonie — pour les boucles où le
   LLM raisonne et choisit (Agents 1 & 3) — jamais pour du calcul numérique pur.

---

## TL;DR
- **Agent 1** décrit le bâtiment (géométrie + enveloppe).
- **Agent 2** prédit, calibre, optimise 24 h et flague les anomalies (physique
  pure, auditable).
- **Agent 3** trouve *pourquoi* (Groq, 7 outils).
- **Agent 4** coordonne tout et rend la décision finale (gate déterministe).