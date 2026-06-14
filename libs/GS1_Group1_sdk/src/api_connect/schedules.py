from libs.GS1_Group1_sdk.src.pydantic_models.schedule import ScheduleInfoModel
from requests import Response

from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession

prefix = "schedules"


def get_schedules_list(session: SatIOSession) -> list[ScheduleInfoModel]:
    """Get list of schedules from the API.

    :param session: SatIOSession
    :return: list of ScheduleInfoModel
    """
    response = session.get(endpoint=f"{prefix}/list")
    response.raise_for_status()

    return [ScheduleInfoModel.model_validate(act) for act in response.json()]


def _delete_schedule(session: SatIOSession, schedule_name: str) -> Response:
    """Delete a schedule from the API.

    :param session: SatIOSession
    :param schedule_name: Name of the schedule to delete
    """
    return session.delete(endpoint=prefix, params={"schedule_name": schedule_name})
