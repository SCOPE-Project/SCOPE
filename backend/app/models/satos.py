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

