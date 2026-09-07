# SCOPE Scheduling Architecture, Data Contracts & Functional Flow

## 1. System Overview & Architectural Paradigm

The **SCOPE** (Satellite Communication Overpass Planning Engine) scheduling subsystem bridges raw orbital geometry calculations from Orekit with operational activity execution in **SatOS**. 

### 1.1 Separation of Responsibilities
* **Frontend (React UI):** A responsive, client-side visualization and interaction environment. It renders the Multi-Asset Gantt Timeline, Trade-Off Cards, Conflict Enclosures, Satellite Storage Buffer Curves ($D_s(t)$), and visual indicators for both eligible and baseline-blocked candidate links. It dispatches operator override intents (`PIN`, `EXCLUDE`, `AUTO`) and filter configurations to the backend.
* **Backend (FastAPI & Core Engine):** The authoritative calculation engine. It runs the Orekit geometric propagation, executes the dedicated link filtering pipeline, evaluates SatOS baseline conflicts, builds the mathematical Conflict Graph, and runs the Multi-Pass Data Buffer Forward Simulator.

### 1.2 The High-Level Pipeline

The operational workflow follows 5 operator-centric phases (**Configure** $\rightarrow$ **Inspect** $\rightarrow$ **Resolve** $\rightarrow$ **Steer** $\rightarrow$ **Commit**), supported by the underlying computational pipeline stages below:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR PHASE 1: CONFIGURE (STAGE 1: ASSET & BASELINE INITIALIZATION)                 │
│ Queries SatOS SDK for asset metadata and existing immutable schedules (AssetRepo).     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR PHASE 1: CONFIGURE (STAGE 2: ORBIT PROPAGATION ENGINE - Orekit Core)          │
│ Calculates satellite global trajectories and raw geometric OverpassBlocks.             │
│ Stores results in PropagationResultRepository (indexed by orbit_engine_run_id).        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR PHASE 1: CONFIGURE (STAGE 3: LINK DERIVATION & FILTERING PIPELINE)            │
│ Endpoint: POST /tasks/filter-links (Asynchronous Background Task)                      │
│ Ingests: orbit_engine_run_id + Filter Parameters (elevations, downlink rates)          │
│ Queries: PropagationResultRepository (for Overpasses) & AssetRepository (for Baseline)│
│ - Trims head/tail by min_aos_los_elevation                                             │
│ - Filters passes failing min_peak_elevation -> is_eligible=False, link_id=""           │
│ - Detects collisions with immutable SatOS activities -> is_eligible=True,              │
│   is_available=False, eligibility_status=BLOCKED_BY_BASELINE_ACTIVITY                  │
│ Outputs: TaskReceiptResponse; on completion, LinkBlock pool stored in LinkRepository   │
│ (indexed by filter_run_id = task_id, with scenario start/end time window metadata).    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR PHASE 2: INSPECT (BASELINE OBSERVATION & SANITY VALIDATION)                   │
│ Operator enters workspace and surveys "what is now" without network mutations:         │
│ - Map View: orbital ground tracks & station coverage visibility cones                  │
│ - Timeline View: pre-existing SatOS baseline schedule & payload operations             │
│ - Overview Table: candidate link inventory, durations, and elevation profiles          │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ (Operator clicks "Calculate Trade-Offs")
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR PHASE 3: RESOLVE (IN-MEMORY SCHEDULING SESSION & TRADE-OFF SOLVER)            │
│ Endpoint: POST /tasks/process-trade-offs                                               │
│ Ingests: filter_run_id + Initial Buffer Levels + Scoring Strategy                      │
│ - Builds Conflict Graph on schedulable links (is_eligible & is_available);             │
│   partitions into TradeOffGroups (tradeoff_id)                                         │
│ - Runs Multi-Pass Forward Simulation tracking satellite on-board data buffer D(t)      │
│ - Resolves initial optimal schedule & detects potential buffer overflows               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                        ┌───────────────────┴───────────────────┐
                        ▼                                       ▼
      ┌────────────────────────────────────┐ ┌────────────────────────────────────┐
      │ OPERATOR PHASE 4: STEER            │ │ DYNAMIC RE-SOLVER (< 5 ms)         │
      │ - Operator Pins / Excludes links   │ │ - Enforces user overrides          │
      │ - Operator tunes scoring strategy  │ │ - Re-simulates buffer curves D(t)  │
      │ - Immediate Gantt / Card re-render │<┼──>- Cascades multi-pass priorities │
      │ - Live overflow warning updates    │ │ - Instant strategy re-weighting    │
      └─────────────────┬──────────────────┘ └────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR PHASE 5: COMMIT (FINALIZATION & COMMIT TO SATOS)                              │
│ Staged review & acknowledgment -> transforms active LinkBlocks into SatOS models.      │
│ Pushes batch activities via AssetRepository.push_activities_to_satos().                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Domain Models & Data Structures

> [!NOTE]
> **Domain Model Placement:** The `LinkBlock` domain class defined here is located in [`core/models/scheduling.py`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/backend/core/models/scheduling.py). It is the central object representing candidate communication links across filtering, trade-off, and scheduling.

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

#### 2.1 Candidate Link & Eligibility Models

`LinkBlock` represents a candidate communication pass. Even if a link overlaps with an immutable SatOS activity, it is **not discarded silently**; it is preserved as an **ineligible for scheduling (unavailable) link** so the UI can visually render the blocked opportunity with explanatory tooltips.

* `is_eligible`: Indicates whether the pass passes geometric elevation thresholds (`True` for both clear links and baseline-colliding links; `False` only for passes below elevation thresholds).
* `is_available`: Indicates whether the link is free from collisions with immutable baseline activities (`True` for schedulable links; `False` if overlapping a SatOS activity).
* `link_id`: Contiguous numerical ID (`"L_0001"`); set to empty string `""` only when `is_eligible` is `False`.

```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Set, Any
from core.models.propagation import OverpassProfilePoint
from core.models.activities import Activity

class LinkEligibilityStatus(str, Enum):
    ELIGIBLE = "eligible"                                   # Available for scheduling
    BLOCKED_BY_BASELINE_ACTIVITY = "blocked_by_baseline"    # Collides with immutable SatOS activity
    EXCLUDED_BY_PEAK_ELEVATION = "excluded_by_peak_elev"    # Below min_peak_elevation threshold

class OverrideState(str, Enum):
    AUTO = "auto"           # Solved by scheduling algorithm
    PINNED = "pinned"       # User locked ON (Hard constraint = 1)
    EXCLUDED = "excluded"   # User locked OFF (Hard constraint = 0)

@dataclass
class LinkBlock:
    link_id: str                                    # Numerical ID, e.g., "L_0001" (empty string "" if is_eligible is False)
    start_time: datetime
    end_time: datetime
    link_name: str = ""                             # Elaborate string, e.g., "link__sat1__gs1__filter_filt-998__0001"
    overpass_id: str = ""                           # Numerical reference, e.g., "OP_0001"
    overpass_name: str = ""                         # Elaborate overpass reference, e.g., "pass__sat1__gs1__001"
    satellite_name: str = ""
    groundstation_name: str = ""
    duration_seconds: float = 0.0
    max_elevation_deg: float = 0.0
    estimated_data_capacity_mb: float = 0.0
    high_res_trajectory: List[OverpassProfilePoint] = field(default_factory=list)
    
    # Eligibility & Baseline Conflict Metadata
    is_eligible: bool = True                        # True if geometrically sound (passes elevation thresholds)
    is_available: bool = True                       # True if no conflict with immutable SatOS schedule
    eligibility_status: LinkEligibilityStatus = LinkEligibilityStatus.ELIGIBLE
    ineligibility_reason: Optional[str] = None      # e.g., "Collides with SatOS Imaging Activity 'OBS_01'"
    conflicting_activity_uuid: Optional[str] = None # UUID of blocking SatOS activity

@dataclass
class ScheduledLinkStatus:
    link: LinkBlock
    is_scheduled: bool
    override_state: OverrideState
    tradeoff_id: Optional[str] = None               # Assigned TradeOffGroup ID (if eligible)
    score: float = 0.0                              # Computed priority score from scoring rule
    useful_data_offloaded_mb: float = 0.0
    incoming_buffer_mb: float = 0.0                 # Buffer volume at link start
    potential_data_downlink_mb: float = 0.0         # Max possible downlink during pass
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
    is_trivial: bool = False                   # True if component size == 1 (No conflict)

@dataclass
class ConflictStructure:
    # Pairwise mutual exclusions: link_id -> {conflicting_link_ids}
    adjacency_list: Dict[str, Set[str]] = field(default_factory=dict)
    
    # Conflict reasoning: (link_a, link_b) -> "GroundStation 'GS-1' overlap"
    conflict_reasons: Dict[str, str] = field(default_factory=dict)
    
    # Connected components: tradeoff_id -> TradeOffGroup
    trade_off_groups: Dict[str, TradeOffGroup] = field(default_factory=dict)
    
    # Reverse lookup: link_id -> tradeoff_id
    link_to_group: Dict[str, str] = field(default_factory=dict)
```

### 2.3 Satellite Data Buffer State Model (SSR Lifecycle)

```python
# System-wide default fallback values (defined in core.models.scheduling)
DEFAULT_BUFFER_CAPACITY_MB = 100_000.0            # 100 GB
DEFAULT_BUFFER_INITIAL_LEVEL_MB = 5_000.0         # 5 GB
DEFAULT_PAYLOAD_GENERATION_RATE_MBPS = 4.0        # MB/s
DEFAULT_DOWNLINK_RATE_MBPS = 25.0                 # MB/s

@dataclass(frozen=True)
class SatelliteBufferConfig:
    satellite_name: str
    capacity_mb: float                          # Max buffer capacity in MB
    initial_level_mb: float                     # Initial stored data at scenario start in MB
    payload_generation_rate_mbps: float         # Inflow rate during SatOS payload activity in MB/s
    downlink_rate_mbps: float                   # Outflow rate during scheduled pass in MB/s

class BufferEventType(str, Enum):
    SCENARIO_START = "start"
    PAYLOAD_START = "payload_start"
    PAYLOAD_END = "payload_end"
    DOWNLINK_START = "downlink_start"
    DOWNLINK_END = "downlink_end"
    OVERFLOW_OCCURRED = "overflow"
    SCENARIO_END = "end"

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
    candidate_links: Dict[str, LinkBlock]       # All links (keyed by link_id)
    user_overrides: Dict[str, OverrideState]    # link_id -> OverrideState
    satellite_configs: Dict[str, SatelliteBufferConfig]
    conflict_structure: ConflictStructure       # Built over schedulable links (is_eligible & is_available)
    active_scoring_strategy: str
    scenario_start: datetime                    # Scenario window start boundary
    scenario_end: datetime                      # Scenario window end boundary
    
    # Recalculated outputs
    current_plan: Dict[str, ScheduledLinkStatus] = field(default_factory=dict)
    satellite_buffer_profiles: Dict[str, SatelliteBufferProfile] = field(default_factory=dict)
    asset_schedules: Dict[str, List[Activity]] = field(default_factory=dict)
    scoring_parameters: Dict[str, Any] = field(default_factory=dict)
```

---

## 3. Dedicated Repositories & State Management

To maintain a clean architectural separation and thread-safe operations, five dedicated in-memory repositories manage data across the pipeline:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. AssetRepository (app.repositories.asset_repository)                                 │
│    - Caches SatOS asset definitions (Satellites, Ground Stations)                      │
│    - Caches SatOS immutable baseline activities & schedules                            │
│    - Encapsulates SatOS push/delete operations                                         │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. PropagationResultRepository (app.repositories.propagation_repository)               │
│    - Key: orbit_engine_run_id (UUID)                                                   │
│    - Holds: Raw PropagationResult (OverpassBlocks, SatelliteTrajectory global tracks)  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼ (POST /tasks/filter-links)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. LinkRepository (app.repositories.link_repository)                                   │
│    - Key: filter_run_id (UUID)                                                         │
│    - Holds: List[LinkBlock] (Trimmed, quality-filtered, annotated with baseline status)│
│    - Metadata: orbit_engine_run_id, scenario start_time, scenario end_time             │
│    - Queryable via get_time_window(filter_run_id) for simulator boundary clamping      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼ (POST /tasks/process-trade-offs)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. SchedulingSessionRepository (app.repositories.scheduling_session_repository)        │
│    - Key: session_id (UUID)                                                            │
│    - Holds: Active in-memory SchedulingSession instances (solver state, overrides,     │
│             conflict graphs, buffer curves, scoring configurations)                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
┌───────────────────────────────────────────┴────────────────────────────────────────────┐
│ 5. TaskRepository (app.repositories.task_repository)                                   │
│    - Key: task_id (UUID)                                                               │
│    - Manages asynchronous task lifecycles, progress polling (0-100%), statuses,        │
│      and final computation payloads for all background workers                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Pass Scheduling & Scoring Engine

### 4.1 Detailed Breakdown of the Data-Urgency Score

When evaluating competing candidate links $L_i$ in a trade-off window at time $t$ under the default `buffer_overflow_avoidance` rule, the scheduler computes:

$$\text{Score}(L_i) = \text{UsefulData}(L_i) \times \left[ 1.0 + \alpha \cdot \left(\frac{D_s(t)}{D_{\text{max}, s}}\right)^\gamma \right]$$

#### Why this specific mathematical formulation?

1. **The Base Factor: $\text{UsefulData}(L_i)$ (Linear Yield)**
   $$\text{UsefulData}(L_i) = \min\left(D_s(t), \text{Rate}_{\text{down}, s} \times \text{Duration}(L_i)\right)$$
   * If a pass has 1000 MB of transmission capacity, but the satellite buffer only contains 200 MB, the pass yields only 200 MB of useful transmission. 
   * This naturally prevents the scheduler from wasting valuable ground station antenna time on satellites with near-empty buffers.

2. **The Buffer Fullness Ratio: $\left(\frac{D_s(t)}{D_{\text{max}, s}}\right) \in [0.0, 1.0]$**
   * Represents the instantaneous fill level of the satellite's Solid State Recorder (SSR).

3. **Configurable Exponent ($\gamma$, default $2.0$):**
   * **At low buffer levels ($0\%\dots 40\%$):** $\left(\frac{D_s}{D_{\text{max}}}\right)^\gamma \approx 0.0\dots 0.16$. The multiplier remains close to $1.0$. The scheduler is relaxed and prioritizes links based purely on raw throughput and geometry.
   * **At critical buffer levels ($80\%\dots 100\%$):** $\left(\frac{D_s}{D_{\text{max}}}\right)^\gamma \approx 0.64\dots 1.0$. The multiplier sharply accelerates. This creates a non-linear "panic curve" where a nearly full satellite aggressively outbids competitors to dump its data before an overflow occurs.

4. **The $\alpha$ Parameter (The Urgency Sensitivity Dial, default $2.0$):**
   * $\alpha$ is a configurable weighting hyperparameter:
     * **$\alpha = 0.0$ (Throughput-Only Mode):** Ignores buffer fullness completely. Maximizes total megabytes downlinked across the constellation.
     * **$\alpha = 1.0$ (Balanced Mode):** A 100% full satellite receives double ($2.0\times$) the priority of a low-data satellite.
     * **$\alpha = 5.0\dots 10.0$ (Strict Anti-Overflow Mode):** Heavily penalizes any risk of data loss. Full satellites overpower all other scheduling criteria.

#### Pluggable Scoring Strategy Registry (`SCORING_RULE_REGISTRY`)

The engine dynamically instantiates rules registered in `core.scheduling.strategy`:

| Strategy Key | Implementation Class | Description |
| :--- | :--- | :--- |
| `buffer_overflow_avoidance` | `BufferUrgencyScoringRule` | Non-linear urgency formula with configurable `alpha` and `exponent`. |
| `max_downlink_throughput` | `ThroughputScoringRule` | Pure linear data maximization ($\text{Score} = \text{UsefulData}$). |
| `max_pass_duration` | `DurationScoringRule` | Contact duration maximization ($\text{Score} = \text{DurationSeconds}$). |

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
     │── 1. POST /tasks/extract-overpasses ─────────────────────────>│ (Orbit propagation task)
     │<── TaskReceiptResponse { task_id: "orbit_run_01" } ───────────│
     │    [Poll GET /tasks/status/{id} -> GET /tasks/status/{id}/result]
     │                                                               │
     │── 2. POST /tasks/filter-links ───────────────────────────────>│ (Queues link filter task)
     │      Payload: { orbit_engine_run_id, min_peak_elevation, ...} │
     │<── TaskReceiptResponse { task_id: "filter_run_01" } ──────────│
     │    [Poll GET /tasks/status/{id} -> GET /tasks/status/{id}/result]
     │<── TaskResultResponse { payload: FilterResultDTO } ───────────│ (Saves to LinkRepository)
     │                                                               │
     │── 3. POST /tasks/process-trade-offs ─────────────────────────>│ (Queues session build & solve)
     │      Payload: { filter_run_id, satellite_buffer_configs, ...}│
     │<── TaskReceiptResponse { task_id: "session_01" } ─────────────│
     │    [Poll GET /tasks/status/{id} -> GET /tasks/status/{id}/result]
     │<── TaskResultResponse { payload: SessionPlanDTO } ────────────│ (Saves to SessionRepository)
     │                                                               │
     │── 4a. POST /schedule/session/{id}/override ──────────────────>│ (Operator pins / excludes link)
     │       Payload: { "link_id": "L_0001", "override_state": ... } │ (Fast solve < 5ms)
     │<─── SessionPlanDTO { current_plan, satellite_profiles, ... } ─│
     │                                                               │
     │── 4b. POST /schedule/session/{id}/strategy ──────────────────>│ (Operator updates scoring rule)
     │       Payload: { "name": "...", "parameters": {...} }         │ (Fast solve < 5ms)
     │<─── SessionPlanDTO { current_plan, satellite_profiles, ... } ─│
     │                                                               │
     │── 4c. GET /schedule/session/{id} ────────────────────────────>│ (Fetches active session state)
     │<─── SessionPlanDTO { current_plan, satellite_profiles, ... } ─│
     │                                                               │
     │── 5. POST /schedule/session/{id}/commit ─────────────────────>│ (Pushes schedule to SatOS)
     │      Payload: { "user": "operator_name" } (Optional)          │
     │<─── CommitResponseDTO { session_id, committed_links_count,    │
     │                         created_activities_count, status } ───│
```

### 5.1 Endpoint Specifications

#### 1. Execute Dedicated Link Derivation & Filtering
* **Endpoint:** `POST /tasks/filter-links` (Asynchronous Task)
* **Request Body (`FilterLinksRequest`):**
  ```json
  {
    "orbit_engine_run_id": "8f2a1b90-4c3e-4f12-a8bc-987654321000",
    "min_aos_los_elevation_deg": 5.0,
    "min_peak_elevation_deg": 15.0,
    "default_downlink_rate_mbps": 25.0,
    "satellite_downlink_rates_mbps": {
      "Sat1": 50.0
    }
  }
  ```
* **Internal Action:**
  1. Fetches raw `PropagationResult` from `PropagationResultRepository`.
  2. Fetches immutable baseline activities from `AssetRepository`.
  3. Trims overpass durations by `min_aos_los_elevation_deg`.
  4. Tags passes failing `min_peak_elevation_deg` as `EXCLUDED_BY_PEAK_ELEVATION` (`is_eligible = False`, `is_available = False`, `link_id = ""`).
  5. Identifies time overlaps with SatOS activities $\rightarrow$ sets `is_eligible = True`, `is_available = False`, and `eligibility_status = BLOCKED_BY_BASELINE_ACTIVITY`.
  6. Stores all derived `LinkBlock`s and scenario metadata (`orbit_engine_run_id`, `start_time`, `end_time`) in `LinkRepository` under `filter_run_id = task_id`.
* **Immediate Response:** `TaskReceiptResponse` (`{ "task_id": "filt-9988-7766-5544", "status": "Queued" }`).
* **Polled Task Result Payload (`FilterResultDTO`):**
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
        "link_id": "L_0001",
        "link_name": "link__sat1__gs1__filter_filt-998__0001",
        "overpass_id": "OP_0001",
        "overpass_name": "pass__sat1__gs1__001",
        "satellite_name": "Sat1",
        "groundstation_name": "GS1",
        "start_time": "2026-08-18T10:00:00Z",
        "end_time": "2026-08-18T10:10:00Z",
        "duration_seconds": 600.0,
        "max_elevation_deg": 48.5,
        "estimated_data_capacity_mb": 1500.0,
        "is_eligible": true,
        "is_available": true,
        "eligibility_status": "eligible",
        "ineligibility_reason": null,
        "conflicting_activity_uuid": null
      },
      {
        "link_id": "L_0002",
        "link_name": "link__sat1__gs2__filter_filt-998__0002",
        "overpass_id": "OP_0002",
        "overpass_name": "pass__sat1__gs2__001",
        "satellite_name": "Sat1",
        "groundstation_name": "GS2",
        "start_time": "2026-08-18T11:30:00Z",
        "end_time": "2026-08-18T11:40:00Z",
        "duration_seconds": 600.0,
        "max_elevation_deg": 32.0,
        "estimated_data_capacity_mb": 1500.0,
        "is_eligible": true,
        "is_available": false,
        "eligibility_status": "blocked_by_baseline",
        "ineligibility_reason": "Collides with immutable SatOS activity 'OBS_CALVAL_01' on Sat1",
        "conflicting_activity_uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
      }
    ]
  }
  ```

---

#### 2. Initiate Trade-Off Scheduling Session
* **Endpoint:** `POST /tasks/process-trade-offs` (Asynchronous Task)
* **Request Body (`TradeOffRequest`):**
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
      "capacity_mb": 100000.0,
      "initial_level_mb": 5000.0,
      "payload_generation_rate_mbps": 4.0,
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
  2. Resolves scenario time window (`start_time`, `end_time`) via `LinkRepository.get_time_window(filter_run_id)`.
  3. Resolves per-satellite buffer configurations from user inputs and default fallbacks.
  4. Builds `ConflictStructure` over schedulable candidate links (`is_eligible == True and is_available == True`).
  5. Spawns `SchedulingSession` with unique `session_id` and saves it in `SchedulingSessionRepository`.
  6. Executes initial Multi-Pass Forward Simulation.
* **Immediate Response:** `TaskReceiptResponse` (`{ "task_id": "session-uuid-001", "status": "Queued" }`).
* **Polled Task Result Payload:** `SessionPlanDTO`.

---

#### 3. Retrieve Active Scheduling Session
* **Endpoint:** `GET /schedule/session/{session_id}`
* **Response Body (`SessionPlanDTO`):**
  Returns the active plan, satellite configs, trade-off groups, conflict reasons, and simulated storage curves.

---

#### 4. Interactive Steering (Apply Override)
* **Endpoint:** `POST /schedule/session/{session_id}/override`
* **Execution:** Synchronous fast path ($< 5\text{ ms}$).
* **Request Body (`OverrideRequest`):**
  ```json
  {
    "link_id": "L_0001",
    "override_state": "pinned"
  }
  ```
* **Conflict Handling (Auto-Unpin):**
  - When setting `override_state = "pinned"`, any conflicting candidate links in the same `TradeOffGroup` that were previously pinned are **automatically unpinned** and reverted to `"auto"`.
  - Guarantees single-antenna asset consistency.
* **Response Body (`SessionPlanDTO`):**
  - Updated `current_plan` mapping link IDs to `ScheduledLinkStatusDTO` (including `incoming_buffer_mb` and `potential_data_downlink_mb`).
  - Updated `satellite_buffer_profiles` (piecewise curve points + overflow events).
  - Updated `trade_off_groups`, `conflict_reasons`, and configuration metadata.

---

#### 5. Dynamic Scoring Strategy Update
* **Endpoint:** `POST /schedule/session/{session_id}/strategy`
* **Execution:** Synchronous fast path ($< 5\text{ ms}$).
* **Request Body (`StrategyUpdateRequest`):**
  ```json
  {
    "name": "buffer_overflow_avoidance",
    "parameters": {
      "alpha": 3.5,
      "exponent": 2.0
    }
  }
  ```
* **Internal Action:** Updates active scoring strategy and hyperparameters in session, then triggers immediate forward simulation re-solve.
* **Response Body (`SessionPlanDTO`):** Recomputed schedule and buffer profiles under the new scoring rule.

---

#### 6. Commit Schedule to SatOS
* **Endpoint:** `POST /schedule/session/{session_id}/commit`
* **Request Body (`CommitRequestDTO`, Optional):**
  ```json
  {
    "user": "mission_operator_1"
  }
  ```
* **Processing:** Transforms all scheduled links (`is_scheduled == True`) into SatOS `Activity` and `ScheduleEventModel` pairs via `AssetRepository.create_activities_from_link_blocks()`, and pushes them via `AssetRepository.push_activities_to_satos()`.
* **Response Body (`CommitResponseDTO`):**
  ```json
  {
    "session_id": "session-uuid-001",
    "committed_links_count": 8,
    "created_activities_count": 8,
    "status": "synchronized"
  }
  ```

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
│ PHASE 1: CONFIGURE (INITIALIZATION & LAUNCH PIPELINE)                                  │
│ 1. React mounts -> GET /tasks/initialize loads SatOS assets & schedules to AssetRepo. │
│ 2. Operator configures window, assets, elevation masks, buffers, and strategy.         │
│ 3. Operator clicks "Launch SCOPE" -> optional clear-scope-activities purge.           │
│ 4. POST /tasks/extract-overpasses runs Orekit propagation (cached in repo).            │
│ 5. POST /tasks/filter-links runs elevation trimming & SatOS baseline conflict check.   │
│ 6. Derived LinkBlocks stored in LinkRepository; workspace opens.                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: INSPECT (BASELINE OBSERVATION & SANITY VALIDATION)                            │
│ 1. Operator enters workspace; visually surveys baseline reality ("what is now").       │
│ 2. Map View: validates satellite orbital tracks, ground stations, and visibility cones.│
│ 3. Timeline View: reviews pre-existing immutable SatOS schedule blocks & activities.   │
│ 4. Overview Table: verifies overpass inventory, durations, and candidate links.        │
│ 5. Operator confirms scenario interval & buffer sanity before solving.                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: RESOLVE (TRADE-OFF SESSION & INITIAL OPTIMIZATION)                            │
│ 1. Operator clicks "Calculate Trade-Offs" in Overview sidebar.                         │
│ 2. POST /tasks/process-trade-offs queues background solver task (TaskReceiptResponse). │
│ 3. React polls task result; session saved in SchedulingSessionRepository.              │
│ 4. Multi-Pass Forward Simulation calculates initial schedule & buffer curves D(t).     │
│ 5. React renders Trade-off cards in drawer, status badges, and buffer charts.          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: STEER (INTERACTIVE OPERATOR OVERRIDES & RE-SOLVER)                            │
│ 1. Operator pins/excludes links (/override) or tunes scoring strategy (/strategy).     │
│ 2. Fast Forward Simulator re-evaluates all unlocked links and buffer state (< 5 ms).    │
│ 3. React updates Gantt status badges and re-draws storage curves D(t) at 60 FPS.       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: COMMIT (STAGED REVIEW & SATOS COMMIT)                                         │
│ 1. Operator reviews buffer performance and clicks "Confirm Schedule".                  │
│ 2. Staged review panel opens; operator individually acknowledges asset links.         │
│ 3. POST /schedule/session/{id}/commit converts scheduled links into SatOS activities.  │
│ 4. Batch pushed to SatOS server via AssetRepository; baseline refresh sync.            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
