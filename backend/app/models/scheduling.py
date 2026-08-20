# app/models/scheduling.py
from datetime import datetime
from typing import List, Optional, Dict
from pydantic import BaseModel, Field

from core.models.scheduling import (
    LinkBlock,
    ScheduledLinkStatus,
    TradeOffGroup,
    BufferProfilePoint,
    BufferOverflowEvent,
    SatelliteBufferProfile,
    SchedulingSession,
)
from core.orbit_engine.time_utils import to_utc_iso_string


# ========================================
# Link & Filtering DTOs
# ========================================

class LinkBlockDTO(BaseModel):
    link_id: str
    overpass_id: str
    satellite_name: str
    groundstation_name: str
    start_time: str
    end_time: str
    duration_seconds: float
    max_elevation_deg: float
    estimated_data_capacity_mb: float
    is_eligible: bool
    eligibility_status: str
    ineligibility_reason: Optional[str] = None
    conflicting_activity_uuid: Optional[str] = None

    @classmethod
    def from_domain(cls, domain: LinkBlock) -> "LinkBlockDTO":
        return cls(
            link_id=domain.link_id,
            overpass_id=domain.overpass_id,
            satellite_name=domain.satellite_name,
            groundstation_name=domain.groundstation_name,
            start_time=to_utc_iso_string(domain.start_time),
            end_time=to_utc_iso_string(domain.end_time),
            duration_seconds=domain.duration_seconds,
            max_elevation_deg=domain.max_elevation_deg,
            estimated_data_capacity_mb=domain.estimated_data_capacity_mb,
            is_eligible=domain.is_eligible,
            eligibility_status=str(domain.eligibility_status.value if hasattr(domain.eligibility_status, "value") else domain.eligibility_status),
            ineligibility_reason=domain.ineligibility_reason,
            conflicting_activity_uuid=domain.conflicting_activity_uuid,
        )


class FilterResultDTO(BaseModel):
    filter_run_id: str
    orbit_engine_run_id: str
    total_links_count: int
    eligible_links_count: int
    baseline_blocked_links_count: int
    elevation_excluded_links_count: int
    links: List[LinkBlockDTO]


# ========================================
# Scheduling Session & Telemetry DTOs
# ========================================

class BufferProfilePointDTO(BaseModel):
    timestamp: str
    level_mb: float
    percentage: float
    event_type: str
    associated_id: Optional[str] = None

    @classmethod
    def from_domain(cls, domain: BufferProfilePoint) -> "BufferProfilePointDTO":
        return cls(
            timestamp=to_utc_iso_string(domain.timestamp),
            level_mb=domain.level_mb,
            percentage=domain.percentage,
            event_type=str(domain.event_type.value if hasattr(domain.event_type, "value") else domain.event_type),
            associated_id=domain.associated_id,
        )


class BufferOverflowEventDTO(BaseModel):
    start_time: str
    end_time: str
    lost_data_mb: float
    satellite_name: str

    @classmethod
    def from_domain(cls, domain: BufferOverflowEvent) -> "BufferOverflowEventDTO":
        return cls(
            start_time=to_utc_iso_string(domain.start_time),
            end_time=to_utc_iso_string(domain.end_time),
            lost_data_mb=domain.lost_data_mb,
            satellite_name=domain.satellite_name,
        )


class SatelliteBufferProfileDTO(BaseModel):
    satellite_name: str
    capacity_mb: float
    profile_points: List[BufferProfilePointDTO]
    overflow_events: List[BufferOverflowEventDTO]
    total_generated_mb: float
    total_downlinked_mb: float
    total_lost_mb: float
    final_level_mb: float
    peak_level_mb: float

    @classmethod
    def from_domain(cls, domain: SatelliteBufferProfile) -> "SatelliteBufferProfileDTO":
        return cls(
            satellite_name=domain.satellite_name,
            capacity_mb=domain.capacity_mb,
            profile_points=[BufferProfilePointDTO.from_domain(p) for p in domain.profile_points],
            overflow_events=[BufferOverflowEventDTO.from_domain(e) for e in domain.overflow_events],
            total_generated_mb=domain.total_generated_mb,
            total_downlinked_mb=domain.total_downlinked_mb,
            total_lost_mb=domain.total_lost_mb,
            final_level_mb=domain.final_level_mb,
            peak_level_mb=domain.peak_level_mb,
        )


class ScheduledLinkStatusDTO(BaseModel):
    link: LinkBlockDTO
    is_scheduled: bool
    override_state: str
    tradeoff_id: Optional[str] = None
    useful_data_offloaded_mb: float = 0.0
    rejection_reason: Optional[str] = None

    @classmethod
    def from_domain(cls, domain: ScheduledLinkStatus) -> "ScheduledLinkStatusDTO":
        return cls(
            link=LinkBlockDTO.from_domain(domain.link),
            is_scheduled=domain.is_scheduled,
            override_state=str(domain.override_state.value if hasattr(domain.override_state, "value") else domain.override_state),
            tradeoff_id=domain.tradeoff_id,
            useful_data_offloaded_mb=domain.useful_data_offloaded_mb,
            rejection_reason=domain.rejection_reason,
        )


class TradeOffGroupDTO(BaseModel):
    tradeoff_id: str
    start_time: str
    end_time: str
    link_ids: List[str]
    participating_satellites: List[str]
    participating_groundstations: List[str]
    is_trivial: bool

    @classmethod
    def from_domain(cls, domain: TradeOffGroup) -> "TradeOffGroupDTO":
        return cls(
            tradeoff_id=domain.tradeoff_id,
            start_time=to_utc_iso_string(domain.start_time),
            end_time=to_utc_iso_string(domain.end_time),
            link_ids=domain.link_ids,
            participating_satellites=domain.participating_satellites,
            participating_groundstations=domain.participating_groundstations,
            is_trivial=domain.is_trivial,
        )


class SessionPlanDTO(BaseModel):
    session_id: str
    filter_run_id: str
    active_scoring_strategy: str
    current_plan: Dict[str, ScheduledLinkStatusDTO]
    trade_off_groups: Dict[str, TradeOffGroupDTO]
    conflict_reasons: Dict[str, str]
    satellite_buffer_profiles: Dict[str, SatelliteBufferProfileDTO]

    @classmethod
    def from_domain(cls, domain: SchedulingSession) -> "SessionPlanDTO":
        return cls(
            session_id=domain.session_id,
            filter_run_id=domain.filter_run_id,
            active_scoring_strategy=domain.active_scoring_strategy,
            current_plan={
                link_id: ScheduledLinkStatusDTO.from_domain(status)
                for link_id, status in domain.current_plan.items()
            },
            trade_off_groups={
                tradeoff_id: TradeOffGroupDTO.from_domain(group)
                for tradeoff_id, group in domain.conflict_structure.trade_off_groups.items()
            },
            conflict_reasons=domain.conflict_structure.conflict_reasons,
            satellite_buffer_profiles={
                sat: SatelliteBufferProfileDTO.from_domain(prof)
                for sat, prof in domain.satellite_buffer_profiles.items()
            },
        )


class OverrideRequest(BaseModel):
    link_id: str
    override_state: str = Field(..., description="'auto', 'pinned', or 'excluded'")


class StrategyUpdateRequest(BaseModel):
    scoring_strategy: str
    urgency_alpha: Optional[float] = 0.0


class CommitResponseDTO(BaseModel):
    session_id: str
    committed_links_count: int
    created_activities_count: int
    status: str = "synchronized"
