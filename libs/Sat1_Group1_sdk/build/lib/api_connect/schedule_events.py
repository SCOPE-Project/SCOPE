from datetime import datetime

from pydantic import UUID4
from pydantic_models.schedule_event import ScheduleEventModel

from api_connect.satio_session import SatIOSession
from requests import Response

prefix = "schedule_events"


def get_schedule_events(
    session: SatIOSession,
    schedule_name: str | None = None,
    schedule_event_uuid: str | UUID4 | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> list[ScheduleEventModel]:
    """Get list of schedule events from the API.
    :param session: SatIOSession
    :param schedule_name: Name of the schedule
    :param schedule_event_uuid: str or UUID4 of the schedule event
    :param start_time: Fetch events after this time
    :param end_time: Fetch events before this time
    :return: list of ScheduleEventModel
    """

    if schedule_event_uuid is not None and (start_time is not None or end_time is not None):
        raise ValueError("You can't use schedule_event_uuid and start_time or end_time at the same time.")

    params = {}

    if schedule_name is not None:
        params.update({"schedule_name": schedule_name})
    if schedule_event_uuid is not None:
        params.update({"schedule_event_uuid": schedule_event_uuid})
    if start_time is not None:
        params.update({"start_time": start_time})
    if end_time is not None:
        params.update({"end_time": end_time})

    response = session.get(
        endpoint=prefix,
        params=params,
    )
    response.raise_for_status()

    return [ScheduleEventModel.model_validate(event) for event in response.json()]

def put_schedule_events(session: SatIOSession, schedule_events: list[ScheduleEventModel]) -> Response:
    """
    Put activities to the API

    :param session: SatIOSession
    :param schedule_events: list[ScheduleEventModel], list of schedule events to put
    """
    return session.put(endpoint=prefix, data=[event.model_dump(mode="json") for event in schedule_events])
