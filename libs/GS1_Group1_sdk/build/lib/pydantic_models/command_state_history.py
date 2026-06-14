"""Pydantic models for the command state history."""

from pydantic import UUID4, UUID7, AwareDatetime, BaseModel, Field

from libs.GS1_Group1_sdk.src.pydantic_models.command import CommandState
from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import command_state_history_descriptions as desc


class CommandStateHistoryModel(BaseModel):
    """Entry of the command state history.

    Used to represent a state change of a command.
    """

    uuid: UUID4 | UUID7 = Field(description=desc.uuid)
    state: CommandState
    timestamp: AwareDatetime = Field(description=desc.timestamp)
    failed: bool = Field(description=desc.failed)
    command_uuid: UUID4 | UUID7 = Field(description=desc.command_uuid)
    parameter_1: int = Field(0, ge=0, le=(2**64) - 1, description=desc.parameter_1)
    parameter_2: int = Field(0, ge=0, le=(2**64) - 1, description=desc.parameter_2)
    reason: str = Field(default="", description=desc.reason)
