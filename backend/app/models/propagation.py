from pydantic import BaseModel
from typing import List, Dict
from core.models.domain import (
    PropagationMetadata,
    GlobalTrackPoint,
    OverpassProfilePoint,
    OverpassBlock,
    PropagationResult,
)
from core.orbit_engine.time_utils import to_utc_iso_string

class PropagationMetadataDTO(BaseModel):
    task_id: str  # Web layer representation uses task_id
    start_time: str
    end_time: str
    global_track_step_seconds: float
    overpass_profile_step_seconds: float

    @classmethod
    def from_domain(cls, domain: PropagationMetadata) -> "PropagationMetadataDTO":
        return cls(
            task_id=domain.run_id,  # Map run_id back to task_id for web compatibility
            start_time=to_utc_iso_string(domain.start_time),
            end_time=to_utc_iso_string(domain.end_time),
            global_track_step_seconds=domain.global_track_step_seconds,
            overpass_profile_step_seconds=domain.overpass_profile_step_seconds,
        )

class GlobalTrackPointDTO(BaseModel):
    timestamp: str
    position_gcrf_m: List[float]
    velocity_gcrf_mps: List[float]
    latitude_deg: float
    longitude_deg: float
    altitude_m: float

    @classmethod
    def from_domain(cls, domain: GlobalTrackPoint) -> "GlobalTrackPointDTO":
        return cls(
            timestamp=to_utc_iso_string(domain.timestamp),
            position_gcrf_m=domain.position_gcrf_m,
            velocity_gcrf_mps=domain.velocity_gcrf_mps,
            latitude_deg=domain.latitude_deg,
            longitude_deg=domain.longitude_deg,
            altitude_m=domain.altitude_m,
        )

class OverpassProfilePointDTO(BaseModel):
    timestamp: str
    latitude_deg: float
    longitude_deg: float
    altitude_m: float
    elevation_deg: float
    azimuth_deg: float
    range_m: float

    @classmethod
    def from_domain(cls, domain: OverpassProfilePoint) -> "OverpassProfilePointDTO":
        return cls(
            timestamp=to_utc_iso_string(domain.timestamp),
            latitude_deg=domain.latitude_deg,
            longitude_deg=domain.longitude_deg,
            altitude_m=domain.altitude_m,
            elevation_deg=domain.elevation_deg,
            azimuth_deg=domain.azimuth_deg,
            range_m=domain.range_m,
        )

class OverpassBlockDTO(BaseModel):
    overpass_id: str
    satellite_name: str
    groundstation_name: str
    start_time: str
    end_time: str
    duration_seconds: float
    max_elevation_deg: float
    high_res_trajectory: List[OverpassProfilePointDTO]

    @classmethod
    def from_domain(cls, domain: OverpassBlock) -> "OverpassBlockDTO":
        return cls(
            overpass_id=domain.overpass_id,
            satellite_name=domain.satellite_name,
            groundstation_name=domain.groundstation_name,
            start_time=to_utc_iso_string(domain.start_time),
            end_time=to_utc_iso_string(domain.end_time),
            duration_seconds=domain.duration_seconds,
            max_elevation_deg=domain.max_elevation_deg,
            high_res_trajectory=[
                OverpassProfilePointDTO.from_domain(p) for p in domain.high_res_trajectory
            ],
        )

class PropagationResultDTO(BaseModel):
    metadata: PropagationMetadataDTO
    global_tracks: Dict[str, List[GlobalTrackPointDTO]]
    overpass_blocks: List[OverpassBlockDTO]

    @classmethod
    def from_domain(cls, domain: PropagationResult) -> "PropagationResultDTO":
        return cls(
            metadata=PropagationMetadataDTO.from_domain(domain.metadata),
            global_tracks={
                traj.satellite_name: [GlobalTrackPointDTO.from_domain(pt) for pt in traj.track]
                for traj in domain.global_tracks
            },
            overpass_blocks=[
                OverpassBlockDTO.from_domain(block) for block in domain.overpass_blocks
            ],
        )
