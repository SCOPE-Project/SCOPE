from datetime import datetime
from api_connect.satio_session import SatIOSession
from api_connect.satellites import get_satellite_list, get_satellite
from api_connect.activities import get_activity_list

from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel
from pydantic import UUID4




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
    with SatIOSession() as session:
        return get_activity_list(session, schedule_name)