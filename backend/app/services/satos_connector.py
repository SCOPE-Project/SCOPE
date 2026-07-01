from api_connect.satio_session import SatIOSession
from api_connect.satellites import get_satellite_list
from api_connect.activities import get_activity_list
from api_connect.schedule_events import get_schedule_events
from pydantic import UUID4

def satos_get_satellite_list():
    with SatIOSession() as session:
        satellite_list = get_satellite_list(session)
        return {"satellites": [sat.name for sat in satellite_list]}

def satos_get_schedule_events(schedule_name: str | None = None, schedule_event_uuid: str | UUID4 | None = None):
    with SatIOSession() as session:
        schedule_events = get_schedule_events(session, schedule_name, schedule_event_uuid)
        return {"schedule_events": [event.model_dump(mode="json") for event in schedule_events]}

def satos_get_activities_list(schedule_name: str):
    with SatIOSession() as session:
        activities_list = get_activity_list(session, schedule_name)
        return {"activities": [activity.model_dump(mode="json") for activity in activities_list]}