from datetime import datetime
from pydantic import UUID4
from fastapi import APIRouter, BackgroundTasks, HTTPException
from app.services import satos_connector
from app.services.asset_repository import AssetRepository
from app.models.tasks import OrbitEngineRequest

from app.models.satos import (
    AssetListResponse,
    AssetResponse,
    ScheduleEventsResponse,
    ActivitiesListResponse,
)

router = APIRouter(prefix="/satos", tags=["SatOS REST Data"])

@router.get("/asset/list", response_model=AssetListResponse)
def satos_get_asset_list():
    return {"assets": satos_connector.satos_get_asset_list()}

@router.get("/asset/{asset_name}", response_model=AssetResponse)
def satos_get_asset(asset_name: str):
    return {"assets": satos_connector.satos_get_asset(asset_name)}

@router.get("/activities/list", response_model=ActivitiesListResponse)
def satos_get_activities_list(schedule_name: str):
    return {"activities": satos_connector.satos_get_activities_list(schedule_name)}

#@router.get("/schedule_events", response_model=ScheduleEventsResponse)
#def satos_get_schedule_events(
#    schedule_name: str | None = None, 
#    schedule_event_uuid: str | UUID4 | None = None,
#    start_time: datetime | None = None,
#    end_time: datetime | None = None
#):
#    return {"schedule_events": satos_connector.satos_get_schedule_events(schedule_name, schedule_event_uuid, start_time, end_time)}

