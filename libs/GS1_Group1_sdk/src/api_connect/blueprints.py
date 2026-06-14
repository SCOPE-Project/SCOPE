from http import HTTPStatus

from pydantic import UUID4, UUID7
from libs.GS1_Group1_sdk.src.pydantic_models.definitions.blueprints import ActivityBlueprint, ActivityBlueprintListItem
from requests import Response

from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession

prefix = "blueprints"


def post_blueprint(session: SatIOSession, blueprint: ActivityBlueprint) -> Response:
    """
    Post blueprint to the API

    :param session: SatIOSession
    :param blueprint: ActivityBlueprint, activity blueprint to post
    """
    return session.post(endpoint=prefix, data=blueprint.model_dump(mode="json"))


def get_blueprint_list(session: SatIOSession, schedule_name: str) -> list[ActivityBlueprintListItem]:
    """
    Get list of blueprints from the API

    :param schedule_name: Name of schedule
    :param session: SatIOSession
    :return: list of ActivityBlueprintListItem
    """

    response = session.get(endpoint=f"{prefix}/list", params={"schedule_name": schedule_name})
    response.raise_for_status()

    return [ActivityBlueprintListItem.model_validate(act) for act in response.json()]


def get_blueprint(
    session: SatIOSession,
    blueprint_uuid: UUID4 | UUID7,
    schedule_name: str,
) -> list[ActivityBlueprint] | None:
    """
    Get activity blueprints from the API

    :param session: SatIOSession
    :param blueprint_uuid: UUID4 or UUID7, UUID of the blueprint to fetch
    :param schedule_name: str, name of the schedule to fetch

    :return: list of ActivityBlueprint or None if blueprint was not found
    """
    resp = session.get(endpoint=prefix, params={"schedule_name": schedule_name, "uuid": blueprint_uuid})

    if resp.status_code in [HTTPStatus.NOT_FOUND.value, HTTPStatus.BAD_REQUEST.value]:
        # blueprint not found
        return None

    resp.raise_for_status()

    return [ActivityBlueprint.model_validate(act) for act in resp.json()]


def delete_blueprint(
    session: SatIOSession,
    blueprint_uuid: UUID4 | UUID7 | None = None,
    schedule_name: str | None = None,
) -> Response:
    """Delete blueprint from API.

    :param session: SatioSession
    :param blueprint_uuid: uuid of blueprint to delete
    :param schedule_name: name of schedule to delete blueprint from

    :returns response
    """

    return session.delete(endpoint=prefix, params={"uuid": blueprint_uuid, "schedule_name": schedule_name})
