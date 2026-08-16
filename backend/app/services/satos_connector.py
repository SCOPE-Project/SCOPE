import json
from pathlib import Path
from requests import Response
from datetime import datetime, timezone
from api_connect.satio_session import SatIOSession
from api_connect.satellites import get_satellite_list, get_satellite, post_satellite
from api_connect.activities import get_activity_list, put_activities
from api_connect.schedule_events import get_schedule_events, put_schedule_events

from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel, ActivityModel
from pydantic_models.schedule_event import ScheduleEventModel
from pydantic_models.schedule_event_relation import ScheduleEventRelationModel

from pydantic import UUID4
from app.models.tasks import Activity
from core.models.domain import SatelliteStateInputDefinition, SatelliteState, UpdateSatelliteStateConfig
from core.astrodynamics.coordinates import generate_satellite_states

DEFAULT_UPDATE_STATE_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "update_state_config.json"




# =========================================
# SatOS REST Data API Connectors
# =========================================

# /satos/asset/list
def satos_get_asset_list() -> list[SatelliteInfoModel]:
    """
    Get list of assets from the API
    SatOS Connector to GET .../satellite/list
    
    :return: list[SatelliteInfoModel] list of satellites
    """
    try:
        session = SatIOSession.get_session()
        return get_satellite_list(session)
    except LookupError:
        with SatIOSession() as session:
            return get_satellite_list(session)

# /satos/asset
def satos_get_asset(asset_name: str) -> SatelliteModel:
    """
    Get asset from the SatOS API.
    SatOS Connector to GET .../satellite

    :param asset_name: Name of the satellite to fetch
    :return: SatelliteModel (single latest version)
    """
    try:
        session = SatIOSession.get_session()
        return get_satellite(session, satellite_name=asset_name)
    except LookupError:
        with SatIOSession() as session:
            return get_satellite(session, satellite_name=asset_name)

## /satos/schedule_events
#def satos_get_schedule_events(
#    schedule_name: str | None = None, 
#    schedule_event_uuid: str | UUID4 | None = None,
#    start_time: datetime | None = None,
#    end_time: datetime | None = None
#) -> list[ScheduleEventModel]:
#    """
#    Get schedule events from the SatOS API.
#    SatOS Connector to GET .../schedule_events
#
#    :param schedule_name: Name of the schedule
#    :param schedule_event_uuid: str or UUID4 of the schedule event
#    :param start_time: Fetch events after this time
#    :param end_time: Fetch events before this time
#    :return: list of ScheduleEventModel
#    """
#    with SatIOSession() as session:
#        return get_schedule_events(
#            session, 
#            schedule_name=schedule_name, 
#            schedule_event_uuid=schedule_event_uuid, 
#            start_time=start_time, 
#            end_time=end_time
#        )
#

# /satos/activities/list
def satos_get_activities_list(schedule_name: str) -> list[ActivityInfoModel]:
    """
    Get list of activities from the SatOS API for a given schedule
    SatOS Connector to GET .../activities/list

    :param schedule_name: Name of schedule
    :return: list of ActivityInfoModel
    ---
    Non-Implemented parameters are:
    param schedule_mode
    param only_mine
    param start_time
    param end_time
    """
    try:
        session = SatIOSession.get_session()
        return get_activity_list(session, schedule_name)
    except LookupError:
        with SatIOSession() as session:
            return get_activity_list(session, schedule_name)
        
# PUT /satos/schedule_events
def satos_put_schedule_events(schedule_events: list[ScheduleEventModel]) -> Response:
    """
    Update schedule events in the SatOS API.
    SatOS Connector to PUT .../schedule_events

    :param schedule_events: list of ScheduleEventModel to update
    :return: Response object
    """
    try:
        session = SatIOSession.get_session()
        return put_schedule_events(session, schedule_events)
    except LookupError:
        with SatIOSession() as session:
            return put_schedule_events(session, schedule_events)
        
# PUT /satos/activities
def satos_put_activities(activities: list[ActivityModel]) -> Response:
    """
    Update activities in the SatOS API.
    SatOS Connector to PUT .../activities

    :param activities: list of ActivityModel to update
    :return: Response object
    """
    try:
        session = SatIOSession.get_session()
        return put_activities(session, activities)
    except LookupError:
        with SatIOSession() as session:
            return put_activities(session, activities)
        
        


def push_activities_to_SatOS(activities: list[Activity]) -> None:
    """
    Push activities to the SatOS API.
    SatOS Connector to PUT .../activities

    :param activities: list of Acitivity to update
    """
    try:
        with SatIOSession():
            SatOS_schedule_events: list[ScheduleEventModel] = []
            SatOS_activities: list[ActivityModel] = []
            for activity in activities:
                SatOS_start_event = activity.start_event
                SatOS_end_event = activity.end_event
                SatOS_schedule_events.append(SatOS_start_event)
                SatOS_schedule_events.append(SatOS_end_event)
                
                SatOS_activity = ActivityModel(
                    uuid=activity.uuid,
                    scheduleName=activity.schedule_name,
                    initiator=activity.schedule_name,
                    executor=activity.schedule_name,
                    startEvent=ScheduleEventRelationModel(
                        eventUuid=activity.start_event.uuid,
                        relativeTime=0,
                    ),
                    endEvent=ScheduleEventRelationModel(
                        eventUuid=activity.end_event.uuid,
                        relativeTime=0,
                    )
                )
                SatOS_activities.append(SatOS_activity)
            
        satos_put_schedule_events(SatOS_schedule_events)
        satos_put_activities(SatOS_activities)
    except RuntimeError as e:
        print(f"Runtime Error: {e}")


# =========================================
# SatOS Satellite State Update
# =========================================

# POST /satos/satellite
def satos_post_satellite(satellite: SatelliteModel) -> Response:
    """
    Post updated satellite model to the SatOS API.
    SatOS Connector to POST .../satellite

    :param satellite: SatelliteModel to post
    :return: Response object
    """
    try:
        session = SatIOSession.get_session()
        return post_satellite(session, satellite)
    except LookupError:
        with SatIOSession() as session:
            return post_satellite(session, satellite)


def satos_update_satellite_state(
    satellite_name: str,
    position_m: list[float],
    velocity_m_s: list[float],
    epoch_utc: datetime,
    bump_patch: bool = True,
) -> SatelliteModel:
    """
    Fetch the satellite model, update its position, velocity, and timestamp variables,
    optionally bump the patch version, and post the updated model back to SatOS.
    """
    satellite = satos_get_asset(asset_name=satellite_name)

    found_pos = False
    found_vel = False
    found_time = False

    iso_timestamp = epoch_utc.astimezone(timezone.utc).isoformat()

    for var in satellite.variableDefinitions:
        if var.name == "position_vector" and var.matrixDefinition:
            var.matrixDefinition.defaultValue = [float(v) for v in position_m]
            found_pos = True
        elif var.name == "velocity_vector" and var.matrixDefinition:
            var.matrixDefinition.defaultValue = [float(v) for v in velocity_m_s]
            found_vel = True
        elif var.name == "state_timestamp" and var.timeDefinition:
            var.timeDefinition.defaultValue = iso_timestamp
            found_time = True

    if not (found_pos and found_vel and found_time):
        missing = []
        if not found_pos:
            missing.append("position_vector")
        if not found_vel:
            missing.append("velocity_vector")
        if not found_time:
            missing.append("state_timestamp")
        raise ValueError(
            f"Satellite {satellite_name!r} is missing required variable definition(s): {', '.join(missing)}"
        )

    if bump_patch and satellite.version:
        satellite.version.patch += 1

    response = satos_post_satellite(satellite)
    response.raise_for_status()
    return satellite


def load_update_state_config(
    config_path: str | Path | None = None,
) -> UpdateSatelliteStateConfig:
    """Load and validate a update state configuration from JSON."""
    path = Path(config_path) if config_path is not None else DEFAULT_UPDATE_STATE_CONFIG_PATH
    try:
        raw_config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Update state config not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in update state config {path}: {exc.msg}") from exc

    if not isinstance(raw_config, dict):
        raise ValueError("Update state config must be a JSON object.")

    epoch_value = raw_config.get("epoch_utc")
    if not isinstance(epoch_value, str):
        raise ValueError("Update state config field 'epoch_utc' must be a string.")

    try:
        parsed_epoch = datetime.fromisoformat(epoch_value)
        if parsed_epoch.tzinfo is None:
            raise ValueError("Epoch must include timezone information.")
        epoch_utc = parsed_epoch.astimezone(timezone.utc)
    except ValueError as exc:
        raise ValueError(
            f"Update state config field 'epoch_utc' must be an ISO 8601 timezone-aware datetime: {exc}"
        ) from exc

    satellite_values = raw_config.get("satellites")
    if not isinstance(satellite_values, list) or not satellite_values:
        raise ValueError("Update state config field 'satellites' must be a non-empty array.")

    satellites = []
    for index, satellite_value in enumerate(satellite_values):
        if not isinstance(satellite_value, dict):
            raise ValueError(f"Satellite at index {index} must be a JSON object.")
        try:
            satellites.append(SatelliteStateInputDefinition(**satellite_value))
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Invalid satellite definition at index {index}: {exc}"
            ) from exc

    return UpdateSatelliteStateConfig(
        epoch_utc=epoch_utc,
        satellites=tuple(satellites),
    )


def update_and_post_satellite_states(
    config: UpdateSatelliteStateConfig | None = None,
    dry_run: bool = False,
) -> list[SatelliteState]:
    """
    Generates Cartesian state vectors for all satellites in the config
    and updates their variables in SatOS.
    """
    if config is None:
        config = load_update_state_config()

    states = generate_satellite_states(config.epoch_utc, config.satellites)

    if not dry_run:
        for state in states.values():
            satos_update_satellite_state(
                satellite_name=state.name,
                position_m=state.position_m,
                velocity_m_s=state.velocity_m_s,
                epoch_utc=state.epoch_utc,
            )

        # Invalidate cached asset data in AssetRepository
        try:
            from app.services.asset_repository import AssetRepository
            AssetRepository._satellite_infos.clear()
            AssetRepository._raw_asset_models.clear()
            AssetRepository._initialized = False
        except Exception:
            pass

    return list(states.values())

