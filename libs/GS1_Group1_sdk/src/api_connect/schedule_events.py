from pydantic_models.schedule_event import ScheduleEventModel
from requests import Response

from api_connect.satio_session import SatIOSession
from pydantic import UUID4

prefix = "schedule_events"


def get_schedule_events(session: SatIOSession, schedule_name: str | None = None, schedule_event_uuid: str | UUID4 | None = None) -> list[ScheduleEventModel]:
    """Get list of schedule events from the API.

    :param session: SatIOSession
    :param schedule_name: Name of the schedule
    :param schedule_event_uuid: UUID of the schedule event (string or UUID4)
    :return: list of ScheduleEventModel
    """
    response = session.get(endpoint=prefix, params={"schedule_name": schedule_name, "schedule_event_uuid": schedule_event_uuid})
    response.raise_for_status()

    return [ScheduleEventModel.model_validate(event) for event in response.json()]