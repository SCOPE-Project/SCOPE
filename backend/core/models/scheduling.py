# core/models/scheduling.py
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import List, Dict, Set, Optional, Any

from core.models.propagation import OverpassProfilePoint


class LinkEligibilityStatus(str, Enum):
    ELIGIBLE = "eligible"
    BLOCKED_BY_BASELINE_ACTIVITY = "blocked_by_baseline"
    EXCLUDED_BY_PEAK_ELEVATION = "excluded_by_peak_elev"


class OverrideState(str, Enum):
    AUTO = "auto"
    PINNED = "pinned"
    EXCLUDED = "excluded"


@dataclass
class LinkBlock:
    link_id: str
    link_name: str = ""
    overpass_id: str = ""
    overpass_name: str = ""
    satellite_name: str = ""
    groundstation_name: str = ""
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_seconds: float = 0.0
    max_elevation_deg: float = 0.0
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


from core.models.activities import Activity


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
    asset_schedules: Dict[str, List[Activity]] = field(default_factory=dict)
    scoring_parameters: Dict[str, Any] = field(default_factory=dict)
