# app/models/satos.py
from datetime import datetime
from typing import Union, Optional, List
from pydantic import BaseModel, Field, ConfigDict, UUID4, UUID7

from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel, ActivityStatus
from pydantic_models.schedule_event import ScheduleEventModel

from core.models.assets import SatelliteInformation, GroundStationInformation
from core.models.scheduling import LinkBlock, OverpassProfilePoint
from core.models.activities import AssetSchedule
from app.models.propagation import OverpassProfilePointDTO


# ==========================================
# Asset Initialization & Query Models
# ==========================================

class AssetInformation(BaseModel):
    name: str
    eligible: bool
    classification: str  # "satellite", "groundstation", or "ineligible"
    details: Union[SatelliteInformation, GroundStationInformation, None] = None
    error: Optional[str] = None


class AssetInitializationResponse(BaseModel):
    assets: list[AssetInformation]
    schedules: list[AssetSchedule]


class AssetListResponse(BaseModel):
    assets: list[SatelliteInfoModel]


class AssetResponse(BaseModel):
    assets: SatelliteModel


class ScheduleEventsResponse(BaseModel):
    schedule_events: list[ScheduleEventModel]


class ActivitiesListResponse(BaseModel):
    activities: list[ActivityInfoModel]


class DeleteActivityResponse(BaseModel):
    status: str = "success"
    message: str
    deleted_activity: str


class DeleteActivitiesRequest(BaseModel):
    activity_uuids: list[UUID4 | UUID7] = []
    schedule_names: list[str] = []


class DeleteActivitiesResponse(BaseModel):
    status: str = "success"
    message: str
    deleted_count: int
    deleted_activities: list[str] = []
    schedules_cleared: dict[str, list[str]] = {}


class ClearScopeActivitiesRequest(BaseModel):
    schedule_names: list[str] = Field(
        default_factory=list,
        description="List of schedule names to clear SCOPE activities from.",
    )
    start_time: Optional[datetime] = Field(
        default=None,
        description="Optional start of time window filter (inclusive).",
    )
    end_time: Optional[datetime] = Field(
        default=None,
        description="Optional end of time window filter (inclusive).",
    )


class ClearScopeActivitiesResponse(BaseModel):
    status: str = "success"
    message: str
    deleted_count: int
    deleted_activities: list[str] = []
    schedules_cleared: dict[str, list[str]] = {}


# ==========================================
# Satellite State Simulation / Update DTOs
# ==========================================

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

class ScheduledLinkDTO(BaseModel):
    link_id: str
    link_name: Optional[str] = None
    overpass_id: Optional[str] = None
    overpass_name: Optional[str] = None
    satellite_name: str
    groundstation_name: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    max_elevation_deg: float
    high_res_trajectory: list[OverpassProfilePointDTO] = []

    def to_domain(self) -> LinkBlock:
        return LinkBlock(
            link_id=self.link_id,
            link_name=self.link_name or "",
            overpass_id=self.overpass_id or "",
            overpass_name=self.overpass_name or "",
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
    def from_domain(cls, domain: LinkBlock) -> "ScheduledLinkDTO":
        return cls(
            link_id=domain.link_id,
            link_name=domain.link_name,
            overpass_id=domain.overpass_id,
            overpass_name=domain.overpass_name,
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


# ==========================================
# Generic Activities Push DTOs
# ==========================================

class ActivityDTO(BaseModel):
    uuid: Optional[Union[UUID4, UUID7, str]] = None
    schedule_name: str
    start_time: datetime
    end_time: datetime
    name: str = ""
    description: str = ""
    priority: int = 0
    status: int = int(ActivityStatus.SUSPENDED)
    initiator: Optional[str] = None
    executor: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


ActivityInputDTO = ActivityDTO


class PushActivitiesRequest(BaseModel):
    activities: list[ActivityDTO] = []


class PushActivitiesResponse(BaseModel):
    status: str
    message: str
    pushed_activities_count: int
    activities_uuids: list[str] = []
