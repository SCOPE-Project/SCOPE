# app/models/satos.py
from pydantic import BaseModel
from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel
from pydantic_models.schedule_event import ScheduleEventModel

class AssetListResponse(BaseModel):
    assets: list[SatelliteInfoModel]

class AssetResponse(BaseModel):
    assets: SatelliteModel

class ScheduleEventsResponse(BaseModel):
    schedule_events: list[ScheduleEventModel]

class ActivitiesListResponse(BaseModel):
    activities: list[ActivityInfoModel]