# core/models/propagation.py
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING

from core.models.assets import (
    SatelliteInformation,
    GroundStationInformation,
    TimeInterval,
)

if TYPE_CHECKING:
    from org.orekit.frames import TopocentricFrame


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


@dataclass
class OverpassBlock:
    overpass_id: str
    start_time: datetime
    end_time: datetime
    overpass_name: str = ""
    satellite_name: str = ""
    groundstation_name: str = ""
    duration_seconds: float = 0.0
    max_elevation_deg: float = 0.0
    high_res_trajectory: List[OverpassProfilePoint] = field(default_factory=list)


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
