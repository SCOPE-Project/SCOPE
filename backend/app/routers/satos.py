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
    UpdateSatelliteStateRequest,
    UpdateSatelliteStateDTO,
    UpdateSatelliteStateResponse,
    PushScheduledLinksRequest,
    PushScheduledLinksResponse,
)
from core.models.domain import (
    SatelliteStateInputDefinition,
    UpdateSatelliteStateConfig,
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

@router.post("/satellites/update-satellite-state", response_model=UpdateSatelliteStateResponse)
def satos_update_satellite_states(request: UpdateSatelliteStateRequest | None = None):
    """
    Calculates initial RV-state vectors from Keplerian parameters (provided in body or default config)
    and updates the position_vector, velocity_vector, and state_timestamp variables in SatOS.
    """
    try:
        if request is not None and request.satellites:
            if request.epoch_utc is None:
                raise HTTPException(
                    status_code=400,
                    detail="epoch_utc is required when providing custom satellites."
                )
            definitions = [
                SatelliteStateInputDefinition(
                    name=s.name,
                    altitude_m=s.altitude_m,
                    eccentricity=s.eccentricity,
                    inclination_deg=s.inclination_deg,
                    ascending_node_longitude_deg=s.ascending_node_longitude_deg,
                    argument_of_periapsis_deg=s.argument_of_periapsis_deg,
                    mean_anomaly_deg=s.mean_anomaly_deg,
                )
                for s in request.satellites
            ]
            config = UpdateSatelliteStateConfig(epoch_utc=request.epoch_utc, satellites=tuple(definitions))
        else:
            config = satos_connector.load_update_state_config()

        states = satos_connector.update_and_post_satellite_states(config=config, dry_run=False)

        updated_dtos = [
            UpdateSatelliteStateDTO(
                name=state.name,
                epoch_utc=state.epoch_utc.isoformat(),
                raan_deg=state.raan_deg,
                position_m=state.position_m,
                velocity_m_s=state.velocity_m_s,
                reference_frame=state.reference_frame,
            )
            for state in states
        ]

        return UpdateSatelliteStateResponse(
            status="success",
            message=f"Successfully simulated and updated state vectors for {len(updated_dtos)} satellite(s) in SatOS.",
            updated_satellites=updated_dtos,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update satellite state in SatOS: {e}")


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


