**Parent:** [[Softwaresysteme Semesterprojekt]]

## 0. Top-Level Swimlane Diagram

High-level user flow across the **Operator**, **React Frontend**, and **FastAPI Backend + SatOS** layers.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SWIMLANE: OPERATOR                                                                                         │
│                                                                                                             │
│   [App Open]  ─── configure ────────────────────────────── [Launch SCOPE] ─── [Calculate Trade-Offs]         │
│                   assets/window/                                              │                             │
│                   filters/buffer/                                             ▼                             │
│                   strategy                                          [Override links / PIN / EXCLUDE]        │
│                                                                               │                             │
│                                                                     [Confirm Schedule]                      │
│                                                                               │                             │
│                                                                     [Commit to SatOS]                       │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │                │                                      │                │               │
          ▼                ▼                                      ▼                ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SWIMLANE: REACT FRONTEND                                                                                   │
│                                                                                                             │
│  [Mount]       [Connection   [Asset &         [Transition     [Poll task      [Sync override  [Stage        │
│  Health poll   Checks]       Sched. Display]  landing→        status]         → update rows,  review,      │
│  /status       /satos/asset  landing page     workspace]      live progress   cards, timeline] lock UI,    │
│  /satos/asset  /list]        config form      sequential      logs]           instant redraw]  show KPIs,  │
│  /list]                                       pipeline:                                        per-asset   │
│                                               1. clear?                                        tables]     │
│                                               2. extract                                                   │
│                                               3. filter                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │                │                           │                │               │               │
          ▼                ▼                           ▼                ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SWIMLANE: FASTAPI BACKEND + SATOS                                                                          │
│                                                                                                             │
│  GET /status   GET /satos/   GET /tasks/      POST /utilities/ POST /tasks/   POST /schedule/  POST        │
│                asset/list    initialize       satos/clear-     extract-       session/{id}/    /schedule/  │
│                              (cache or        scope-           overpasses     override         session/    │
│                              SatOS init)      activities       POST /tasks/   (sync re-sim)    {id}/commit │
│                                               (optional)       filter-links                               │
│                                                                POST /tasks/   GET /tasks/                 │
│                                                                process-       initialize                  │
│                                                                trade-offs     (refresh)                   │
│                                                                GET /tasks/                                │
│                                                                status/{id}                                │
│                                                                (polling)                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Operator User Storyboard

The development framework maps directly to the following five operational planning phases outlined by the mission planner's user story:

- **Phase 1: Initialization**
    The frontend loads and immediately begins health-checking the backend (`GET /status`) and SatOS connectivity (`GET /satos/asset/list`). In parallel it triggers `GET /tasks/initialize` to load mission assets (satellites, ground stations, and their current SatOS schedules). The operator is presented with a rich landing-page configuration form covering: operator name, planning window (UTC or local), satellite and ground station selection, optional link-elevation and peak-elevation filters, per-satellite buffer configuration (capacity, start fill, generation rate, downlink rate), and trade-off strategy selection (including scoring parameters). An optional "Clear existing SCOPE activities before launch" toggle is also available.

- **Phase 2: Launch**
    The operator clicks **"Launch SCOPE"** (enabled only when all configuration requirements are met). The view transitions from the landing page to the workspace. The launch sequence runs as a sequential async pipeline with live progress feedback in the Overview panel:
    1. *(Optional)* Clear existing SCOPE activities via `POST /utilities/satos/clear-scope-activities`, then refresh asset schedules via `GET /tasks/initialize`.
    2. **Orbit propagation & overpass extraction:** `POST /tasks/extract-overpasses` → poll `GET /tasks/status/{task_id}` → result. Propagation results are cached and reused if the same assets and planning window are launched again.
    3. **Link derivation & filtering:** `POST /tasks/filter-links` → poll `GET /tasks/status/{task_id}` → result. Filtered links populate the Overview table.

- **Phase 3: Trade-Off**
    The operator clicks **"Calculate Trade-Offs"** in the Overview sidebar (requires buffer config and strategy to be valid). A background task runs conflict identification, buffer simulation, and policy scoring: `POST /tasks/process-trade-offs` → poll `GET /tasks/status/{task_id}` → result. On completion the backend returns a full `SessionPlanDTO` containing conflict groups, per-link scheduling decisions, buffer curves, and scoring metadata. The frontend populates the trade-off drawer in the Timeline panel and color-codes the Overview and Timeline.

- **Phase 4: User Interaction**
    The operator clicks override controls on individual links in the trade-off drawer or Timeline tooltip (PIN / EXCLUDE / AUTO). Each click triggers a **synchronous** `POST /schedule/session/{session_id}/override` which re-runs the forward simulation on the backend and returns an updated `SessionPlanDTO` immediately. The frontend applies the updated plan to rows, cards, and the timeline in a single redraw — no polling loop is needed.

    The operator may also change the active scoring strategy directly from the Timeline toolbar or Sidebar configuration panel via synchronous `POST /schedule/session/{session_id}/strategy`. Existing manual overrides (PIN / EXCLUDE) are preserved and carried over to the new strategy without re-running the full trade-off pipeline.

- **Phase 5: Confirmation & SatOS Commit**
    The operator clicks **"Confirm Communication Schedule"** — a client-side state transition that opens the staged review panel showing per-satellite and per-ground-station link tables, data volume KPIs, and buffer profiles. Each asset's links must be individually acknowledged before the commit button unlocks.
    The operator then clicks **"Commit SCOPE Communication Activities to SatOS"**: `POST /schedule/session/{session_id}/commit`. The UI locks with a progress indicator. On success, the frontend calls `GET /tasks/initialize` to refresh the SatOS ground truth and displays a green success banner with committed link and activity counts.

---

## 2. Chronological Event Sequence Walkthrough & Visualizations

### Phase 1: Initialization

Upon loading the browser application, the React frontend immediately checks connectivity and loads mission assets.

```
[ Operator Opens Application ]
               │
               ├──> Continuous (2 s interval, landing-page only):
               │         GET /status                    ──> backendAlive state
               │         GET /satos/asset/list          ──> satosAlive state
               │
               └──> Once (on backend online):
                         GET /tasks/initialize          ──> Assets + Schedules
                                                            Populates satellite & GS
                                                            selection checkboxes,
                                                            SatOS schedule sidebar
```

- **React Frontend Action:** On mount, fires connection health checks every 2 s (only while on the landing page and tab is visible). As soon as the backend is reachable, triggers asset initialization.
- **FastAPI Backend Request:** `GET /tasks/initialize?force_refresh=false`
- **Internal Python Action:** Checks an in-memory `AssetRepository` cache; if cold, queries the SatOS SDK for the full fleet asset list and active schedule blocks. Returns assets, their SatOS schedules, and a `cached` flag.
- **UI Update:** Landing page configuration form populates with satellite and ground-station checkboxes. SatOS connection status badge updates. The operator configures the mission planning session.

**Landing-page configuration fields collected before launch:**

| Section | Fields |
|---|---|
| Operator | Operator name (required) |
| Planning Window | Start date/time, End date/time, UTC / Local toggle |
| Assets | Satellite multi-select, Ground Station multi-select |
| Link Filters | Minimum AOS/LOS elevation (°), Minimum peak elevation (°) |
| Buffer Config | Capacity (GB), Initial fill (GB), Payload generation rate (Mb/s), Downlink rate (Mb/s) |
| Trade-Off Strategy | Strategy dropdown (buffer_overflow_avoidance / max_downlink_throughput / max_pass_duration), Scoring alpha & exponent (when applicable) |
| Utilities | "Clear existing SCOPE activities" toggle (optional SatOS purge before launch) |

---

### Phase 2: Launch

The operator clicks **"Launch SCOPE"** after completing all configuration fields. The frontend transitions to the workspace view and runs the following sequential pipeline with live progress in the Overview panel.

```
[ Operator clicks "Launch SCOPE" ]
               │
               │  (view transitions: landing → workspace)
               │
               ├──> Step 0 (conditional): POST /utilities/satos/clear-scope-activities
               │                                    │
               │                          GET /tasks/initialize   ──> Refresh asset schedules
               │
               ├──> Step 1 (conditional - skipped if propagation result cached):
               │         POST /tasks/extract-overpasses  ──> { task_id }
               │                    │
               │                    └──> Poll: GET /tasks/status/{task_id}  ──> Progress logs
               │                                    │ (completed)
               │                                    └──> GET /tasks/status/{task_id}/result
               │                                              ──> propagation result + satellite tracks
               │
               └──> Step 2: POST /tasks/filter-links  ──> { task_id }
                                   │
                                   └──> Poll: GET /tasks/status/{task_id}  ──> Progress logs
                                                   │ (completed)
                                                   └──> GET /tasks/status/{task_id}/result
                                                             ──> filtered link list  ──> Overview table
```

- **Step 0 (optional SatOS purge):**
    - **FastAPI:** `POST /utilities/satos/clear-scope-activities` with schedule names and time window.
    - **Internal Python:** Queries SatOS for all SCOPE-originated activities in the window and deletes them in batch.
    - Then `GET /tasks/initialize` refreshes the schedule cache.

- **Step 1 (orbit propagation + overpass extraction):**
    - **React Frontend:** `POST /tasks/extract-overpasses` with selected satellites, ground stations, and planning window ISO timestamps. Starts a polling loop on `GET /tasks/status/{task_id}` every 1.2 s.
    - **FastAPI:** Spawns a `BackgroundTask` that runs TLE propagation (via Orekit) and geometry-based overpass extraction. Returns `{task_id}` immediately.
    - **UI Update:** Live status messages stream into the Overview panel. Satellite ground tracks are drawn on the Map View on completion. Result is cached so re-launches with identical parameters skip this step.

- **Step 2 (link derivation & filtering):**
    - **React Frontend:** `POST /tasks/filter-links` referencing the completed `orbit_engine_run_id` and optional elevation thresholds and downlink rate. Polls `GET /tasks/status/{task_id}`.
    - **FastAPI:** Runs the filter pipeline — derives geometry-valid links, trims overpasses to elevation constraints, screens against SatOS baseline conflicts, and computes estimated data capacity per link.
    - **UI Update:** Filtered link table populates the Overview. The pipeline is now complete and the trade-off button unlocks.

---

### Phase 3: Trade-Off

The operator clicks **"Calculate Trade-Offs"** (enabled when filter run exists and buffer/strategy config is valid).

```
[ Operator clicks "Calculate Trade-Offs" ]
               │
               └──> POST /tasks/process-trade-offs  ──> { task_id }
                                   │
                                   └──> Poll: GET /tasks/status/{task_id}  ──> Scheduling logs
                                                   │ (completed)
                                                   └──> GET /tasks/status/{task_id}/result
                                                             ──> SessionPlanDTO
                                                                   ├── session_id
                                                                   ├── conflict groups (trade-off cards)
                                                                   ├── per-link scheduling decisions
                                                                   ├── buffer simulation curves
                                                                   └── scoring metadata
```

- **React Frontend Action:** `POST /tasks/process-trade-offs` with the active `filter_run_id`, default buffer config, per-satellite buffer config overrides, and scoring strategy/parameters.
- **FastAPI:** Creates an in-memory `SchedulingSession`. Runs conflict detection (`build_conflict_structure`), buffer simulation (`run_forward_simulation`), and produces a scored and scheduled plan. Returns a task receipt immediately; computation runs in background.
- **UI Update:** On completion, the backend's `SessionPlanDTO` is applied. Overview rows gain scheduling state and trade-off group IDs. Trade-off cards populate the Timeline's drawer. Links are color-coded by conflict group. The Timeline centers on the first trade-off card.

---

### Phase 4: User Interaction

The operator clicks override controls on a link — in the trade-off drawer, the Overview table, or the Timeline tooltip.

```
[ Operator selects override: PIN / EXCLUDE / AUTO on a link ]
               │
               └──> POST /schedule/session/{session_id}/override
                              ──> { link_id, override_state }
                                       │
                                       └──> Returns: updated SessionPlanDTO   (synchronous)
                                                  ──> Frontend applies: updated rows,
                                                                        trade-off cards,
                                                                        timeline, tooltip
```

- **React Frontend Action:** Immediately disables the override control for the link while the request is in flight. `POST /schedule/session/{session_id}/override` with `link_id` and `override_state` (`'pinned'`, `'excluded'`, or `'auto'`).
- **FastAPI:** Synchronously mutates the `SchedulingSession` in memory, re-runs the forward simulation with the new constraint, and returns the full updated `SessionPlanDTO`.
- **UI Update:** No polling needed. The returned plan is applied immediately — rows, cards, timeline, and any open tooltip are all redrawn in a single pass.

The operator may also update the active scoring strategy without re-running the full trade-off pipeline:

```
[ Operator changes strategy (Timeline toolbar or Sidebar) or adjusts parameters ]
               │
               ├──> UI temporarily locks: disables override controls & strategy selectors,
               │    displays in-flight spinner on Timeline toolbar
               │
               └──> POST /schedule/session/{session_id}/strategy
                              ──> { name: strategy_name, parameters: { alpha, exponent } }
                                       │
                                       └──> Returns: updated SessionPlanDTO   (synchronous)
                                                  ──> Frontend applies: updated rows,
                                                                        trade-off cards,
                                                                        timeline, buffer curves
```

- **UI Triggers:**
  - **Timeline Toolbar Strategy Switcher:** A compact dropdown directly in the left group of the Timeline toolbar allows rapid in-situ switching between `buffer_overflow_avoidance`, `max_downlink_throughput`, and `max_pass_duration` once a session is active (`sessionId && tradeOffsCalculated`). An animated spinner indicates when a strategy update is in flight.
  - **Sidebar "Trade-Off Configuration" Accordion:** Changing the strategy dropdown in the configuration accordion also immediately triggers `POST /schedule/session/{session_id}/strategy`. For hyperparameter tuning (Urgency $\alpha$ and Urgency exponent under `buffer_overflow_avoidance`), an **"Apply Strategy to Session"** button submits the updated parameters synchronously without recalculating Phase 2.
- **Shared Override Behavior:**
  - User overrides (`PINNED`, `EXCLUDED`) are **shared and preserved** across strategy switches. Manual operator decisions are not lost or isolated; the solver reapplies existing constraints to the newly selected scoring objective.
- **Mutual Lockout:**
  - While `POST /schedule/session/{session_id}/strategy` is in flight (`updatingStrategy` state), override buttons across the Overview table, Timeline tooltip, and Trade-Off Drawer are disabled to prevent race conditions on the session state.
- **FastAPI:** Synchronously loads the `SchedulingSession` from `SchedulingSessionRepository`, mutates `active_scoring_strategy` and `scoring_parameters`, re-runs `active_scheduler.solve(...)` with the existing `user_overrides`, updates `current_plan` and `satellite_buffer_profiles`, and returns the updated `SessionPlanDTO`.
- **UI Update:** No background task or polling needed. The returned plan is applied synchronously via `applyAuthoritativeSessionPlan(...)`, redrawing Overview rows, Trade-Off cards, timeline bars, and buffer curves in a single pass.

---

### Phase 5: Confirmation & SatOS Commit

```
[ 1. Operator clicks "Confirm Communication Schedule" ]
               │
               └──> Client-side state transition (no network request)
                         ──> Opens staged review panel:
                               ├── Per-satellite: link tables, buffer profiles,
                               │   peak fill, final fill, generated/downlinked data
                               ├── Per-ground-station: contact schedule tables
                               └── KPI summary: total downlinked data, total contact time
                                   (each asset's links must be individually acknowledged)

[ 2. Operator clicks "Commit SCOPE Communication Activities to SatOS" ]
               │
               ├──> POST /schedule/session/{session_id}/commit   ──> UI locks, progress bar
               │              │
               │              └──> Converts scheduled links → SatOS Activity + ScheduleEvent models
               │                   Pushes activities in batch to SatOS
               │                   Returns: { committed_links_count, created_activities_count }
               │
               └──> GET /tasks/initialize   ──> Refresh SatOS ground-truth baseline
                              │
                              └──> Green success banner: committed links + activities count
```

- **Step 1 (Staging & Review):** Pure client-side — no network request. The staging review panel renders per-satellite and per-ground-station link tables. Each link (from both the satellite and ground-station perspectives) must be individually acknowledged via checkboxes before the commit button unlocks.
- **Step 2 (Push to SatOS):**
    - **FastAPI:** `POST /schedule/session/{session_id}/commit` — transforms all scheduled `LinkBlock` objects into SatOS `Activity` and `ScheduleEvent` models and pushes them in batch.
    - After commit, `GET /tasks/initialize` reloads the fresh SatOS asset schedules into the frontend's state so the new activities appear on the timeline immediately.

---

## 3. Master API Mapping Table

| **Phase** | **Frontend Action / Trigger** | **FastAPI Endpoint** | **Execution Pattern** | **Downstream SatOS Interaction** |
|---|---|---|---|---|
| **Phase 1** | App mount — health check | `GET /status` | Synchronous REST (2 s polling) | None (backend self-check) |
| **Phase 1** | App mount — SatOS probe | `GET /satos/asset/list` | Synchronous REST (2 s polling) | Queries SatOS asset registry |
| **Phase 1** | Backend online — asset load | `GET /tasks/initialize` | Synchronous REST | Queries SatOS fleet + schedule data; caches result |
| **Phase 2** | "Launch SCOPE" — optional purge | `POST /utilities/satos/clear-scope-activities` | Synchronous REST | Deletes SCOPE activities from SatOS schedules |
| **Phase 2** | "Launch SCOPE" — purge done, refresh | `GET /tasks/initialize` | Synchronous REST | Re-loads SatOS baseline after purge |
| **Phase 2** | "Launch SCOPE" — orbit extraction | `POST /tasks/extract-overpasses` | Asynchronous task fork | Runs Orekit TLE propagation + geometry extraction |
| **Phase 2** | Progress polling — extraction | `GET /tasks/status/{task_id}` | Polling loop (1.2 s) | Reads live status from Python task store |
| **Phase 2** | Extraction complete — fetch result | `GET /tasks/status/{task_id}/result` | Synchronous REST | Returns propagation result + satellite tracks |
| **Phase 2** | "Launch SCOPE" — link filtering | `POST /tasks/filter-links` | Asynchronous task fork | Runs filter pipeline against SatOS baseline |
| **Phase 2** | Progress polling — filtering | `GET /tasks/status/{task_id}` | Polling loop (1.2 s) | Reads live status from Python task store |
| **Phase 2** | Filtering complete — fetch result | `GET /tasks/status/{task_id}/result` | Synchronous REST | Returns filtered link list |
| **Phase 3** | "Calculate Trade-Offs" | `POST /tasks/process-trade-offs` | Asynchronous task fork | Initializes in-memory SchedulingSession |
| **Phase 3** | Progress polling — scheduling | `GET /tasks/status/{task_id}` | Polling loop (1.2 s) | Reads scheduling progress from Python task store |
| **Phase 3** | Trade-off complete — fetch result | `GET /tasks/status/{task_id}/result` | Synchronous REST | Returns SessionPlanDTO |
| **Phase 4** | Override link (PIN / EXCLUDE / AUTO) | `POST /schedule/session/{session_id}/override` | Synchronous REST | Mutates session, re-runs forward simulation |
| **Phase 4** | Change scoring strategy | `POST /schedule/session/{session_id}/strategy` | Synchronous REST | Mutates session strategy, re-runs forward simulation |
| **Phase 5** | "Confirm Communication Schedule" | *(Client-side state transition)* | Local staging | Renders KPI summary, per-asset tables & buffer profiles |
| **Phase 5** | "Commit Activities to SatOS" | `POST /schedule/session/{session_id}/commit` | Synchronous REST | Converts LinkBlocks → Activities + ScheduleEvents, pushes to SatOS |
| **Phase 5** | Baseline synchronization | `GET /tasks/initialize` | Synchronous REST | Refreshes SatOS ground-truth asset schedules |
