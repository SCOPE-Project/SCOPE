"""Contains all models to handle Commands."""

import re
from datetime import timedelta
from enum import IntEnum

from pydantic import UUID4, UUID7, AwareDatetime, BaseModel, Field, conlist, constr, model_validator
from typing_extensions import Self

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import command_descriptions as desc
from libs.GS1_Group1_sdk.src.pydantic_models.parameter import CommandParameterModel

from .definitions import VersionModel

rank_pattern = re.compile(r"^[A-Za-z]+$")


class RelativeInfoModel(BaseModel):
    """Model to handle relative execution / release info."""

    relativeTime: timedelta = Field(description=desc.relative_time)
    relativeUuid: UUID4 | UUID7 = Field(description=desc.relative_uuid)


class CommandState(IntEnum):
    """Possible states of a command."""

    EDITABLE = 0  # The command can be changed
    ALLOW_RELEASE = 1  # The command can no longer be edited and will be released
    GS_TC_BUILD = 3  # The command was build by the GS system
    RELEASED = 4  # The command has been released by the G/S
    SENT = 10  # The command was sent to the satellite
    RECEIVED = 80  # The command was received onboard
    QUEUED = 90  # The command was queued onboard
    ACCEPTED = 97  # The command was accepted onboard
    STARTED = 98  # The execution onboard started
    FINISHED = 99  # The execution has been finished onboard


class CommandModel(BaseModel, validate_assignment=True):
    """Model to handle commands."""

    absoluteExecutionTime: AwareDatetime | None = Field(default=None, description=desc.absolute_execution_time)
    absoluteReleaseTime: AwareDatetime | None = Field(default=None, description=desc.absolute_release_time)
    failed: bool | None = Field(default=False, description=desc.failed)
    uuid: UUID4 | UUID7 = Field(description=desc.uuid)
    id: str = Field(description=desc.cmd_id)
    name: str | None = Field(default="", description=desc.name)
    parameters: conlist(CommandParameterModel, min_length=0) = Field(default_factory=list, description=desc.parameters)
    relativeExecutionInfo: RelativeInfoModel | None = Field(default=None, description=desc.relative_execution_info)
    relativeReleaseInfo: RelativeInfoModel | None = Field(default=None, description=desc.relative_release_info)
    activityUuid: UUID4 | UUID7 = Field(description=desc.activity_uuid)
    state: CommandState = Field(default=CommandState.EDITABLE, description=desc.state)
    rank: constr(min_length=1, pattern=rank_pattern, to_lower=True) = Field(description=desc.rank)
    version: VersionModel = Field(description=desc.version)

    @model_validator(mode="after")
    def validate_keys_in_mapping(self) -> Self:
        """Check that all keys in the mapping are within the bounds."""
        if self.relativeReleaseInfo is not None and self.absoluteReleaseTime is not None:
            raise AssertionError("It is not possible to set relative and absolute release times")
        if self.relativeExecutionInfo is not None and self.absoluteExecutionTime is not None:
            raise AssertionError("It is not possible to set relative and absolute execution times")
        return self


class HistoryCommandModel(BaseModel):
    """Model to handle history commands entries."""

    name: str = Field(description="Name of the command")
    id: str = Field(description="ID (path) of the command")
    uuid: UUID4 | UUID7 = Field(description="UUID of the command")
    state: CommandState = Field(description="State of the command")
    failed: bool | None = Field(default=False, description="Flag if the command failed")
    version: VersionModel = Field(description="Version of the command")
    activity_uuid: UUID4 | UUID7 = Field(description="UUID of the activity the command belongs to")
    last_changed: AwareDatetime = Field(description="Time of the last change of the command")
    schedule_name: str = Field(description="Name of the schedule the command belongs to")
    executor: str | None = Field(default=None, description="Executor of the command")
    initiator: str = Field(description="Initiator of the command")
    activity_name: str = Field(description="Name of the activity the command belongs to")
    release_time: AwareDatetime | None = Field(default=None, description="Time of the release of the command")
