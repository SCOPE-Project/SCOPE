from requests import Response
from datetime import datetime
from api_connect.satio_session import SatIOSession
from api_connect.satellites import get_satellite_list, get_satellite
from api_connect.activities import get_activity_list, put_activities
from api_connect.schedule_events import get_schedule_events, put_schedule_events

from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel, ActivityModel
from pydantic_models.schedule_event import ScheduleEventModel
from pydantic_models.schedule_event_relation import ScheduleEventRelationModel

from pydantic import UUID4
from app.models.tasks import Activity



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
