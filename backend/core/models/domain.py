# /core/models/domain.py
from dataclasses import dataclass
from typing import List
from datetime import datetime

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
    ground_station_infos: List[GroundStationInformation]
    time_interval: TimeInterval