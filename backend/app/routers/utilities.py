from datetime import datetime
from pydantic import UUID4
from fastapi import APIRouter, BackgroundTasks, HTTPException
from app.services import satos_connector
from app.repositories import AssetRepository
from app.models.tasks import OrbitEngineRequest

from app.models.satos import (
    AssetListResponse,
    AssetResponse,
    ScheduleEventsResponse,
    ActivitiesListResponse,
    UpdateSatelliteStateRequest,
    UpdateSatelliteStateDTO,
    UpdateSatelliteStateResponse,
    PushScheduledLinksRequest,
    PushScheduledLinksResponse,
)
from core.models.assets import (
    SatelliteStateInputDefinition,
    UpdateSatelliteStateConfig,
)

router = APIRouter(prefix="/utilities", tags=["SCOPE Utilities"])



@router.post("/schedule/push-scheduled-links", response_model=PushScheduledLinksResponse)
def satos_push_scheduled_links(request: PushScheduledLinksRequest):
    """
    Pushes scheduled links to SatOS as activities and schedule events.
    Ingests a raw list of ScheduledLink objects in the request body.
    """
    if not request.scheduled_links:
        return PushScheduledLinksResponse(
            status="success",
            message="No scheduled links provided in request.",
            pushed_links_count=0,
            pushed_activities_count=0,
            activities_uuids=[],
        )

    domain_links = [link_dto.to_domain() for link_dto in request.scheduled_links]

    try:
        activities = AssetRepository.push_scheduled_links_to_satos(domain_links)
        return PushScheduledLinksResponse(
            status="success",
            message=f"Successfully pushed {len(activities)} activities for {len(domain_links)} scheduled link(s) to SatOS.",
            pushed_links_count=len(domain_links),
            pushed_activities_count=len(activities),
            activities_uuids=[str(a.uuid) for a in activities],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to push activities to SatOS: {e}")
