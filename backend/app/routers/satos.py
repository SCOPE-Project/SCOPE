from pydantic import UUID4
from fastapi import APIRouter, BackgroundTasks, HTTPException
from app.services import satos_connector
from app.models.tasks import OrbitRequest

router = APIRouter(prefix="/satos", tags=["SatOS REST Data"])

@router.get("/satellite/list")
def satos_get_satellite_list():
    return satos_connector.satos_get_satellite_list()

@router.get("/schedule_events")
def satos_get_schedule_events(schedule_name: str | None = None, schedule_event_uuid: str | UUID4 | None = None):
    return satos_connector.satos_get_schedule_events(schedule_name, schedule_event_uuid)