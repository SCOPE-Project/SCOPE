# app/models/satos.py
from pydantic import BaseModel
from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel
from pydantic_models.schedule_event import ScheduleEventModel
from typing import Union
from core.models.domain import SatelliteInformation, GroundStationInformation

class AssetListResponse(BaseModel):
    assets: list[SatelliteInfoModel]

class AssetResponse(BaseModel):
    assets: SatelliteModel

class ScheduleEventsResponse(BaseModel):
    schedule_events: list[ScheduleEventModel]

class ActivitiesListResponse(BaseModel):
    activities: list[ActivityInfoModel]


# ==========================================
# Satellite State Simulation / Update DTOs
# ==========================================

from datetime import datetime
from typing import Optional

class SatelliteDefinitionDTO(BaseModel):
    name: str
    altitude_m: float
    eccentricity: float
    inclination_deg: float
    ascending_node_longitude_deg: float
    argument_of_periapsis_deg: float = 0.0
    mean_anomaly_deg: float = 0.0


class UpdateSatelliteStateRequest(BaseModel):
    epoch_utc: Optional[datetime] = None
    satellites: Optional[list[SatelliteDefinitionDTO]] = None


class UpdateSatelliteStateDTO(BaseModel):
    name: str
    epoch_utc: str
    raan_deg: float
    position_m: list[float]
    velocity_m_s: list[float]
    reference_frame: str


class UpdateSatelliteStateResponse(BaseModel):
    status: str
    message: str
    updated_satellites: list[UpdateSatelliteStateDTO]


# ==========================================
# Scheduled Links Push DTOs
# ==========================================

from core.models.domain import ScheduledLink, OverpassProfilePoint
from app.models.propagation import OverpassProfilePointDTO


class ScheduledLinkDTO(BaseModel):
    link_id: str
    satellite_name: str
    groundstation_name: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    max_elevation_deg: float
    high_res_trajectory: list[OverpassProfilePointDTO] = []

    def to_domain(self) -> ScheduledLink:
        return ScheduledLink(
            link_id=self.link_id,
            satellite_name=self.satellite_name,
            groundstation_name=self.groundstation_name,
            start_time=self.start_time,
            end_time=self.end_time,
            duration_seconds=self.duration_seconds,
            max_elevation_deg=self.max_elevation_deg,
            high_res_trajectory=[
                OverpassProfilePoint(
                    timestamp=datetime.fromisoformat(pt.timestamp) if isinstance(pt.timestamp, str) else pt.timestamp,
                    latitude_deg=pt.latitude_deg,
                    longitude_deg=pt.longitude_deg,
                    altitude_m=pt.altitude_m,
                    elevation_deg=pt.elevation_deg,
                    azimuth_deg=pt.azimuth_deg,
                    range_m=pt.range_m,
                )
                for pt in self.high_res_trajectory
            ],
        )

    @classmethod
    def from_domain(cls, domain: ScheduledLink) -> "ScheduledLinkDTO":
        return cls(
            link_id=domain.link_id,
            satellite_name=domain.satellite_name,
            groundstation_name=domain.groundstation_name,
            start_time=domain.start_time,
            end_time=domain.end_time,
            duration_seconds=domain.duration_seconds,
            max_elevation_deg=domain.max_elevation_deg,
            high_res_trajectory=[
                OverpassProfilePointDTO.from_domain(pt) for pt in domain.high_res_trajectory
            ],
        )


class PushScheduledLinksRequest(BaseModel):
    scheduled_links: list[ScheduledLinkDTO]


class PushScheduledLinksResponse(BaseModel):
    status: str
    message: str
    pushed_links_count: int
    pushed_activities_count: int
    activities_uuids: list[str] = []


