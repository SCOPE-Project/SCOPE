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
- **Phase 5: Confirmation**
    The user clicks a button "Confirm Communication Schedule". The UI is instantly locked, and a progress begins that takes the final schedule, generates all activity data objects, and makes the SatOS API calls to write the activities in the SatOS system schedule. After confirmation, a green "Success" UI element appears.

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

### Phase 5: Confirmation

The operator reviews the finalized planning timeline and approves the production template by clicking "Confirm Communication Schedule".

Plaintext

```
[ Operator clicks "Confirm Communication Schedule" ]
             │
             └──> Line 1 (Instant): POST /schedule/confirm ──> UI Locks ──> Formats & Executes SatOS Activity Pushes
```

- **React Frontend Action:** Instantly freezes all application interactive fields, locks scheduling screens, and shows a transmission status indicator to protect data integrity.
- **FastAPI Backend Request:** `POST http://localhost:8000/schedule/confirm`
- **Internal Python Action:** The server processes the approved scheduling matrix, loops through individual selections to construct strict SatOS-compliant activity data objects, and utilizes the operator's local configuration file credentials to push injections over the secure VPN tunnel.
- **UI Update:** Upon receiving a standard `200 OK` transaction confirmation code back from the server network loop, React safely releases the workspace and highlights a green "Success" notice component. The new schedule is now fully operational and natively visible within the remote `SatOS.plan` application window.

## 4. Master API Mapping Table

The interface layout below defines the contract and processing behavior across all application components:

| **Phase**   | **Frontend Action / Element**  | **FastAPI Endpoint**                        | **Execution Pattern** | **Downstream SatOS Interaction**                                |
| ----------- | ------------------------------ | ------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| **Phase 1** | App Mount / Initial Form       | `GET /satos/available-assets`               | Synchronous REST      | Queries active fleet assets via `SatIOSession` SDK.             |
| **Phase 2** | Click "Launch Scheduler"       | `GET /satos/current-schedule`               | Synchronous REST      | Pulls baseline tracking schedules from remote system.           |
| **Phase 2** | Parallel Background Thread     | `POST /tasks/orbit-processing`              | Asynchronous Fork     | Triggers background loop for TLE propagation.                   |
| **Phase 2** | `setInterval` Progress Polling | `GET /tasks/orbit-processing/{task_id}`     | Polling Loop          | Reads live status fields from Python memory.                    |
| **Phase 3** | Click "Calculate Trade-Offs"   | `POST /tasks/tradeoff-processing`           | Asynchronous Fork     | Spawns background worker loop for conflict analysis.            |
| **Phase 3** | `setInterval` Progress Polling | `GET /tasks/tradeoff-processing/{task_id}`  | Polling Loop          | Reads status strings from local dictionary.                     |
| **Phase 4** | Click Conflict Card Option     | `POST /tasks/schedule-recalculate`          | Asynchronous Fork     | Initiates background cascade rule calculations across timeline. |
| **Phase 4** | `setInterval` Progress Polling | `GET /tasks/schedule-recalculate/{task_id}` | Polling Loop          | Reads dynamic recalculation progress from memory state.         |
| **Phase 5** | Click "Confirm Schedule"       | `POST /schedule/confirm`                    | Synchronous REST      | Formats array items and executes direct script pushes.          |