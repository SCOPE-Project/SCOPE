# Frontend-to-Backend Scheduling Integration Plan

## Goal and Scope

Move the React frontend away from its demo scheduling implementation and make the backend authoritative for all scheduling-domain calculations.

Only frontend files are to be changed during implementation. Backend code is treated as the authoritative contract wherever it differs from `Scheduling_Architecture_and_Data_Contracts.md`.

The frontend should remain responsible for presentation work such as formatting, sorting for display, map projection, timeline layout, SVG coordinates, and animation. It should no longer perform link filtering, schedule conflict detection, trade-off grouping, scheduling, link-budget estimation, data-buffer simulation, or SatOS commit simulation.

## Authoritative Workflow

The frontend should execute the following sequence:

1. `GET /tasks/initialize`
2. `POST /tasks/extract-overpasses`, followed by task polling
3. `POST /tasks/filter-links`, followed by task polling
4. `POST /tasks/process-trade-offs`, followed by task polling
5. `POST /schedule/session/{session_id}/override` for operator decisions
6. `POST /schedule/session/{session_id}/commit` for final confirmation

The frontend must explicitly store:

- `orbitEngineRunId`
- `filterRunId`
- `sessionId`
- Propagation result and global tracks
- Filtered candidate links
- The current `SessionPlanDTO`

After propagation, use `payload.metadata.task_id` as the `orbit_engine_run_id`. After filtering, use `payload.filter_run_id`. After trade-off processing, use `payload.session_id`.

Both filtering and trade-off processing return a `TaskReceiptResponse` and require polling through:

- `GET /tasks/status/{task_id}`
- `GET /tasks/status/{task_id}/result`

## 1. Connect the Link-Filtering Pipeline

Remove the frontend implementations that:

- Compare passes against minimum elevation thresholds
- Mark passes as filtered
- Detect overlaps with SatOS baseline activities
- Generate canonical frontend link IDs

Call `POST /tasks/filter-links` after propagation using a request such as:

```json
{
  "orbit_engine_run_id": "...",
  "min_aos_los_elevation_deg": 5.0,
  "min_peak_elevation_deg": 15.0,
  "default_downlink_rate_mbps": 25.0,
  "satellite_downlink_rates_mbps": {}
}
```

Render `FilterResultDTO.links` directly. The relevant backend-owned fields are:

- `link_id`
- `overpass_id`
- `satellite_name`
- `groundstation_name`
- `start_time`
- `end_time`
- `duration_seconds`
- `max_elevation_deg`
- `estimated_data_capacity_mb`
- `is_eligible`
- `eligibility_status`
- `ineligibility_reason`
- `conflicting_activity_uuid`

Display identifiers such as `L-001` may remain as UI labels, but the backend's `link_id` and `overpass_id` must be retained as canonical identifiers for later API calls.

If filter values change after propagation, rerun `/tasks/filter-links` using the existing orbit-engine run ID and invalidate any existing scheduling session.

## 2. Replace Demo Trade-Off Calculation

Remove the frontend code that:

- Builds demo conflict groups
- Generates synthetic overlapping passes
- Scores links from duration and elevation
- Chooses recommended options locally
- Assembles a final schedule locally

The Calculate Trade-Offs action should call `POST /tasks/process-trade-offs` using the current `filter_run_id`, buffer configuration, and scoring configuration.

### Input Contract

Endpoint:

```text
POST /tasks/process-trade-offs
Content-Type: application/json
```

The only required field is `filter_run_id`. A minimal valid request is:

```json
{
  "filter_run_id": "filter-task-uuid"
}
```

For the current frontend controls, the recommended request is:

```json
{
  "filter_run_id": "filter-task-uuid",
  "satellite_buffer_configs": {
    "Sat-1": {
      "capacity_mb": 100000.0,
      "initial_level_mb": 40000.0,
      "payload_generation_rate_mbps": 100.0,
      "downlink_rate_mbps": 25.0
    }
  },
  "default_buffer_config": {
    "capacity_mb": 100000.0,
    "initial_level_mb": 40000.0,
    "payload_generation_rate_mbps": 100.0,
    "downlink_rate_mbps": 25.0
  },
  "scoring_config": {
    "name": "buffer_overflow_avoidance",
    "parameters": {
      "alpha": 2.0,
      "exponent": 2.0
    }
  }
}
```

Only use these three configs. The others are irrelevant for the frontend for now.

`satellite_name` may be included inside a buffer configuration DTO, but it should be omitted here because the key in `satellite_buffer_configs` already identifies the satellite.

The complete accepted request contract is:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `filter_run_id` | `string` | Yes | ID returned in the completed `/tasks/filter-links` result. |
| `satellite_buffer_configs` | `object<string, SatelliteBufferConfig>` | No | Complete per-satellite buffer configuration. |
| `default_buffer_config` | `SatelliteBufferConfig` | No | Fallback for satellites without a per-satellite configuration. |
| `initial_buffer_levels_mb` | `object<string, number>` | No | Shorthand override for initial buffer levels. |
| `buffer_capacities_mb` | `object<string, number>` | No | Shorthand override for buffer capacities. |
| `payload_generation_rates_mbps` | `object<string, number>` | No | Shorthand override for payload generation rates. |
| `downlink_rates_mbps` | `object<string, number>` | No | Shorthand override for downlink rates. |
| `scoring_config` | `ScoringConfig` | No | Scheduling strategy and its parameters. |

`SatelliteBufferConfig` fields are:

| Field | Type | Validation | Backend default |
| --- | --- | --- | --- |
| `satellite_name` | `string` | Optional | Name supplied by the parent object key. |
| `capacity_mb` | `number` | Must be greater than `0`. | `2000.0` |
| `initial_level_mb` | `number` | Must be at least `0`. | `0.0` |
| `payload_generation_rate_mbps` | `number` | Must be at least `0`. | `15.0` |
| `downlink_rate_mbps` | `number` | Must be greater than `0`. | `25.0` |

Supported `scoring_config.name` values are:

| Name | Parameters |
| --- | --- |
| `buffer_overflow_avoidance` | `alpha` and `exponent`; both default to `2.0`. |
| `max_downlink_throughput` | No frontend parameters required. |
| `max_pass_duration` | No frontend parameters required. |

Configuration precedence is:

1. A shorthand map such as `initial_buffer_levels_mb` overrides the corresponding field in `satellite_buffer_configs`.
2. `satellite_buffer_configs` supplies values for explicitly configured satellites.
3. `default_buffer_config` supplies values for all other satellites.
4. Backend defaults apply when none of the above supplies a value.

The frontend should normally use `satellite_buffer_configs` plus `default_buffer_config` and avoid mixing in the shorthand maps. This keeps the request unambiguous.

The values currently entered as GB in the UI must be converted to MB before submission:

```text
capacity_mb = capacity_gb * 1000
initial_level_mb = initial_level_gb * 1000
```

Rate values should follow the effective backend MB/s semantics documented in the Units Caveat below. The downlink rates submitted here should match the rates previously submitted to `/tasks/filter-links`.

The immediate response is not a session plan. It is a task receipt:

```json
{
  "task_id": "session-task-uuid",
  "status": "Queued"
}
```

Poll that task ID until completion. The result wrapper has this shape:

```json
{
  "task_id": "session-task-uuid",
  "status": "Completed",
  "payload": {
    "session_id": "session-task-uuid",
    "filter_run_id": "filter-task-uuid",
    "active_scoring_strategy": "buffer_overflow_avoidance",
    "scoring_config": {},
    "satellite_configs": {},
    "current_plan": {},
    "trade_off_groups": {},
    "conflict_reasons": {},
    "satellite_buffer_profiles": {}
  }
}
```

The completed task returns a `SessionPlanDTO` containing:

- `session_id`
- `filter_run_id`
- `active_scoring_strategy`
- `scoring_config`
- `satellite_configs`
- `current_plan`
- `trade_off_groups`
- `conflict_reasons`
- `satellite_buffer_profiles`

The frontend should treat this DTO as the single source of truth for the Overview, Timeline, Trade-Off, and Data Volume views.

The backend includes one-link groups with `is_trivial: true`. These may be hidden from the conflict-comparison UI, but their `current_plan` entries still determine whether they appear in the proposed schedule.

## 3. Replace Local Selection with Session Overrides

The backend represents operator intent with three states:

- `auto`
- `pinned`
- `excluded`

The preferred frontend controls are therefore Pin, Exclude, and Return to Auto rather than a purely local Select button.

Each action should call:

```text
POST /schedule/session/{session_id}/override
```

with:

```json
{
  "link_id": "...",
  "override_state": "pinned"
}
```

Replace the entire stored session plan with the returned `SessionPlanDTO` after every override.

If the existing single-selection interaction is retained, switching between two pinned alternatives requires returning the previous pinned link to `auto` before pinning the new link. The backend currently has no batch-override endpoint, so the frontend must serialize these calls and disable the controls while they are in progress.

The current backend returns the complete session plan after an override. It does not return the delta list described in the architecture document.

## 4. Render Backend Scheduling States

Build proposed and potential timeline states from `current_plan` rather than from locally selected rows.

For every plan entry, use:

- `is_scheduled`
- `override_state`
- `tradeoff_id`
- `useful_data_offloaded_mb`
- `rejection_reason`
- The nested `link` object

The frontend should visually distinguish:

- Auto-scheduled links
- Pinned links
- Operator-excluded links
- Eligible but unscheduled links
- Baseline-blocked links
- Elevation-excluded links

The current numerical Score column can remain as-is because the backend does expose calculated scores (was just updated/fixed).
Conflict-card explanations can be derived for display from `trade_off_groups` and the backend's `conflict_reasons`; the frontend must not recalculate conflict membership.

## 5. Replace Frontend Buffer and Link-Budget Calculations

Remove the frontend's:

- Slant-range calculation
- Elevation-derived downlink-rate model
- Link-capacity calculation
- Forward data-buffer simulation
- Overflow and starvation detection
- Alternative-schedule comparison simulation

Render `satellite_buffer_profiles` directly. Each profile supplies:

- `capacity_mb`
- `profile_points`
- `overflow_events`
- `total_generated_mb`
- `total_downlinked_mb`
- `total_lost_mb`
- `final_level_mb`
- `peak_level_mb`

The frontend may convert MB to GB for display and map timestamps and levels to SVG coordinates. Those are presentation transformations, not domain calculations.

The existing buffer inputs can become inputs to `default_buffer_config`. A downlink-rate input should be added, and optional per-satellite configuration may be exposed later through `satellite_buffer_configs`.

The same downlink-rate configuration should be sent to both link filtering and trade-off session creation so `estimated_data_capacity_mb` and the scheduling simulation use consistent assumptions.

The red alternative-schedule curve should be removed. The backend currently has no non-mutating session-preview endpoint, so the frontend cannot calculate or preview an alternative without changing the live session.

## 6. Connect the Real Commit Workflow

Replace the simulated confirmation progress loop with:

```text
POST /schedule/session/{session_id}/commit
```

Use the response fields:

- `session_id`
- `committed_links_count`
- `created_activities_count`
- `status`

After a successful commit, optionally call `GET /tasks/initialize` again so the current-schedule timeline reflects the newly created SatOS activities.

Commit errors must be shown to the operator without discarding the current session plan.

## 7. Remove Demo-Mode Behavior

Remove:

- The Demo toggle and badges
- Demo-only button guards
- Synthetic trade-off rows
- Synthetic task and commit delays
- Demo scoring and recommendation copy
- Text claiming that real trade-offs or commits are not connected
- Demo-generated confirmation counts

The application should instead show real backend task progress and API errors.

The existing Terminate button only aborts frontend polling; it does not cancel the backend task. Because the backend has no cancellation endpoint, either rename the action to make this limitation clear or remove it from the task workflow.

## 8. Update the Frontend Compatibility Check

Update `frontend/scripts/backend-compatibility-check.mjs` to validate:

- `/tasks/filter-links`
- `/schedule/session/{session_id}`
- `/schedule/session/{session_id}/override`
- `/schedule/session/{session_id}/strategy`
- `/schedule/session/{session_id}/commit`
- Filter request and result fields
- Trade-off request and session-plan fields
- Override request fields
- Commit response fields

Remove the current incorrect expectation that `/tasks/process-trade-offs` accepts a `satellites` field. Its required identifier is `filter_run_id`.

## 9. API and State Structure

The API/polling logic should be moved out of the large `App.jsx` component into small frontend modules or hooks. Suggested responsibilities are:

- Backend request helper with consistent JSON and error handling
- Reusable task polling helper
- Scheduling-pipeline state or hook
- DTO-to-view-model formatting helpers
- Session override and commit actions

This is a frontend refactor only; it does not require backend changes.

When an upstream stage is rerun, invalidate all downstream state:

```text
Propagation rerun -> clear filter run and scheduling session
Filter rerun      -> clear scheduling session
Session override  -> replace current session plan
```

Because backend repositories and scheduling sessions are in memory, a backend restart may invalidate stored IDs. Treat 404 responses for old run/session IDs as stale-session errors and direct the operator to rerun the affected pipeline stage.

## Contract Differences from the Architecture Document

The backend code is authoritative for the following differences:

- `/tasks/filter-links` returns a task receipt, not a completed filter result directly.
- The completed filter DTO is named `FilterResultDTO`.
- `/tasks/process-trade-offs` returns a task receipt; its polled result payload is `SessionPlanDTO`.
- The scheduling session ID is currently set to the trade-off task ID, but the frontend should still read `payload.session_id` rather than assuming this implementation detail.
- Override requests use `override_state`, not `state`.
- Override responses contain the full session plan and no delta list.
- Session plans expose `scoring_config` and `satellite_configs`.
- Session plans do not expose scheduler score values, adjacency lists, link-to-group maps, or a separate user-overrides map.
- `/schedule/session/{session_id}/strategy` is implemented and can update the scoring strategy synchronously.

## Units Caveat

The backend fields are named with the suffix `_mbps`, while Pydantic descriptions and scheduling calculations treat their values as MB/s. The current frontend demo uses Mbit/s.

For frontend-only integration, follow the backend's effective MB/s semantics:

- Label operator inputs as MB/s.
- Send values without dividing by eight.
- Convert returned MB values to displayed decimal GB by dividing by 1000 when required.

This should be documented in the UI code so that a future backend unit clarification can be handled centrally.

## Calculations That May Remain in the Frontend

The following are presentation calculations and can remain:

- Date/time parsing and formatting
- Sorting records for display
- Timeline lane placement and zoom
- SVG coordinate generation
- Map projection and navigation
- Interpolating sampled backend track points for smooth animation
- Formatting MB values as GB

The map's visibility-footprint geometry is different: it is a scientific/domain calculation currently performed in `frontend/src/components/mapGeometry.js`. The backend does not currently return footprint geometry. If the requirement is literally that no domain calculations occur in the frontend, the visibility-circle features must be disabled until an authoritative backend contract is available.

## Expected Frontend Files

The implementation will primarily affect:

- `frontend/src/App.jsx`
- `frontend/src/index.css`
- `frontend/scripts/backend-compatibility-check.mjs`
- Frontend tests
- New frontend-only API, polling, state, and mapping modules as needed

No backend files should be edited.
