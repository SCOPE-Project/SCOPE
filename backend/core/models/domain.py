# /core/models/domain.py
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Set, Optional
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from org.orekit.frames import TopocentricFrame

@dataclass
class SatelliteInformation:
    name: str
    position_r: List[float]
    velocity_v: List[float]
    state_timestamp: datetime

@dataclass
class GroundStationInformation:
    name: str
    latitude: float
    longitude: float
    min_link_elevation: float

@dataclass
class TimeInterval:
    start_time: datetime
    end_time: datetime

@dataclass
class OrbitPropagationTask:
    task_id: str
    satellite_infos: List[SatelliteInformation]
    groundstation_infos: List[GroundStationInformation]
    time_interval: TimeInterval

@dataclass
class PropagationMetadata:
    run_id: str
    start_time: datetime
    end_time: datetime
    global_track_step_seconds: float
    overpass_profile_step_seconds: float

@dataclass
class GlobalTrackPoint:
    timestamp: datetime
    position_gcrf_m: List[float]
    velocity_gcrf_mps: List[float]
    latitude_deg: float
    longitude_deg: float
    altitude_m: float

@dataclass
class OverpassProfilePoint:
    timestamp: datetime
    latitude_deg: float
    longitude_deg: float
    altitude_m: float
    elevation_deg: float
    azimuth_deg: float
    range_m: float

class LinkEligibilityStatus(str, Enum):
    ELIGIBLE = "eligible"
    BLOCKED_BY_BASELINE_ACTIVITY = "blocked_by_baseline"
    EXCLUDED_BY_PEAK_ELEVATION = "excluded_by_peak_elev"


class OverrideState(str, Enum):
    AUTO = "auto"
    PINNED = "pinned"
    EXCLUDED = "excluded"


@dataclass
class OverpassBlock:
    overpass_id: str
    satellite_name: str
    groundstation_name: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    max_elevation_deg: float
    high_res_trajectory: List[OverpassProfilePoint]


@dataclass
class LinkBlock:
    link_id: str
    satellite_name: str
    groundstation_name: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    max_elevation_deg: float
    overpass_id: str = ""
    estimated_data_capacity_mb: float = 0.0
    high_res_trajectory: List[OverpassProfilePoint] = field(default_factory=list)
    is_eligible: bool = True
    eligibility_status: LinkEligibilityStatus = LinkEligibilityStatus.ELIGIBLE
    ineligibility_reason: Optional[str] = None
    conflicting_activity_uuid: Optional[str] = None

@dataclass
class ScheduledLinkStatus:
    link: LinkBlock
    is_scheduled: bool
    override_state: OverrideState
    tradeoff_id: Optional[str] = None
    useful_data_offloaded_mb: float = 0.0
    rejection_reason: Optional[str] = None


@dataclass
class TradeOffGroup:
    tradeoff_id: str
    start_time: datetime
    end_time: datetime
    link_ids: List[str]
    participating_satellites: List[str]
    participating_groundstations: List[str]
    is_trivial: bool = False


@dataclass
class ConflictStructure:
    adjacency_list: Dict[str, Set[str]] = field(default_factory=dict)
    conflict_reasons: Dict[str, str] = field(default_factory=dict)
    trade_off_groups: Dict[str, TradeOffGroup] = field(default_factory=dict)
    link_to_group: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SatelliteBufferConfig:
    satellite_name: str
    capacity_mb: float
    initial_level_mb: float
    payload_generation_rate_mbps: float
    downlink_rate_mbps: float


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
    level_mb: float
    percentage: float
    event_type: BufferEventType
    associated_id: Optional[str] = None


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
    total_generated_mb: float = 0.0
    total_downlinked_mb: float = 0.0
    total_lost_mb: float = 0.0
    final_level_mb: float = 0.0
    peak_level_mb: float = 0.0


@dataclass
class SchedulingSession:
    session_id: str
    filter_run_id: str
    candidate_links: Dict[str, LinkBlock]
    user_overrides: Dict[str, OverrideState]
    satellite_configs: Dict[str, SatelliteBufferConfig]
    conflict_structure: ConflictStructure
    active_scoring_strategy: str
    current_plan: Dict[str, ScheduledLinkStatus] = field(default_factory=dict)
    satellite_buffer_profiles: Dict[str, SatelliteBufferProfile] = field(default_factory=dict)


@dataclass
class SatelliteTrajectory:
    satellite_name: str
    track: List[GlobalTrackPoint]

@dataclass
class PropagationResult:
    metadata: PropagationMetadata
    global_tracks: List[SatelliteTrajectory]
    overpass_blocks: List[OverpassBlock]

@dataclass
class GroundStationRuntimeContext:
    """Runtime link between a ground station and its Orekit topocentric frame."""
    groundstation_info: GroundStationInformation
    topocentric_frame: TopocentricFrame

@dataclass
class OverpassEvent:
    """Internal AOS/LOS event pair for one satellite and one ground station."""
    satellite_name: str
    groundstation_info: GroundStationInformation
    start_time: datetime
    end_time: datetime


# ==========================================
# Simulation and Astrodynamics Models
# ==========================================

APPROXIMATE_ECI_FRAME = "ECI (GMST-only GCRF approximation)"

@dataclass(frozen=True)
class SatelliteStateInputDefinition:
    """User-facing orbital elements for one satellite.

    altitude_m is the semi-major-axis height above Constants.R_E. All angles
    are in degrees, and ascending_node_longitude_deg is east-positive.
    """
    name: str
    altitude_m: float
    eccentricity: float
    inclination_deg: float
    ascending_node_longitude_deg: float
    argument_of_periapsis_deg: float = 0.0
    mean_anomaly_deg: float = 0.0

    def __post_init__(self) -> None:
        from math import isfinite
        if not self.name.strip():
            raise ValueError("Satellite name must not be empty.")

        numeric_values = (
            self.altitude_m,
            self.eccentricity,
            self.inclination_deg,
            self.ascending_node_longitude_deg,
            self.argument_of_periapsis_deg,
            self.mean_anomaly_deg,
        )
        if not all(isfinite(value) for value in numeric_values):
            raise ValueError("Satellite elements must contain only finite values.")

        if self.altitude_m <= 0.0:
            raise ValueError("altitude_m must be greater than zero.")
        if not 0.0 <= self.eccentricity < 1.0:
            raise ValueError("eccentricity must satisfy 0 <= e < 1.")
        if not 0.0 < self.inclination_deg < 180.0:
            raise ValueError(
                "inclination_deg must be between 0 and 180 degrees; "
                "equatorial orbits have no unique ascending node."
            )


@dataclass(frozen=True)
class SatelliteState:
    """Cartesian initial state generated at the shared scenario epoch."""
    name: str
    epoch_utc: datetime
    raan_deg: float
    rv: list[float] | tuple[float, ...]
    reference_frame: str = APPROXIMATE_ECI_FRAME

    def __post_init__(self) -> None:
        import numpy as np
        rv_arr = np.asarray(self.rv, dtype=np.float64).copy()
        if rv_arr.shape != (6,) or not np.all(np.isfinite(rv_arr)):
            raise ValueError("rv must be a finite six-element vector.")
        object.__setattr__(self, "rv", tuple(rv_arr.tolist()))

    @property
    def position_m(self) -> list[float]:
        return list(self.rv[:3])

    @property
    def velocity_m_s(self) -> list[float]:
        return list(self.rv[3:])


@dataclass(frozen=True)
class UpdateSatelliteStateConfig:
    """Shared scenario epoch and satellite definitions."""
    epoch_utc: datetime
    satellites: tuple[SatelliteStateInputDefinition, ...]
