**Parent:** [[Softwaresysteme Semesterprojekt]]

## 1. Operator User Storyboard

The development framework maps directly to the following five operational planning phases outlined by the mission planner's user story:

- **Phase 1: Initialization**
    The frontend is loaded, the user is presented a list of Satellites and Ground Stations which are available in the SatOS mission (Information from SatOS API `/satellites/list`), and the user is asked to select the relevant satellites and ground stations by making ticks. The user is asked to tick relevant filters for overpass extraction.
- **Phase 2: Launch**
    Under the selection, the user clicks a button 'Launch Communication Scheduler'. The UI updates from the selection window to the 3-windows overview, trade-off, and timeline. The UI should immediately show the currently available SatOS schedule (Information from SatOS API `/schedule`). A slow process shall be initiated for orbital propagation (PROPAGATE Satellite Orbits), overpass extraction (EXTRACT Sat-GS Overpasses), and potential link filtering (FILTER potential Communication Links based on Sat/GS availability and global rules). Continual progress reports shall be presented in text form in the overview window. When the math is done, the Overview UI section shall display all extracted potential communication links.
- **Phase 3: Trade-Off**
    The user clicks a button "Calculate Trade-Offs", starting a slow process where conflicts between the potential links are identified, scoring etc. is done. Continual progress reports shall be presented in text form in the trade-off section. When the math is done, the Overview UI table shall be updated with new trade-off information, and the Trade-Off UI section shall be populated with individual trade-off cards. The proposed system communication schedule based on highest scoring links in the trade-off is written into the Timeline UI section.
- **Phase 4: User Interaction**
    The user might click on a different link within a trade-off card. This triggers a background recalculation of the global scheduling timeline. _Correction: Because updating cascade constraints across the full scheduling horizon requires executing iterative dependency rules, this interaction is classified as a slow background process rather than an instantaneous turnaround._
- **Phase 5: Confirmation & SatOS Commit**
    The user clicks "Confirm Communication Schedule" to stage the schedule. The UI presents an aggregated review of all scheduled links per satellite and ground station, along with comprehensive data volume and buffer metrics. The operator then clicks "Commit SCOPE Communication Activities to SatOS" to initiate the actual push: the UI locks with an animated progress card, activities are generated and sent to SatOS in batch, the SatOS baseline is refreshed, and a green "Success" element displays the committed activity count.

## 2. Chronological Event Sequence Walkthrough & Visualizations

### Phase 1: Initialization

Upon loading the browser application, the React frontend builds the workspace configuration.

Plaintext

```
[ Operator Opens Application ]
               │
               └──> Line 1 (Instant): GET /satos/available-assets ──> Populates Checkbox Matrix
```

- **React Frontend Action:** Fires an instant asynchronous network request on component mount.
- **FastAPI Backend Request:** `GET http://localhost:8000/satos/available-assets`
- **Internal Python Action:** The FastAPI server catches the request, invokes the SatOS internal SDK session, and queries the remote SatOS asset registry database.
- **UI Update:** React receives the JSON asset array and dynamically populates the checkbox options for the operator.

### Phase 2: Launch

The operator clicks the "Launch Communication Scheduler" button. JavaScript asynchronous execution forks this singular interaction into two concurrent tracks to maintain UI responsiveness.

Plaintext

```
[ Operator clicks "Launch Communication Scheduler" ]
             │
             ├──> Line 1 (Instant): GET /satos/current-schedule ──> Populates Timeline View
             │
             └──> Line 2 (Instant): POST /tasks/orbit-processing ──> Gets Task ID
                                             │
                                             └──> Line 3 (Looping): GET /tasks/orbit-processing/{task_id} ──> Progress Text Updates
```

- **Track A (Fetch Existing Baseline):**
    - **React Frontend Action:** Dispatches a fast synchronous request to map baseline schedules.
    - **FastAPI Backend Request:** `GET http://localhost:8000/satos/current-schedule`
    - **Internal Python Action:** Synchronously asks the SatOS API for active `Sat PL-Activity` and `GS Non-Availability Activity` blocks.
    - **UI Update:** React clears the setup screen, mounts the 3-window panel dashboard, and draws existing operational blocks onto the timeline view immediately so the page is instantly interactive.
        
- **Track B (Trigger Heavy Computations):**
    - **React Frontend Action:** Concurrently issues a `POST` request containing the user's selection parameters.
    - **FastAPI Backend Request:** `POST http://localhost:8000/tasks/orbit-processing`
    - **Internal Python Action:** FastAPI delegates the slow orbit propagation and overpass extraction routines to a standalone `BackgroundTask` worker thread and instantly drops a receipt tracking handle back to the client.
    - **The Polling Loop:** React captures the tracking token `{"task_id": "prop_run_001"}` and initiates a background `setInterval` polling script hitting `GET http://localhost:8000/tasks/orbit-processing/prop_run_001` every 2 seconds.
    - **UI Update:** The loop feeds live text progress reports (e.g., _"Propagating VLEO-SAT-01..."_) directly into the overview window status logs. Once complete, raw potential communication links populate the interface tables.

### Phase 3: Trade-Off

The operator advances the pipeline into the scoring and policy evaluation block by clicking "Calculate Trade-Offs".

Plaintext

```
[ Operator clicks "Calculate Trade-Offs" ]
             │
             └──> Line 1 (Instant): POST /tasks/tradeoff-processing ──> Gets Optimization Task ID
                                             │
                                             └──> Line 2 (Looping): GET /tasks/tradeoff-processing/{task_id} ──> Trade-Off Logs
```

- **React Frontend Action:** Transmits a run execution request containing active link identifiers.
- **FastAPI Backend Request:** `POST http://localhost:8000/tasks/tradeoff-processing`
- **Internal Python Action:** Pushes conflict determination, linear scoring, and rule matching into a background thread, instantly dropping an optimization task tracking ID.
- **The Polling Loop:** React initializes an execution loop checking `GET http://localhost:8000/tasks/tradeoff-processing/trade_001` to continuously stream optimization telemetry text logs into the trade-off window.
- **UI Update:** Upon task resolution, the backend dumps a comprehensive JSON packet containing incompatible link groups, policy evaluation metrics, and the baseline optimal path proposition. React displays interactive conflict resolution cards and automatically renders color-coded schedule recommendations directly across the timeline.

### Phase 4: User Interaction

The operator clicks on an alternative option within a conflict card to override a specific automated system recommendation. Because checking downstream cascading impacts across the horizon requires computing nested dependency rules, this is structured as a slow asynchronous loop.

Plaintext

```
[ Operator Selects Alternative Link Option ]
             │
             └──> Line 1 (Instant): POST /tasks/schedule-recalculate ──> Gets Recalculation Task ID
                                             │
                                             └──> Line 2 (Looping): GET /tasks/schedule-recalculate/{task_id} ──> Timeline Re-plotting
```

- **React Frontend Action:** Transmits a fast state delta containing the modified manual override decision.
- **FastAPI Backend Request:** `POST http://localhost:8000/tasks/schedule-recalculate`
- **Internal Python Action:** FastAPI locks the manual user selection, registers a background thread to recalculate the cascading timeline delta, and quickly provides a unique task ID to the frontend.
- **The Polling Loop:** React sets an interval to query `GET http://localhost:8000/tasks/schedule-recalculate/recalc_001` every few seconds to safely evaluate the progress of downstream policy checks.
- **UI Update:** Once the background recalculation completes, the backend transmits the newly revised conflict state and schedule arrays back to React, updating the timeline graph and conflict visualizations across the system within the context of the user choice.

### Phase 5: Confirmation & SatOS Commit

The operator reviews the finalized planning timeline, stages the schedule, reviews the aggregated schedule and data volume summary, and approves the SatOS push.

Plaintext

```
[ 1. Operator clicks "Confirm Communication Schedule" ]
             │
             └──> React Stages Schedule: Displays KPI Summary, Per-Asset Link Tables & Buffer Profiles
                         │
[ 2. Operator clicks "Commit SCOPE Communication Activities to SatOS" ]
                         │
                         └──> POST /schedule/session/{session_id}/commit ──> UI Locks ──> Pushes Activities in Batch to SatOS
                                             │
                                             └──> GET /tasks/initialize ──> Refreshes SatOS Baseline ──> Green Success Banner
```

- **Step 1 (Staging & Review):**
    - **React Frontend Action:** Operator clicks "Confirm Communication Schedule".
    - **UI Update:** Opens the staged review panel displaying aggregated KPIs (total offloaded data volume, contact time), per-satellite tables with buffer profiles (peak/final levels, generated/downlinked data), and per-ground-station contact schedules.
- **Step 2 (Push to SatOS):**
    - **React Frontend Action:** Operator clicks "Commit SCOPE Communication Activities to SatOS".
    - **FastAPI Backend Request:** `POST http://localhost:8000/schedule/session/{session_id}/commit`
    - **Internal Python Action:** The server processes the approved scheduling matrix, converts scheduled links into SatOS `Activity` and `ScheduleEvent` models, and pushes them in batch to SatOS.
    - **UI Update:** React locks the workspace with a progress bar, calls `GET /tasks/initialize` to reload the updated SatOS ground truth, and displays a green "Success" banner confirming the committed links and created SatOS activities.

## 4. Master API Mapping Table

The interface layout below defines the contract and processing behavior across all application components:

| **Phase**   | **Frontend Action / Element**     | **FastAPI Endpoint**                             | **Execution Pattern** | **Downstream SatOS Interaction**                                |
| ----------- | --------------------------------- | ------------------------------------------------ | --------------------- | --------------------------------------------------------------- |
| **Phase 1** | App Mount / Initial Form          | `GET /satos/available-assets`                    | Synchronous REST      | Queries active fleet assets via `SatIOSession` SDK.             |
| **Phase 2** | Click "Launch Scheduler"          | `GET /satos/current-schedule`                    | Synchronous REST      | Pulls baseline tracking schedules from remote system.           |
| **Phase 2** | Parallel Background Thread        | `POST /tasks/orbit-processing`                   | Asynchronous Fork     | Triggers background loop for TLE propagation.                   |
| **Phase 2** | `setInterval` Progress Polling    | `GET /tasks/orbit-processing/{task_id}`          | Polling Loop          | Reads live status fields from Python memory.                    |
| **Phase 3** | Click "Calculate Trade-Offs"      | `POST /tasks/tradeoff-processing`                | Asynchronous Fork     | Spawns background worker loop for conflict analysis.            |
| **Phase 3** | `setInterval` Progress Polling    | `GET /tasks/tradeoff-processing/{task_id}`       | Polling Loop          | Reads status strings from local dictionary.                     |
| **Phase 4** | Click Conflict Card Option        | `POST /tasks/schedule-recalculate`               | Asynchronous Fork     | Initiates background cascade rule calculations across timeline. |
| **Phase 4** | `setInterval` Progress Polling    | `GET /tasks/schedule-recalculate/{task_id}`      | Polling Loop          | Reads dynamic recalculation progress from memory state.         |
| **Phase 5** | Click "Confirm Schedule"          | *(Client-side state transition)*                 | Local Staging         | Renders KPI metrics, per-asset tables & buffer profiles.        |
| **Phase 5** | Click "Commit Activities to SatOS"| `POST /schedule/session/{session_id}/commit`     | Synchronous REST      | Converts links to SatOS Activity models and pushes in batch.    |
| **Phase 5** | Baseline Synchronization          | `GET /tasks/initialize`                          | Synchronous REST      | Refreshes SatOS ground-truth asset schedules.                   |