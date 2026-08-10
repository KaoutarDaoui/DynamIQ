# Agent 1, Explained

This document is written so you can present Agent 1 (the Building Agent) to a
technical mentor without reading off a screen. It's based on the actual code
in `src/agents/building_agent/` as it exists right now, not on the original
design spec — several things changed between spec and implementation, and
those changes are explained as they come up.

## 1. What changed from the old version

The old version was a single function, `BuildingAgent.process_and_save_floor`,
that ran once, top to bottom, and trusted whatever Groq Vision returned on the
first try. The new version is a LangGraph state machine, `graph.py`, that can
notice a bad extraction and go back for another look before committing
anything.

| Old pipeline (one-shot) | New agentic loop | Why it changed |
|---|---|---|
| Call Groq Vision once, take the result as-is | `extract_initial` does the same call, but the result is now a starting point, not a final answer | A single vision call has no way to know if it got something wrong — blurry crops, ambiguous labels, and misjudged areas all looked identical to "correct" |
| Compute room IDs, cardinal walls, geometry deterministically | `geometry_process` does the same, plus infers which rooms touch each other (`_infer_bbox_adjacencies`) | Room-to-room adjacency didn't exist anywhere before — nothing upstream produces it, so it had to be built here to give the confidence check something concrete to verify |
| No confidence check — every detected room was trusted | `sanity_gate` scores each room against whichever checks apply (room count, adjacency consistency) and flags anything under 0.7 | Without a way to measure confidence, there was no way to tell "probably fine" from "probably wrong" apart from a human looking at every room by hand |
| N/A | `decide_action` asks an LLM which of 4 tools (zoom, scale, adjacency, recount) to run on a low-confidence room, and why | This is the actual "agent" part — a program decision that used to be "just persist it" is now a judgment call, made by a model, that can change based on what specifically looks wrong |
| N/A | `tool_zoom` / `tool_scale` / `tool_adjacency` / `tool_recount` make a second, narrower Groq Vision call targeted at the specific problem | A full re-extraction wastes tokens and doesn't necessarily fix the one thing that was wrong; a cropped, targeted question is cheaper and more likely to get a useful answer |
| Rooms that were clearly wrong still got saved silently | `flag_for_review` marks unresolved rooms `needs_review=true` before persisting — they're still saved, just flagged | Refusing to save an entire floor because 1 of 12 rooms is uncertain would be worse than saving 11 good rooms and clearly marking the 1 bad one |
| No record of what happened during processing | Every node writes to `run_log`; `persist` writes one row to `building_agent_runs` with the full trace | When a room turns out wrong later, there was previously no way to know whether the model got it wrong, or something in the code silently discarded a correct answer |

The short version: the old pipeline optimized for "get something into the
database fast." The new one optimizes for "know how much to trust what's in
the database," at the cost of being slower and using more Groq calls when
something looks off.

## 2. What makes it a real agent now

An agent, in the sense usually meant here, needs four things: it loops, it
makes a real choice that changes what happens next, it knows when to stop on
its own, and its internal state changes as a result of its own actions. Agent
1 has all four, and each one maps to a specific piece of code.

**Loop.** The graph has an actual cycle in it, not just a sequence. Look at
the edges at the bottom of `graph.py`:

```python
_graph_builder.add_edge("tool_zoom", "sanity_gate")
_graph_builder.add_edge("tool_scale", "sanity_gate")
_graph_builder.add_edge("tool_adjacency", "sanity_gate")
_graph_builder.add_edge("tool_recount", "sanity_gate")
```

Every tool routes back to `sanity_gate`, and `sanity_gate` can route to
`decide_action` again via its conditional edge. So the path
`sanity_gate → decide_action → tool_X → sanity_gate` can repeat, and it does
— in a real run, `decide_action` fired five times in a row before the budget
ran out.

**Choice.** `decide_action` is where the LLM picks between four genuinely
different next steps, not four phrasings of the same thing:

```python
if chosen_tool not in {"zoom", "scale", "adjacency", "recount"}:
    chosen_tool = "recount"
```

`route_from_decide` then sends execution down one of four different edges
based on that string. This is a real branch in the program's control flow
decided by a model's output, not a template being filled in.

**Self-termination.** The budget is the stop condition. `extract_initial`
seeds it: `"budget_remaining": INITIAL_BUDGET` (5). `decide_action` spends
one unit every time it runs: `new_budget = state.get("budget_remaining",
INITIAL_BUDGET) - 1`. And `sanity_gate` is the piece that actually enforces
the ceiling:

```python
elif budget_remaining <= 0:
    decision = "flag"
```

Once that line fires, the graph can no longer route to `decide_action` again
— `route_from_sanity_gate` sends it to `flag_for_review` and then `persist`
regardless of how many rooms are still unresolved.

**Evolving state.** Here's a real example from a live run. A room started
with `area_m2: 25` after `extract_initial`. `decide_action` picked "zoom" on
it, `tool_zoom` re-examined a crop of just that room and came back with
`area_m2: 35` — the state dict for that room actually changed between
iterations, not just a log message about it. Adjacency works the same way:
before any correction, a room's `config_json["adjacency"]` looks like
`{"north": "external", "south": "external", "east": "external", "west":
"external"}`; after `tool_adjacency` confirms a neighbor, one of those
becomes a real room ID, e.g. `{"east": "hrr-floor-1-room-04", ...}`. The next
`sanity_gate` pass reads that updated dict and produces a different score
than it did the first time.

## 3. The graph — node by node

| Node | What it does | Reads from state | Writes to state |
|---|---|---|---|
| `extract_initial` | Calls Groq Vision once to get the raw room list | `file_bytes`, `filename`, `api_key` | `rooms`, `extraction_raw_count`, `groq_model`, `budget_remaining`, `iteration` |
| `geometry_process` | Numbers rooms, maps walls to compass directions, infers which rooms touch each other | `rooms`, `north_angle_deg`, `building_id`, `floor_level` | `rooms` (now with `room_id`, `volume_m3`, `config_json.adjacency`), `oriented_walls` |
| `sanity_gate` | Scores every room's confidence and decides whether to persist, retry, or give up | `rooms`, `expected_room_count`, `budget_remaining` | `low_confidence_rooms`, `gate_decision`, `gate_failed_checks` |
| `decide_action` | Asks the LLM which tool to run next, on which room, and why | `low_confidence_rooms`, `gate_failed_checks`, `rooms`, `run_log`, `api_key` | `chosen_tool`, `tool_target`, `budget_remaining` (−1), `iteration` (+1) |
| `tool_zoom` | Re-examines a cropped image of one room to correct its bounding box and area | `tool_target`, `rooms`, `file_bytes`, `filename`, `api_key` | `rooms` (that room's `area_m2`, `volume_m3`) |
| `tool_scale` | Re-examines the full plan for a scale bar or dimension label to correct one room's area | `tool_target`, `rooms`, `file_bytes`, `api_key` | `rooms` (that room's `area_m2`, `volume_m3`) |
| `tool_adjacency` | Re-examines the shared wall between two named rooms to confirm or deny they're adjacent | `tool_target` (`"A:B"`), `rooms`, `file_bytes`, `api_key` | `rooms` (both rooms' `config_json.adjacency`) |
| `tool_recount` | Re-examines the full plan for an independent room count | `rooms`, `file_bytes`, `api_key` | `expected_room_count` |
| `flag_for_review` | Marks every still-unresolved room as needing a human look | `rooms`, `low_confidence_rooms` | `rooms` (`config_json.needs_review`, `review_reason`), `flagged_rooms` |
| `persist` | Writes the floor, rooms, adjacency pairs, and an audit-log row to Supabase | `rooms`, `building_id`, `floor_level`, `floor_name`, plus most bookkeeping fields | `saved_rooms`, `flagged_rooms`, `run_id`, `floor` |

## 4. The state — field by field

`BuildingAgentState` is split into two parts in the code: six fields that are
guaranteed present the moment a run starts (`_BuildingAgentInput`), and
everything else, which only exists once the node that produces it has run.

| Field | Type | Set when | Read by |
|---|---|---|---|
| `file_bytes` | `bytes` | Run start | `extract_initial`, `tool_zoom`, `tool_scale`, `tool_adjacency`, `tool_recount` |
| `filename` | `str` | Run start | `extract_initial`, `tool_zoom`, `tool_adjacency` |
| `north_angle_deg` | `float` | Run start | `geometry_process` |
| `building_id` | `str` | Run start | `geometry_process`, `persist`, the building-exists check in `run_graph` |
| `floor_level` | `int` | Run start | `geometry_process`, `persist` |
| `api_key` | `str` | Run start | `extract_initial`, `decide_action`, all four tools |
| `floor_name` | `str \| None` | Run start (optional) | `persist` |
| `expected_room_count` | `int \| None` | Run start (optional), or overwritten by `tool_recount` | `sanity_gate` |
| `rooms` | `list[dict]` | `extract_initial`, then re-written by almost every later node | Nearly every node |
| `budget_remaining` | `int` | `extract_initial` (=5), decremented by `decide_action` | `sanity_gate`, `decide_action` |
| `iteration` | `int` | `extract_initial` (=0), incremented by `decide_action` | `persist` (stored as `iterations`) |
| `low_confidence_rooms` | `list[str]` | `sanity_gate` | `decide_action`, `flag_for_review` |
| `gate_failed_checks` | `dict[str, list[str]]` | `sanity_gate` | `decide_action` (built into the prompt) |
| `gate_decision` | `"persist" \| "flag" \| "decide"` | `sanity_gate` | `route_from_sanity_gate` |
| `chosen_tool` | `"zoom" \| "scale" \| "adjacency" \| "recount" \| None` | `decide_action` | `route_from_decide` |
| `tool_target` | `str \| None` | `decide_action` | `tool_zoom`, `tool_scale`, `tool_adjacency` |
| `saved_rooms` | `list[str]` | `persist` | Returned to `api.py` as `room_ids` |
| `flagged_rooms` | `list[str]` | `flag_for_review` | `persist`, returned to `api.py` |
| `run_id` | `str` | `persist` (generated if missing) | Returned to `api.py` |
| `run_log` | `list[dict]` | Run start (`[]`), appended by every node | `decide_action` (tool-history), `persist` (saved as `building_agent_runs.run_log`) |
| `extraction_raw_count` | `int` | `extract_initial` | `persist`, `api.py`'s "no rooms detected" check |
| `groq_model` | `str` | `extract_initial` | `persist` |
| `oriented_walls` | `dict[str, str]` | `geometry_process` | Returned to `api.py` |
| `floor` | ORM object | `persist` | Returned to `api.py`, used to attach the annotated plan URL afterward |

## 5. The database — what gets written and where

**`floors`** — one row per floor, written by `persist` via `save_floor`.
`floor_id` is built as `f"{building_id}-floor-{floor_level}"`, plus
`building_id`, `level` (from `floor_level`), and `name` (from `floor_name`,
may be `None`). `floor_plan_url` is *not* set here — `api.py` fills it in
afterward, once the annotated image has been rendered and uploaded to
storage, by fetching the row again and updating it.

**`rooms`** — one row per detected room, written by `persist` via
`save_room`, looping over `state["rooms"]`. Columns written: `room_id`,
`floor_id`, `room_label`, `room_type`, `area_m2`, `volume_m3`,
`primary_orientation`, `r_wall` (pulled from
`config_json["thermal"]["wall_r_value"]`), `c_zone` (from
`config_json["thermal"]["estimated_C_zone"]`), and `config_json` itself — the
full nested dict, including whatever `adjacency`, `needs_review`, and
`review_reason` ended up in it. Notably, `rooms` has **no `building_id`
column** in the real schema — confirmed against the live database — so it's
never written here, only `floor_id`.

**`room_adjacencies`** — written by `persist` directly from
`_infer_bbox_adjacencies(rooms)`, not from the resolved `config_json`
version. That matters: `config_json.adjacency` can only hold one neighbor per
direction, but `room_adjacencies` has no such limit (its primary key is
`(room_id, adjacent_room_id)`), so every geometrically-touching pair gets
written here even when one of them lost the tie-break for the single-slot
summary. Each pair is written twice, once per direction, with `wall_type`
defaulting to `"internal"`.

**`building_agent_runs`** — exactly one row per graph run, written by
`persist` at the very end. It's the only table this feature owns outright
(defined in `graph.py`, not `schema_models.py`) and the only one this agent
writes to that isn't part of the core building/floor/room data model — it
exists purely as an audit log. See section 7 for what each column means.

## 6. The loop — a concrete walkthrough

Say a plan with 8 rooms is uploaded, and 2 of them (`room-03` and `room-07`)
are photographed at an angle that makes their edges slightly blurry.

**Extraction.** `extract_initial` calls Groq Vision once and gets back all 8
rooms, including 03 and 07 — the model doesn't fail on them, it just
estimates their bounding boxes a little imprecisely.

**Geometry.** `geometry_process` numbers the rooms `room-01` through
`room-08` by position, and `_apply_adjacencies` infers who touches whom from
those bounding boxes. Because 03's and 07's boxes are slightly off, their
inferred neighbor relationships come out inconsistent — say 03 claims 02 as
its eastern neighbor, but the resolved geometry doesn't cleanly agree from
02's side.

**First gate.** `sanity_gate` scores all 8 rooms. Rooms 01, 02, 04, 05, 06,
08 come back at 1.0 — no check applies to them that fails. Rooms 03 and 07
score 0.0, both failing `adjacency_consistency`. `low_confidence_rooms =
["room-03", "room-07"]`, `budget_remaining = 5`, decision = `"decide"`.

**Iteration 1.** `decide_action` sees both rooms failed
`adjacency_consistency` and picks `chosen_tool="adjacency"`,
`tool_target="room-03:room-02"`. Budget drops to 4. `tool_adjacency` crops
the shared boundary of 03 and 02, asks Groq Vision to confirm, and gets back
`adjacent: true, direction: "east"`. Room-03's adjacency slot gets filled in
cleanly. Back at `sanity_gate`: room-03 now scores 1.0, room-07 is still at
0.0. Decision is still `"decide"`.

**Iteration 2.** `decide_action` now targets `room-07:room-06`. Budget drops
to 3. `tool_adjacency` checks that boundary and this time Groq Vision says
`adjacent: false` — 07 doesn't actually touch 06; the blur just made the
geometry heuristic guess wrong. The code clears the stale claim on both
sides. At the next `sanity_gate`, room-07 now has no adjacency claim left at
all, so `has_any_neighbor` is false, the check becomes inapplicable for it,
and it scores 1.0 by default — not because its adjacency was *correctly*
determined, but because there's nothing left to check. `low_confidence_rooms`
is now empty, so decision becomes `"persist"`.

**End.** Two iterations were used out of a budget of 5 — it didn't need to
exhaust the budget or hit `flag_for_review` this time. `persist` writes the
floor, all 8 rooms (none marked `needs_review`, since none were still
low-confidence at the final gate), every real touching pair into
`room_adjacencies`, and one `building_agent_runs` row with `iterations=2`,
`rooms_saved=8`, `rooms_flagged=0`, `final_decision="persist"`.

Worth saying out loud to a mentor: this walkthrough also shows a real
limitation. Room-07 ended up "confident" not because the system verified
something true about it, but because clearing a wrong guess made the check
inapplicable rather than passed. The confidence score measures "nothing
contradicts this," not "this is definitely correct."

## 7. The logging — what is recorded and why

Every column in `building_agent_runs` and what it's for:

`run_id` is the key that ties a specific upload response back to its full
audit trail — `api.py` returns it in the response, so a bug report can be
traced to the exact row. `building_id` and `floor_id` let you filter runs by
building or floor over time. `started_at` is defined in the table but never
actually set anywhere in the code — it's always `NULL` today, worth flagging
as unfinished. `finished_at` is a real timestamp, set the moment `persist`
runs.

`iterations` (and its duplicate, `iteration_number` — both exist because the
original spec asked for slightly different names covering the same value) is
a quick health signal: a floor that consistently needs many iterations across
uploads might mean the vision model or the confidence threshold needs
tuning. `rooms_detected` (and its duplicate `extraction_raw_count`) is the
model's first, unedited guess at how many rooms exist. `rooms_saved` is how
many actually got written — currently always equal to the room count in
state, since flagging doesn't exclude a room from being saved. `rooms_flagged`
is the number that actually need a human to look at them, which is the number
someone triaging this data would actually care about.

`final_decision` and `gate_decision` are the same value (the last
`sanity_gate` outcome) stored under two names. `groq_model` records which
vision model did the extraction, so results can be compared if the model is
swapped later. `gate_low_confidence_rooms` is the exact set of room IDs still
unresolved at the end. `gate_scores` is the full score dictionary from the
*last* `sanity_gate` pass — the fastest way to see exactly how confident the
system was about every room without re-running anything. `gate_budget_remaining`
tells you whether the run ended because it ran out of budget (0) or because it
actually became confident.

`tool_chosen` and `tool_target` capture only the *last* tool call, not the
full sequence — that full sequence, with every intermediate score and every
piece of LLM reasoning, lives in `run_log`. `tool_before` and `tool_after`
are defined columns that are never actually populated (always `{}`) — the
equivalent information exists per-call inside `run_log`'s individual events
instead, so these two columns are dead weight today. `run_log` itself is the
one column you'd actually open to debug a specific run: every node visited,
every score computed, every reasoning string the LLM gave, every tool result,
in order, with timestamps.

## 8. Questions the mentor might ask — with answers

**Why LangGraph instead of a plain Python while loop?** LangGraph makes the
possible paths through the system an explicit, inspectable graph (nodes plus
typed edges) instead of control flow buried in nested if/else, and it comes
with a checkpointer (`MemorySaver` here) for free, which would otherwise have
to be hand-built if a future version needs to pause or resume a run mid-flight.

**Why `llama-3.3-70b-versatile` for `decide_action` and not the vision model?**
`decide_action` never looks at the image — it only reasons over text (room
labels, which checks failed, JSON history) — so a vision model isn't needed;
`llama-3.3-70b-versatile` is Groq's general-purpose text model and supports
the `response_format: json_object` mode this node depends on for clean
structured output.

**What happens if Groq Vision returns 0 rooms?** `extract_initial` still
completes, and the graph runs all the way through with an empty room list,
ending in `persist` with `rooms_detected=0` — `api.py` checks
`extraction_raw_count == 0` right after `run_graph` returns and raises a 422
to the caller, even though a nearly-empty floor row was already written.

**Why is `budget_remaining` set to 5?** It's a fixed constant
(`INITIAL_BUDGET`) chosen as a practical ceiling on extra Groq calls per
upload — every `decide_action` plus its tool call costs real tokens against
Groq's account-wide per-minute limit, so 5 bounds the worst case without
letting one stubborn floor plan retry forever.

**What does `needs_review` mean downstream?** It's a boolean written into a
room's `config_json` by `flag_for_review` when that room is still
low-confidence once the budget runs out. `api.py`'s response includes it per
room (`RoomOut.needs_review`) so a frontend can visually flag which rooms a
person should double-check, without blocking the rest of the upload.

**Why can `config_json.adjacency` only hold one neighbor per direction if a
room can touch several rooms on the same wall?** Because
`schema_models.Adjacency` (which `get_thermal_parameters` validates against
for Agent 2) declares north/south/east/west as plain strings, not lists —
changing that would break validation elsewhere. Ties are resolved by keeping
the neighbor with the largest shared-edge overlap; anything that loses that
tie is still fully captured in `room_adjacencies`, which has no such limit.

**Why does `tool_recount` only update `expected_room_count` instead of adding
or removing rooms directly?** Its prompt only asks Groq for a number and a
list of labels, not new bounding boxes, so there isn't enough geometry to
construct a real `Room` entry from it — instead the corrected count feeds
back into the next `sanity_gate` pass, where `count_match` re-evaluates
against it.

**What stops the LLM in `decide_action` from picking the same failing tool
repeatedly?** The prompt includes a history list built from every past
`decide_action` event in the current run, with an instruction not to repeat a
`(tool, target)` pair — but this is advisory, not enforced in code. Verified
live: the model sometimes deliberately ignores it, with an explicit
justification in its own reasoning for doing so.

**Why does `persist` open its own database session instead of reusing the
FastAPI request's session?** LangGraph node functions are plain functions
operating on state, not FastAPI route handlers, so they have no access to a
request-scoped dependency-injected session. `persist` imports the shared
`engine` from `config.py` directly and opens its own `Session`, committing
independently of whatever `api.py` is doing with its own session for the rest
of the request.

**If a room gets flagged for review, does it still get saved?** Yes.
`persist` writes every room in `state["rooms"]` unconditionally — being in
`flagged_rooms` only adds `needs_review=true` and a `review_reason` string
inside that room's `config_json`. Flagging never excludes a room from being
written to the `rooms` table.
