**Parent:** [[Softwaresysteme Semesterprojekt]]

## 0. Top-Level Swimlane Diagram

High-level user flow across the **Operator**, **React Frontend**, and **FastAPI Backend + SatOS** layers structured by the 5 operator-centric phases.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SWIMLANE: OPERATOR                                                                                         │
│                                                                                                             │
│   [App Open] ──> [Phase 1: Configure] ─────> [Phase 2: Inspect] ───> [Phase 3: Resolve]                    │
│                  - Set assets, window,       ("what is now":          - [Calculate Trade-Offs]              │
│                    filters, buffer, strategy   map tracks, timeline     (review automated baseline plan)    │
│                  - Click [Launch SCOPE]        baseline, overpasses)                │                       │
│                    (triggers async pipeline)                                        ▼                       │
│                                                                       [Phase 4: Steer]                      │
│                                                                       - [Override PIN / EXCLUDE / AUTO]     │
│                                                                       - [Switch strategy / tune alpha]      │
│                                                                                     │                       │
│                                                                       [Phase 5: Commit]                     │
│                                                                       - [Confirm Schedule staging review]   │
│                                                                       - [Commit to SatOS]                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │                │                           │                │               │               │
          ▼                ▼                           ▼                ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SWIMLANE: REACT FRONTEND                                                                                   │
│                                                                                                             │
│  [Mount]       [Connection   [Asset &         [Transition     [Observe        [Poll trade-off [Sync override│
│  Health poll   Checks]       Sched. Display]  landing→        workspace:      status ->       & strategy    │
│  /status       /satos/asset  landing page     workspace:      map tracks,     populate        updates ->    │
│  /satos/asset  /list]        config form      pipeline logs:  timeline        drawer, cards,  instant       │
│  /list]                                       clear, extract, baseline,       buffer curves]  redraw]       │
│                                               filter]         overpasses]                     [Staged review│
│                                                                                               & ack checks] │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │                │                           │                                │               │
          ▼                ▼                           ▼                                ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SWIMLANE: FASTAPI BACKEND + SATOS                                                                          │
│                                                                                                             │
│  GET /status   GET /satos/   GET /tasks/      POST /utilities/ (Client-side   POST /tasks/    POST /schedule│
│                asset/list    initialize       satos/clear-     inspection,    process-        session/{id}/ │
│                              (cache or        POST /tasks/     no network     trade-offs      override      │
│                              SatOS init)      extract/filter   requests)      GET /tasks/     POST .../strat│
│                                               (async tasks)                   status/{id}     POST .../commi│
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Operator User Storyboard

The operational workflow maps directly to the following five operator-centric planning phases:

- **Phase 1: Configure**
    The frontend loads and immediately begins health-checking the backend (`GET /status`) and SatOS connectivity (`GET /satos/asset/list`). In parallel it triggers `GET /tasks/initialize` to load mission assets (satellites, ground stations, and their current SatOS schedules). The operator is presented with a rich landing-page configuration form covering: operator name, planning window (UTC or local), satellite and ground station selection, optional link-elevation and peak-elevation filters, per-satellite buffer configuration (capacity, start fill, generation rate, downlink rate), trade-off strategy selection (including scoring parameters), and an optional "Clear existing SCOPE activities before launch" toggle.
    Once satisfied with the parameters, the operator clicks **"Launch SCOPE"** (enabled only when all configuration requirements are met). The view transitions from the landing page to the workspace, executing the sequential background pipeline:
    1. *(Optional)* Clear existing SCOPE activities via `POST /utilities/satos/clear-scope-activities`, then refresh asset schedules via `GET /tasks/initialize`.
    2. **Orbit propagation & overpass extraction:** `POST /tasks/extract-overpasses` → poll `GET /tasks/status/{task_id}` → result (cached for identical inputs).
    3. **Link derivation & filtering:** `POST /tasks/filter-links` → poll `GET /tasks/status/{task_id}` → result. Filtered links populate the Overview table and the workspace initializes.

- **Phase 2: Inspect**
    Upon workspace entry, the operator inspects and verifies the baseline mission environment ("what is now") before initiating schedule generation:
    - **Map View:** Verifies satellite orbit propagation, ground tracks, and ground station visibility cones.
    - **Timeline View:** Assesses pre-existing SatOS baseline schedules, payload activities, and pre-scheduled blackout windows.
    - **Overview Table:** Surveys all extracted geometric overpasses, pass durations, and filtered candidate links.
    - **Integrity Validation:** Confirms the planning interval, initial buffer fills, and data validity to ensure the operational scenario is realistic and sound prior to solving.

- **Phase 3: Resolve**
    The operator clicks **"Calculate Trade-Offs"** in the Overview sidebar (enabled when filter run exists and buffer/strategy config is valid). A background task runs conflict identification, builds the conflict graph, runs multi-pass buffer forward simulation, and applies policy scoring: `POST /tasks/process-trade-offs` → poll `GET /tasks/status/{task_id}` → result.
    On completion, the backend returns the authoritative `SessionPlanDTO`. The operator evaluates the automated baseline resolution: examining conflict groups (Trade-Off cards in the Timeline drawer), initial link selections across the Overview and Timeline, and simulated satellite buffer curves ($D_s(t)$) for potential overflow warnings.

- **Phase 4: Steer**
    The operator interactively steers and optimizes the plan ("what will be") through in-situ controls:
    - **Link Overrides:** Clicking override controls on individual links in the Trade-Off drawer, Overview table, or Timeline tooltip (`PIN`, `EXCLUDE`, `AUTO`). Each click triggers a synchronous `POST /schedule/session/{session_id}/override` which re-runs forward simulation and returns an updated `SessionPlanDTO` immediately without polling.
    - **Strategy Switching & Hyperparameter Tuning:** Changing the active scoring strategy directly from the Timeline toolbar or Sidebar accordion (`buffer_overflow_avoidance`, `max_downlink_throughput`, `max_pass_duration`), or adjusting Urgency parameters ($\alpha$, exponent) via synchronous `POST /schedule/session/{session_id}/strategy`. Existing manual overrides are preserved across strategy switches.
    - **Visual Feedback:** The frontend instantly redraws rows, conflict cards, timeline bars, and storage buffer curves at 60 FPS.

- **Phase 5: Commit**
    The operator clicks **"Confirm Communication Schedule"** — a client-side state transition that opens the staged review panel showing per-satellite and per-ground-station link tables, data volume KPIs, and buffer profiles. Each asset's links must be individually acknowledged via checkboxes before the commit button unlocks.
    The operator then clicks **"Commit SCOPE Communication Activities to SatOS"**: `POST /schedule/session/{session_id}/commit`. The UI locks with a progress indicator while scheduled `LinkBlock`s are transformed into SatOS `Activity` and `ScheduleEvent` models and pushed in batch. On success, the frontend calls `GET /tasks/initialize` to refresh the SatOS ground truth and displays a green confirmation banner with committed link and activity counts.

---

## 2. Chronological Event Sequence Walkthrough & Visualizations

### Phase 1: Configure

Upon loading the browser application, the React frontend immediately checks connectivity and loads mission assets. The operator defines all scenario constraints and parameters, then triggers the background launch pipeline.

#### 1.1 Initial Mount & Landing-Page Configuration

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

#### 1.2 "Launch SCOPE" Pipeline Execution

The operator clicks **"Launch SCOPE"** after completing all configuration fields. The frontend transitions to the workspace view and runs the following sequential pipeline with live progress in the Overview panel:

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
    - **UI Update:** Filtered link table populates the Overview. The pipeline completes and the workspace transitions into the Inspect phase.

---

### Phase 2: Inspect

Upon workspace arrival, the operator pauses to inspect and verify the operational baseline ("what is now") before initiating schedule generation:

```
[ Operator in Workspace: Baseline Inspection ("What is now") ]
               │
               ├──> Map View:
               │         Visual inspection of 2D/3D satellite orbit propagation,
               │         ground tracks, station visibility cones, and ground station locations.
               │
               ├──> Timeline View:
               │         Visual inspection of pre-existing SatOS schedules (immutable baseline activities,
               │         payload operations, maintenance blocks).
               │
               ├──> Overview Table:
               │         Survey of extracted geometric overpass blocks and filtered candidate links
               │         (verifying durations, AOS/LOS timestamps, elevation profiles, data capacities).
               │
               └──> Quality & Interval Sanity Check:
                         Confirming temporal boundaries [T_start, T_end], satellite buffer initial fill states,
                         and verifying readiness to transition from "what is now" to "what will be".
```

- **Operator Action:** Visual survey and operational sanity check across Map, Timeline, and Overview components. No network mutations are dispatched during inspection.
- **React Frontend State:** Renders satellite ground tracks in Map View, renders baseline SatOS activities in Timeline View, and displays the candidate link inventory in Overview View.
- **FastAPI Backend State:** Idle. Propagation results (`PropagationResultRepository`) and candidate links (`LinkRepository`) remain cached and ready for session initialization.
- **Phase Transition:** Once the operator verifies that baseline conditions and intervals are sound, the operator clicks **"Calculate Trade-Offs"** in the sidebar, advancing the workflow to Phase 3.

---

### Phase 3: Resolve

The operator clicks **"Calculate Trade-Offs"** in the Overview sidebar (enabled when filter run exists and buffer/strategy config is valid).

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

### Phase 4: Steer

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
  - **Sidebar "Trade-Off Configuration" Accordion:** Changing the strategy dropdown in the configuration accordion also immediately triggers `POST /schedule/session/{session_id}/strategy`. For hyperparameter tuning (Urgency $\alpha$ and Urgency exponent under `buffer_overflow_avoidance`), an **"Apply Strategy to Session"** button submits the updated parameters synchronously without recalculating Phase 1 launch parameters.
- **Shared Override Behavior:**
  - User overrides (`PINNED`, `EXCLUDED`) are **shared and preserved** across strategy switches. Manual operator decisions are not lost or isolated; the solver reapplies existing constraints to the newly selected scoring objective.
- **Mutual Lockout:**
  - While `POST /schedule/session/{session_id}/strategy` is in flight (`updatingStrategy` state), override buttons across the Overview table, Timeline tooltip, and Trade-Off Drawer are disabled to prevent race conditions on the session state.
- **FastAPI:** Synchronously loads the `SchedulingSession` from `SchedulingSessionRepository`, mutates `active_scoring_strategy` and `scoring_parameters`, re-runs `active_scheduler.solve(...)` with the existing `user_overrides`, updates `current_plan` and `satellite_buffer_profiles`, and returns the updated `SessionPlanDTO`.
- **UI Update:** No background task or polling needed. The returned plan is applied synchronously via `applyAuthoritativeSessionPlan(...)`, redrawing Overview rows, Trade-Off cards, timeline bars, and buffer curves in a single pass.

---

### Phase 5: Commit

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
| **Phase 1: Configure** | App mount — health check | `GET /status` | Synchronous REST (2 s polling) | None (backend self-check) |
| **Phase 1: Configure** | App mount — SatOS probe | `GET /satos/asset/list` | Synchronous REST (2 s polling) | Queries SatOS asset registry |
| **Phase 1: Configure** | Backend online — asset load | `GET /tasks/initialize` | Synchronous REST | Queries SatOS fleet + schedule data; caches result |
| **Phase 1: Configure** | "Launch SCOPE" — optional purge | `POST /utilities/satos/clear-scope-activities` | Synchronous REST | Deletes SCOPE activities from SatOS schedules |
| **Phase 1: Configure** | "Launch SCOPE" — purge done, refresh | `GET /tasks/initialize` | Synchronous REST | Re-loads SatOS baseline after purge |
| **Phase 1: Configure** | "Launch SCOPE" — orbit extraction | `POST /tasks/extract-overpasses` | Asynchronous task fork | Runs Orekit TLE propagation + geometry extraction |
| **Phase 1: Configure** | Progress polling — extraction | `GET /tasks/status/{task_id}` | Polling loop (1.2 s) | Reads live status from Python task store |
| **Phase 1: Configure** | Extraction complete — fetch result | `GET /tasks/status/{task_id}/result` | Synchronous REST | Returns propagation result + satellite tracks |
| **Phase 1: Configure** | "Launch SCOPE" — link filtering | `POST /tasks/filter-links` | Asynchronous task fork | Runs filter pipeline against SatOS baseline |
| **Phase 1: Configure** | Progress polling — filtering | `GET /tasks/status/{task_id}` | Polling loop (1.2 s) | Reads live status from Python task store |
| **Phase 1: Configure** | Filtering complete — fetch result | `GET /tasks/status/{task_id}/result` | Synchronous REST | Returns filtered link list |
| **Phase 2: Inspect** | Baseline inspection & validation | *(Client-side state inspection)* | Local observation | Renders Map tracks, Timeline baseline, Overview table |
| **Phase 3: Resolve** | "Calculate Trade-Offs" | `POST /tasks/process-trade-offs` | Asynchronous task fork | Initializes in-memory SchedulingSession |
| **Phase 3: Resolve** | Progress polling — scheduling | `GET /tasks/status/{task_id}` | Polling loop (1.2 s) | Reads scheduling progress from Python task store |
| **Phase 3: Resolve** | Trade-off complete — fetch result | `GET /tasks/status/{task_id}/result` | Synchronous REST | Returns SessionPlanDTO |
| **Phase 4: Steer** | Override link (PIN / EXCLUDE / AUTO) | `POST /schedule/session/{session_id}/override` | Synchronous REST | Mutates session, re-runs forward simulation |
| **Phase 4: Steer** | Change scoring strategy | `POST /schedule/session/{session_id}/strategy` | Synchronous REST | Mutates session strategy, re-runs forward simulation |
| **Phase 5: Commit** | "Confirm Communication Schedule" | *(Client-side state transition)* | Local staging | Renders KPI summary, per-asset tables & buffer profiles |
| **Phase 5: Commit** | "Commit Activities to SatOS" | `POST /schedule/session/{session_id}/commit` | Synchronous REST | Converts LinkBlocks → Activities + ScheduleEvents, pushes to SatOS |
| **Phase 5: Commit** | Baseline synchronization | `GET /tasks/initialize` | Synchronous REST | Refreshes SatOS ground-truth asset schedules |

