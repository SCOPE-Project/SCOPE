from http import HTTPStatus

from pydantic import UUID4, UUID7
from pydantic_models.activity import ActivityInfoModel, ActivityModel
from requests import Response

from api_connect.satio_session import SatIOSession

prefix = "activities"


def post_activities(session: SatIOSession, activities: list[ActivityModel]) -> Response:
    """
    Post activities to the API

    :param session: SatIOSession
    :param activities: list[ActivityModel], list of activities to post
    """
    return session.post(endpoint=prefix, data=[act.model_dump(mode="json") for act in activities])


def put_activities(session: SatIOSession, activities: list[ActivityModel]) -> Response:
    """
    Put activities to the API

    :param session: SatIOSession
    :param activities: list[ActivityModel], list of activities to put
    """
    return session.put(endpoint=prefix, data=[act.model_dump(mode="json") for act in activities])


def get_activity_list(session: SatIOSession, schedule_name: str) -> list[ActivityInfoModel]:
    """
    Get list of activities from the API

    :param schedule_name: Name of schedule
    :param session: SatIOSession
    :return: list of ActivityInfoModel
    """

    response = session.get(endpoint=f"{prefix}/list", params={"schedule_name": schedule_name})
    response.raise_for_status()

    return [ActivityInfoModel.model_validate(act) for act in response.json()]


def get_activities(
    session: SatIOSession,
    activity_uuid: UUID4 | UUID7 | None = None,
    schedule_name: str | None = None,
) -> list[ActivityModel] | None:
    """
    Get activities from the API

    :param session: SatIOSession
    :param activity_uuid: UUID4 or UUID7, UUID of the activity to fetch
    :param schedule_name: str, name of the schedule to fetch

    :return: list of ActivityModels or None if activity was not found
    """

    if not any([activity_uuid, schedule_name]):
        raise ValueError("Either activity_uuid or schedule_name must be provided.")
    if activity_uuid is not None and schedule_name is not None:
        raise ValueError("Both activity_uuid and schedule_name cannot be provided.")
    if activity_uuid:
        resp = session.get(endpoint=prefix, params={"activity_uuid": activity_uuid})
    else:
        resp = session.get(endpoint=prefix, params={"schedule_name": schedule_name})

    if resp.status_code in [HTTPStatus.NOT_FOUND.value, HTTPStatus.BAD_REQUEST.value]:
        # activity not found
        return None

    resp.raise_for_status()

    return [ActivityModel.model_validate(act) for act in resp.json()]


def delete_activity(
    session: SatIOSession,
    activity_uuid: UUID4 | UUID7 | None = None,
) -> Response:
    """Delete activity from API.

    :param session: SatioSession
    :param activity_uuid: uuid of activity to delete

    :returns response
    """

    return session.delete(endpoint=prefix, params={"activity_uuid": activity_uuid})
