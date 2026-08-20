# SCOPE Scheduling Architecture, Data Contracts & Functional Flow

**Document Version:** 2.0  
**Target Milestone:** Communication Scheduling Session Engine, Dedicated Filtering Pipeline & Interactive Trade-Off Architecture  
**Scope:** Local Python Backend (FastAPI, Orekit, Asset/Propagation/Link Repositories) and Local React Frontend  

---

## 1. System Overview & Architectural Paradigm

The **SCOPE** (Satellite Communication Overpass Planning Engine) scheduling subsystem bridges raw orbital geometry calculations from Orekit with operational activity execution in **SatOS**. 

### 1.1 Separation of Responsibilities
* **Frontend (React UI):** A responsive, client-side visualization and interaction environment. It renders the Multi-Asset Gantt Timeline, Trade-Off Cards, Conflict Enclosures, Satellite Storage Buffer Curves ($D_s(t)$), and visual indicators for both eligible and baseline-blocked candidate links. It dispatches operator override intents (`PIN`, `EXCLUDE`, `AUTO`) and filter configurations to the backend.
* **Backend (FastAPI & Core Engine):** The authoritative calculation engine. It runs the Orekit geometric propagation, executes the dedicated link filtering pipeline, evaluates SatOS baseline conflicts, builds the mathematical Conflict Graph, and runs the Multi-Pass Data Buffer Forward Simulator.

### 1.2 The High-Level Pipeline

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: ASSET & BASELINE INITIALIZATION                                               │
│ Queries SatOS SDK for asset metadata and existing immutable schedules (AssetRepo).     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: ORBIT PROPAGATION ENGINE (Orekit Core)                                        │
│ Calculates satellite global trajectories and raw geometric OverpassBlocks.             │
│ Stores results in PropagationResultRepository (indexed by orbit_engine_run_id).        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: DEDICATED LINK DERIVATION & FILTERING PIPELINE (Independent Step)             │
│ Endpoint: POST /tasks/filter-links                                                     │
│ Ingests: orbit_engine_run_id + Filter Parameters (min_aos_los, min_peak_elevation)     │
│ Queries: PropagationResultRepository (for Overpasses) & AssetRepository (for Baseline)│
│ - Trims head/tail by min_aos_los_elevation                                             │
│ - Filters passes failing min_peak_elevation                                            │
│ - Detects collisions with immutable SatOS activities -> marks is_eligible=False        │
│ Outputs: LinkBlock pool stored in LinkRepository (indexed by filter_run_id).           │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: IN-MEMORY SCHEDULING SESSION & TRADE-OFF SOLVER                               │
│ Endpoint: POST /tasks/process-trade-offs                                               │
│ Ingests: filter_run_id + Initial Buffer Levels + Scoring Strategy                      │
│ - Builds Conflict Graph on eligible links; partitions into TradeOffGroups (tradeoff_id)│
│ - Runs Multi-Pass Forward Simulation tracking satellite on-board data buffer D(t)      │
│ - Resolves initial optimal schedule & detects potential buffer overflows               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                        ┌───────────────────┴───────────────────┐
                        ▼                                       ▼
      ┌────────────────────────────────────┐ ┌────────────────────────────────────┐
      │ PHASE 5: INTERACTIVE STEERING      │ │ DYNAMIC RE-SOLVER (< 5 ms)         │
      │ - Operator Pins / Excludes links   │ │ - Enforces user overrides          │
      │ - Immediate Gantt / Card re-render │<┼──>- Re-simulates buffer curves D(t)│
      │ - Live overflow warning updates    │ │ - Cascades multi-pass priorities   │
      └─────────────────┬──────────────────┘ └────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: FINALIZATION & COMMIT TO SATOS                                                │
│ Transforms active scheduled LinkBlocks into SatOS Activity & ScheduleEvent models.     │
│ Pushes batch activities to SatOS server via SatIOSession connector.                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Domain Models & Data Structures

> [!NOTE]
> **Domain Model Replacement:** The `LinkBlock` domain class defined here **replaces** the previously existing `ScheduledLink` class in `core/models/domain.py`. It is the central object representing candidate communication links across filtering, trade-off, and scheduling.

```
                  ┌────────────────────────────────────────────────┐
                  │              SchedulingSession                 │
                  ├────────────────────────────────────────────────┤
                  │ - session_id: str                              │
                  │ - filter_run_id: str                           │
                  │ - candidate_links: dict[str, LinkBlock]        │
                  │ - user_overrides: dict[str, OverrideState]     │
                  │ - satellite_configs: dict[str, BufferConfig]   │
                  │ - conflict_structure: ConflictStructure        │
                  │ - current_plan: dict[str, ScheduledLinkStatus] │
                  │ - satellite_profiles: dict[str, BufferProfile] │
                  └───────────────────────┬────────────────────────┘
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
  ┌──────────────────┐          ┌──────────────────┐          ┌───────────────────┐
  │    LinkBlock     │          │ConflictStructure │          │  BufferProfile    │
  ├──────────────────┤          ├──────────────────┤          ├───────────────────┤
  │ - link_id        │          │ - adjacency_list │          │ - capacity_mb     │
  │ - is_eligible    │          │ - trade_off_grps │          │ - profile_points  │
  │ - elig_status    │          │ - link_to_group  │          │ - overflow_events │
  │ - sat_name       │          └──────────────────┘          │ - summary KPIs    │
  │ - gs_name        │                                        └───────────────────┘
  │ - start/end_time │
  │ - data_volume_mb │
  └──────────────────┘
```

### 2.1 Candidate Link & Eligibility Models

`LinkBlock` represents a candidate communication pass. Even if a link overlaps with an immutable SatOS activity, it is **not discarded silently**; it is preserved as an **ineligible link** so the UI can visually render the blocked opportunity with explanatory tooltips.

```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Set

class LinkEligibilityStatus(str, Enum):
    ELIGIBLE = "eligible"                                   # Available for scheduling
    BLOCKED_BY_BASELINE_ACTIVITY = "blocked_by_baseline"    # Collides with immutable SatOS activity
    EXCLUDED_BY_PEAK_ELEVATION = "excluded_by_peak_elev"    # Below min_peak_elevation threshold

class OverrideState(str, Enum):
    AUTO = "auto"           # Solved by scheduling algorithm
    PINNED = "pinned"       # User locked ON (Hard constraint = 1)
    EXCLUDED = "excluded"   # User locked OFF (Hard constraint = 0)

@dataclass(frozen=True)
class LinkBlock:
    link_id: str                                    # e.g., "link_sat1_gs1_001"
    overpass_id: str                                # Reference to parent OverpassBlock
    satellite_name: str
    groundstation_name: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    max_elevation_deg: float
    estimated_data_capacity_mb: float
    
    # Eligibility & Baseline Conflict Metadata
    is_eligible: bool = True                        # True if schedulable by Trade-Off engine
    eligibility_status: LinkEligibilityStatus = LinkEligibilityStatus.ELIGIBLE
    ineligibility_reason: Optional[str] = None      # e.g., "Collides with SatOS Imaging Activity 'OBS_01'"
    conflicting_activity_uuid: Optional[str] = None # UUID of blocking SatOS activity

@dataclass
class ScheduledLinkStatus:
    link: LinkBlock
    is_scheduled: bool
    override_state: OverrideState
    tradeoff_id: Optional[str] = None               # Assigned TradeOffGroup ID (if eligible)
    useful_data_offloaded_mb: float = 0.0
    rejection_reason: Optional[str] = None          # e.g., "Lost trade-off to Link_Sat2_GS1", "Ineligible link"
```

### 2.2 Conflict Graph & Trade-Off Group Structures

```python
@dataclass
class TradeOffGroup:
    tradeoff_id: str                           # e.g., "TOG-20260818-001"
    start_time: datetime                       # Earliest start_time of candidate links
    end_time: datetime                         # Latest end_time of candidate links
    link_ids: List[str]                        # Member eligible candidate links
    participating_satellites: List[str]
    participating_groundstations: List[str]
    is_trivial: bool                           # True if component size == 1 (No conflict)

@dataclass
class ConflictStructure:
    # Pairwise mutual exclusions: link_id -> {conflicting_link_ids}
    adjacency_list: Dict[str, Set[str]]
    
    # Conflict reasoning: (link_a, link_b) -> "GroundStation 'GS-1' overlap"
    conflict_reasons: Dict[str, str]
    
    # Connected components: tradeoff_id -> TradeOffGroup
    trade_off_groups: Dict[str, TradeOffGroup]
    
    # Reverse lookup: link_id -> tradeoff_id
    link_to_group: Dict[str, str]
```

### 2.3 Satellite Data Buffer State Model (SSR Lifecycle)

```python
@dataclass(frozen=True)
class SatelliteBufferConfig:
    satellite_name: str
    capacity_mb: float                          # Max buffer capacity (e.g., 2000.0 MB)
    initial_level_mb: float = 0.0               # Initial stored data at scenario start
    payload_generation_rate_mbps: float = 15.0  # Inflow rate during SatOS payload activity
    downlink_rate_mbps: float = 25.0            # Outflow rate during scheduled pass

class BufferEventType(str, Enum):
    SCENARIO_START = "start"
    PAYLOAD_START = "payload_start"
    PAYLOAD_END = "payload_end"
    DOWNLINK_START = "downlink_start"
    DOWNLINK_END = "downlink_end"
    OVERFLOW_OCCURRED = "overflow"

@dataclass
class BufferProfilePoint:
    timestamp: datetime
    level_mb: float                             # Stored data volume in MB
    percentage: float                           # level_mb / capacity_mb * 100
    event_type: BufferEventType
    associated_id: Optional[str] = None         # Activity UUID or Link ID

@dataclass
class BufferOverflowEvent:
    start_time: datetime
    end_time: datetime
    lost_data_mb: float
    satellite_name: str

@dataclass
class SatelliteBufferProfile:
    satellite_name: str
    capacity_mb: float
    profile_points: List[BufferProfilePoint] = field(default_factory=list)
    overflow_events: List[BufferOverflowEvent] = field(default_factory=list)
    
    # Summary KPIs
    total_generated_mb: float = 0.0
    total_downlinked_mb: float = 0.0
    total_lost_mb: float = 0.0
    final_level_mb: float = 0.0
    peak_level_mb: float = 0.0
```

### 2.4 The Complete In-Memory Planning Session

```python
@dataclass
class SchedulingSession:
    session_id: str
    filter_run_id: str                          # Links back to the source LinkRepository pool
    candidate_links: Dict[str, LinkBlock]       # All links (both eligible and baseline-blocked)
    user_overrides: Dict[str, OverrideState]    # link_id -> OverrideState
    satellite_configs: Dict[str, SatelliteBufferConfig]
    
    conflict_structure: ConflictStructure       # Built exclusively over eligible links
    active_scoring_strategy: str
    
    # Recalculated outputs
    current_plan: Dict[str, ScheduledLinkStatus]
    satellite_buffer_profiles: Dict[str, SatelliteBufferProfile]
```

---

## 3. Dedicated Repositories & State Management

To maintain a clean architectural separation, three dedicated in-memory repositories manage data across the pipeline:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. AssetRepository (app.services.asset_repository)                                     │
│    - Caches SatOS asset definitions (Satellites, Ground Stations)                      │
│    - Caches SatOS immutable baseline activities & schedules                            │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. PropagationResultRepository (core.repository.propagation_repository)                │
│    - Key: orbit_engine_run_id (UUID)                                                   │
│    - Holds: Raw PropagationResult (OverpassBlocks, SatelliteTrajectory global tracks) │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼ (POST /tasks/filter-links)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. LinkRepository (core.repository.link_repository) [NEW]                              │
│    - Key: filter_run_id (UUID)                                                         │
│    - Holds: List[LinkBlock] (Trimmed, quality-filtered, annotated with baseline status)│
│    - Source for both Timeline visualization and Trade-Off scheduling sessions          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Pass Scheduling & Scoring Engine

### 4.1 Detailed Breakdown of the Data-Urgency Score

When evaluating competing candidate links $L_i$ in a trade-off window at time $t$, the scheduler computes:

$$\text{Score}(L_i) = \text{UsefulData}(L_i) \times \left[ 1.0 + \alpha \cdot \left(\frac{D_s(t)}{D_{\text{max}, s}}\right)^2 \right]$$

#### Why this specific mathematical formulation?

1. **The Base Factor: $\text{UsefulData}(L_i)$ (Linear Yield)**
   $$\text{UsefulData}(L_i) = \min\left(D_s(t), \text{Rate}_{\text{down}, s} \times \text{Duration}(L_i)\right)$$
   * If a pass has 1000 MB of transmission capacity, but the satellite buffer only contains 200 MB, the pass yields only 200 MB of useful transmission. 
   * This naturally prevents the scheduler from wasting valuable ground station antenna time on satellites with near-empty buffers.

2. **The Buffer Fullness Ratio: $\left(\frac{D_s(t)}{D_{\text{max}, s}}\right) \in [0.0, 1.0]$**
   * Represents the instantaneous fill level of the satellite's Solid State Recorder (SSR).

3. **Why the Quadratic Exponent ($x^2$)?**
   * **At low buffer levels ($0\%\dots 40\%$):** $\left(\frac{D_s}{D_{\text{max}}}\right)^2 \approx 0.0\dots 0.16$. The multiplier remains close to $1.0$. The scheduler is relaxed and prioritizes links based purely on raw throughput and geometry.
   * **At critical buffer levels ($80\%\dots 100\%$):** $\left(\frac{D_s}{D_{\text{max}}}\right)^2 \approx 0.64\dots 1.0$. The multiplier sharply accelerates. This creates a non-linear "panic curve" where a nearly full satellite aggressively outbids competitors to dump its data before an overflow occurs.

4. **What is the $\alpha$ Parameter (The Urgency Sensitivity Dial)?**
   * $\alpha$ is a configurable weighting hyperparameter:
     * **$\alpha = 0.0$ (Throughput-Only Mode):** Ignores buffer fullness completely. Maximizes total megabytes downlinked across the constellation.
     * **$\alpha = 1.0$ (Balanced Mode):** A 100% full satellite receives double ($2.0\times$) the priority of a low-data satellite.
     * **$\alpha = 5.0\dots 10.0$ (Strict Anti-Overflow Mode):** Heavily penalizes any risk of data loss. Full satellites overpower all other scheduling criteria.

---

### 4.2 Dynamic Forward Simulation Loop

```
Data In Storage
     ▲
D_max├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (OVERFLOW CLIP)
     │                     /───\ (Payload Activity +ΔD)
     │                    /     \
     │                   /       \ (Downlink Pass 1 -ΔD)
     │       /──────────/         \
     │      / (Payload)            \──────────\
     │     /                                   \ (Downlink Pass 2 -ΔD)
  0  └────┴─────────────────────────────────────┴─────────────► Time (t)
```

1. **Merge Chronological Events:** Combine SatOS `Payload` activities and candidate `LinkBlock`s sorted by `start_time`.
2. **On Payload Activity:**
   $$\Delta D_{\text{gen}} = \text{Rate}_{\text{gen}, s} \times \text{Duration}_{\text{act}}$$
   $$D_s(t_{\text{end}}) = \min\left(D_{\text{max}, s}, D_s(t_{\text{start}}) + \Delta D_{\text{gen}}\right)$$
   If $D_s(t_{\text{start}}) + \Delta D_{\text{gen}} > D_{\text{max}, s}$, record a `BufferOverflowEvent`.
3. **On Trade-Off Window:**
   * Evaluate `Score(L_i)` for all active candidate links.
   * `PINNED` links are forced ON; conflicting links are forced OFF.
   * For `AUTO` links, schedule the highest-scoring compatible subset.
   * Deduct offloaded data: $D_s(t_{\text{end}}) = \max(0, D_s(t_{\text{start}}) - \text{UsefulData}(L_{\text{winner}}))$.

---

## 5. API Endpoints & Communication Contracts

```
[ FRONTEND ]                                                    [ BACKEND ]
     │                                                               │
     │── 1. POST /tasks/extract-overpasses ─────────────────────────>│ (Orbit propagation)
     │<── TaskReceiptResponse { task_id: "orbit_run_01" } ───────────│
     │                                                               │
     │── 2. POST /tasks/filter-links ───────────────────────────────>│ (Dedicated filtering step)
     │      Payload: { orbit_engine_run_id, min_peak_elevation, ...} │
     │<── FilterResponseDTO { filter_run_id, links_count, links } ───│ (Saves to LinkRepository)
     │                                                               │
     │── 3. POST /tasks/process-trade-offs ─────────────────────────>│ (Builds session & solves)
     │      Payload: { filter_run_id, initial_buffer_levels_mb, ...} │
     │<── TaskReceiptResponse { task_id: "session_01" } ─────────────│
     │                                                               │
     │── 4. POST /schedule/session/{id}/override ───────────────────>│ (Operator pins link)
     │      Payload: { "link_id": "L1", "state": "pinned" }          │ (Solves in < 2ms)
     │<── SessionPlanDTO { current_plan, satellite_profiles } ───────│
     │                                                               │
     │── 5. POST /schedule/session/{id}/commit ─────────────────────>│ (Pushes to SatOS)
     │<── CommitResponseDTO { committed_links_count } ───────────────│
```

### 5.1 Endpoint Specifications

#### 1. Execute Dedicated Link Derivation & Filtering
* **Endpoint:** `POST /tasks/filter-links`
* **Request Body:**
  ```json
  {
    "orbit_engine_run_id": "8f2a1b90-4c3e-4f12-a8bc-987654321000",
    "min_aos_los_elevation_deg": 5.0,
    "min_peak_elevation_deg": 15.0
  }
  ```
* **Internal Action:**
  1. Fetches raw `PropagationResult` from `PropagationResultRepository`.
  2. Fetches immutable baseline activities from `AssetRepository`.
  3. Trims overpass durations by `min_aos_los_elevation_deg`.
  4. Tags links failing `min_peak_elevation_deg` as `EXCLUDED_BY_PEAK_ELEVATION`.
  5. Identifies time overlaps with SatOS activities $\rightarrow$ sets `is_eligible = False` and `eligibility_status = BLOCKED_BY_BASELINE_ACTIVITY`.
  6. Stores all derived `LinkBlock`s in `LinkRepository` under `filter_run_id`.
* **Response Body (`FilterResultDTO`):**
  ```json
  {
    "filter_run_id": "filt-9988-7766-5544",
    "orbit_engine_run_id": "8f2a1b90-4c3e-4f12-a8bc-987654321000",
    "total_links_count": 24,
    "eligible_links_count": 18,
    "baseline_blocked_links_count": 4,
    "elevation_excluded_links_count": 2,
    "links": [
      {
        "link_id": "link_sat1_gs1_001",
        "overpass_id": "op_001",
        "satellite_name": "Sat1",
        "groundstation_name": "GS1",
        "start_time": "2026-08-18T10:00:00Z",
        "end_time": "2026-08-18T10:10:00Z",
        "duration_seconds": 600.0,
        "max_elevation_deg": 48.5,
        "estimated_data_capacity_mb": 1500.0,
        "is_eligible": true,
        "eligibility_status": "eligible",
        "ineligibility_reason": null
      },
      {
        "link_id": "link_sat1_gs2_001",
        "overpass_id": "op_002",
        "satellite_name": "Sat1",
        "groundstation_name": "GS2",
        "start_time": "2026-08-18T11:30:00Z",
        "end_time": "2026-08-18T11:40:00Z",
        "duration_seconds": 600.0,
        "max_elevation_deg": 32.0,
        "estimated_data_capacity_mb": 1500.0,
        "is_eligible": false,
        "eligibility_status": "blocked_by_baseline",
        "ineligibility_reason": "Collides with SatOS Payload Activity 'OBS_CALVAL_01'",
        "conflicting_activity_uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
      }
    ]
  }
  ```

---

#### 2. Initiate Trade-Off Scheduling Session
* **Endpoint:** `POST /tasks/process-trade-offs`
* **Request Body:**
  ```json
  {
    "filter_run_id": "filt-9988-7766-5544",
    "satellite_buffer_configs": {
      "Sat1": {
        "capacity_mb": 3000.0,
        "initial_level_mb": 200.0,
        "payload_generation_rate_mbps": 12.0,
        "downlink_rate_mbps": 50.0
      },
      "Sat2": {
        "capacity_mb": 5000.0,
        "initial_level_mb": 500.0,
        "payload_generation_rate_mbps": 20.0,
        "downlink_rate_mbps": 75.0
      }
    },
    "default_buffer_config": {
      "capacity_mb": 2000.0,
      "initial_level_mb": 0.0,
      "payload_generation_rate_mbps": 15.0,
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
* **Internal Action:**
  1. Fetches candidate links from `LinkRepository` by `filter_run_id`.
  2. Resolves per-satellite buffer configurations (`capacity_mb`, `initial_level_mb`, `payload_generation_rate_mbps`, `downlink_rate_mbps`) from user inputs and default fallbacks.
  3. Builds `ConflictStructure` over eligible links (`is_eligible == True`).
  4. Spawns `SchedulingSession` with unique `session_id`.
  5. Executes initial Multi-Pass Forward Simulation.
* **Response:** `TaskReceiptResponse` (`{ "task_id": "session-uuid-001", "status": "Queued" }`).

---

#### 3. Interactive Steering (Apply Override)
* **Endpoint:** `POST /schedule/session/{session_id}/override`
* **Execution:** Synchronous fast path ($< 5\text{ ms}$).
* **Request Body:**
  ```json
  {
    "link_id": "link_sat1_gs1_001",
    "override_state": "pinned"
  }
  ```
* **Response Body (`SessionPlanDTO`):**
  - Updated `current_plan` (map of link statuses).
  - Updated `satellite_buffer_profiles` (piecewise curve points + overflow events).
  - Delta changes (list of links whose scheduled state flipped).

---

#### 4. Commit Schedule to SatOS
* **Endpoint:** `POST /schedule/session/{session_id}/commit`
* **Processing:** Converts all scheduled links (`is_scheduled == True`) into SatOS `Activity` and `ScheduleEventModel` pairs, pushing them to the SatOS server via `push_activities_to_SatOS()`.

---

## 6. Frontend Visual Representation of Links

The React UI differentiates links based on their eligibility and scheduler state:

| Visual State | Appearance | Meaning |
| :--- | :--- | :--- |
| **🟢 Auto-Scheduled** | Solid vibrant green block | Algorithmic recommendation from forward simulator. |
| **🔒 Pinned (User Locked)** | Gold border with lock icon | Hard constraint forced ON by operator. |
| **❌ Excluded (User Banned)**| Hashed grey with exclusion cross | Hard constraint forced OFF by operator. |
| **⚪ Unscheduled Opportunity** | Translucent outlined card | Eligible link that lost trade-off to a higher-scoring competitor. |
| **⛔ Blocked by Baseline** | Hatched dark red block with warning badge | Ineligible link due to collision with immutable SatOS activity. |
| **⚠️ Buffer Overflow Zone** | Red shaded vertical background region | Highlighted interval where satellite buffer exceeded capacity ($D(t) \ge D_{\text{max}}$). |

---

## 7. Complete End-to-End Sequence Walkthrough

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: INITIALIZATION                                                                │
│ 1. React mounts -> GET /tasks/initialize.                                              │
│ 2. Backend queries SatOS SDK, caches asset models & baseline schedule in AssetRepo.   │
│ 3. React populates asset selector checklist and draws immutable baseline activities.   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: ORBIT PROPAGATION                                                             │
│ 1. Operator selects assets, time horizon [T_start, T_end] -> "Launch Engine".          │
│ 2. POST /tasks/extract-overpasses triggers Orekit propagation task.                    │
│ 3. PropagationResult stored in PropagationResultRepository (orbit_engine_run_id).     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: DEDICATED LINK DERIVATION & FILTERING                                         │
│ 1. Operator sets filter sliders (min elevation, min peak) -> "Apply Filters".          │
│ 2. POST /tasks/filter-links trims passes & evaluates SatOS baseline activity overlaps.│
│ 3. Derived LinkBlocks (both eligible & blocked) saved to LinkRepository.               │
│ 4. React timeline renders all candidate links (with distinct blocked styles).          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: TRADE-OFF SESSION & INITIAL OPTIMIZATION                                      │
│ 1. Operator clicks "Calculate Trade-Offs".                                             │
│ 2. POST /tasks/process-trade-offs builds Conflict Graph & TradeOffGroups (tradeoff_id). │
│ 3. Multi-Pass Forward Simulation calculates initial schedule & buffer curves D(t).     │
│ 4. React renders Trade-off cards, scheduled status badges, and buffer telemetry charts.│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: INTERACTIVE OPERATOR STEERING                                                 │
│ 1. Operator clicks "Pin" or "Exclude" on a candidate link.                             │
│ 2. POST /schedule/session/{id}/override updates override map.                          │
│ 3. Fast Forward Simulator re-evaluates all unlocked links and buffer state (< 5 ms).    │
│ 4. React updates Gantt status badges and re-draws storage curves D(t) at 60 FPS.       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 6: CONFIRMATION & SATOS COMMIT                                                   │
│ 1. Operator reviews buffer performance and clicks "Confirm Schedule".                  │
│ 2. POST /schedule/session/{id}/commit converts scheduled links into SatOS activities.  │
│ 3. Batch pushed to SatOS server; confirmation alert displayed in UI.                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
