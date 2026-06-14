from http import HTTPStatus

from pydantic import UUID4, UUID7
from libs.GS1_Group1_sdk.src.pydantic_models.command import CommandModel
from requests import Response

from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession

prefix = "commands"


def post_commands(session: SatIOSession, commands: list[CommandModel]) -> Response:
    """
    Post commands to the API

    :param commands: list of CommandModel to post
    :param session: SatIOSession
    """

    return session.post(endpoint=prefix, data=[cmd.model_dump(mode="json") for cmd in commands])


def get_commands(
    session: SatIOSession, activity_uuid: UUID4 | UUID7 | None = None, command_uuid: UUID4 | UUID7 | None = None
) -> list[CommandModel] | None:
    """
    Get all commands from the API

    :param activity_uuid: UUID4 to fetch commands for
    :param command_uuid: UUID4 to fetch command
    :param session: SatIOSession
    """

    if not any([activity_uuid, command_uuid]):
        raise ValueError("Either activity_uuid or command_uuid must be provided.")
    if activity_uuid is not None and command_uuid is not None:
        raise ValueError("Both activity_uuid and command_uuid cannot be provided.")
    if activity_uuid:
        resp = session.get(endpoint=prefix, params={"activity_uuid": activity_uuid})
    else:
        resp = session.get(endpoint=prefix, params={"command_uuid": command_uuid})

    if resp.status_code in [HTTPStatus.BAD_REQUEST.value, HTTPStatus.NOT_FOUND.value]:
        # command not found
        return None

    resp.raise_for_status()

    return [CommandModel.model_validate(cmd) for cmd in resp.json()]


def put_commands(session: SatIOSession, commands: list[CommandModel]) -> Response:
    """
    Put a command to the API

    :param commands: CommandModel to put
    :param session: SatIOSession
    """

    return session.put(endpoint=prefix, data=[cmd.model_dump(mode="json") for cmd in commands])


def delete_commands(session: SatIOSession, command_uuids: list[UUID4 | UUID7]) -> Response:
    """
    Delete a command from the API

    :param command_uuids: list of UUID4 or UUID7, of the commands to delete
    :param session: SatIOSession
    """

    return session.delete(endpoint=prefix, data=[str(uuid) for uuid in command_uuids])
