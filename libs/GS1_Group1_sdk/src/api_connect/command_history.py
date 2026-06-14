from pydantic import UUID4, UUID7
from libs.GS1_Group1_sdk.src.pydantic_models.command_state_history import CommandStateHistoryModel

from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession

prefix = "command_states"


def get_command_states(session: SatIOSession, command_uuid: UUID4 | UUID7) -> list[CommandStateHistoryModel]:
    """
    Get command states from the API

    :param command_uuid: UUID4, UUID7 to fetch the states for
    :param session: SatIOSession
    :return List of CommandStateHistoryModels
    :raises: HTTPError if the response was unsuccessful
    """
    response = session.get(endpoint=prefix, params={"command_uuid": command_uuid})
    response.raise_for_status()
    return [CommandStateHistoryModel.model_validate(cmd) for cmd in response.json()]
