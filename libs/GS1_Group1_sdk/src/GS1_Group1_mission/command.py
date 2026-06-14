"""Command class for the SDK."""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Literal, Optional
from uuid import UUID

from libs.GS1_Group1_sdk.src.api_connect.commands import get_commands, put_commands
from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession  # Managing the connection to sat:io
from pydantic import AwareDatetime
from libs.GS1_Group1_sdk.src.pydantic_models.command import CommandModel, CommandState, RelativeInfoModel

if TYPE_CHECKING:
    from .activity import SdkActivity

_logger = logging.getLogger(__name__)

MAX_TIMEOUT = 60


class SdkCommand:
    """A command is a single instruction to be executed on an asset."""

    def __init__(self, command_model: CommandModel, parent_activity: Optional["SdkActivity"] = None):
        """Initialize the command."""
        self._command_model = command_model
        self._parent_activity: SdkActivity | None = parent_activity

    def model_dump(self, mode: Literal["json", "python"] = "python") -> dict:
        """Return the activity model as a dictionary."""
        return self._command_model.model_dump(mode=mode)

    @property
    def _session(self) -> SatIOSession:
        """Get the session.

        :return: SatIOSession
        """
        return SatIOSession.get_session()

    @property
    def uuid(self) -> UUID:
        """Get the command UUID."""
        return self._command_model.uuid

    @property
    def activity_uuid(self) -> UUID:
        """Get the activity UUID."""
        return self._parent_activity.uuid

    @property
    def name(self) -> str:
        """Get the command name."""
        return self._command_model.name

    @name.setter
    def name(self, name: str) -> None:
        self._command_model.name = name

    @property
    def absolute_release_time(self) -> AwareDatetime | None:
        """Get the absolute release time of the command."""
        return self._command_model.absoluteReleaseTime

    @absolute_release_time.setter
    def absolute_release_time(self, absolute_release_time: AwareDatetime) -> None:
        """Set the absolute release time of the command."""
        self._command_model.absoluteReleaseTime = absolute_release_time
        self._conditional_commit()

    @property
    def absolute_execution_time(self) -> AwareDatetime | None:
        """Get the absolute execution time of the command."""
        return self._command_model.absoluteExecutionTime

    @absolute_execution_time.setter
    def absolute_execution_time(self, absolute_execution_time: AwareDatetime) -> None:
        self._command_model.absoluteExecutionTime = absolute_execution_time

    @property
    def relative_release_info(self) -> RelativeInfoModel | None:
        """Get the relative release info of the command."""
        return self._command_model.relativeReleaseInfo

    @relative_release_info.setter
    def relative_release_info(self, relative_release_info: RelativeInfoModel) -> None:
        """Set the relative release info of the command."""
        self._command_model.relativeReleaseInfo = relative_release_info
        self._conditional_commit()

    @property
    def state(self) -> CommandState:
        """Get the state of the command."""
        return self._command_model.state

    @property
    def failed(self) -> bool:
        """Get the failed status of the command."""
        return self._command_model.failed

    def release(
        self,
    ) -> "SdkCommand":
        """Execute the command.

        This will set the command to the allow release state.
        This state initiates the release of a command to the corresponding asset.
        The command with the release state with only be pushed to the backend
            if auto_commit for the parent activity is set to True.
        """
        if self._parent_activity is None:
            raise Exception("Command not attached to an activity. Use set_parent_activity() to attach it.")

        if self._command_model.state.value >= CommandState.ALLOW_RELEASE.value:
            raise Exception(f"Command {self._command_model.name} already set to release")

        self._command_model.state = CommandState.ALLOW_RELEASE

        self._conditional_commit()
        return self

    @classmethod
    def from_command_model(cls, model: CommandModel, parent_activity: Optional["SdkActivity"] = None) -> "SdkCommand":
        """Create a Command from a CommandModel."""
        return cls(command_model=model, parent_activity=parent_activity)

    def set_parent_activity(self, parent_activity: "SdkActivity") -> "SdkCommand":
        """Set the parent activity of the command.

        :param parent_activity: Activity, the parent activity

        :return: Command (self)
        """
        if parent_activity.schedule_name not in self._command_model.id:
            raise Exception("The activity and the command do not belong to the same schedule")
        self._parent_activity = parent_activity
        return self

    def set_execution_time(
        self,
        relative_execution_time: timedelta | None = None,
        relative_execution_uuid: str | UUID | None = None,
        absolute_execution_time: datetime | None = None,
    ) -> None:
        """Sets the execution time / condition.

                If all inputs are none it will clear all execution conditions (basically ASAP execution)

                Analog to set_release_time
        :param relative_execution_time: Timedelta to other command with uuid
        :param relative_execution_uuid: uuid of other command
        :param absolute_execution_time:Datetime of absolute execution time
        :return: None
        """
        if relative_execution_time is not None:
            if relative_execution_uuid is None:
                raise ValueError("Relative execution time requires the UUID of the command to be relative to")
            self._command_model.relativeExecutionInfo = RelativeInfoModel(
                relativeUuid=relative_execution_uuid
                if isinstance(relative_execution_uuid, UUID)
                else UUID(relative_execution_uuid),
                relativeTime=relative_execution_time,
            )
        elif absolute_execution_time is not None:
            self._command_model.absoluteReleaseTime = absolute_execution_time

        else:
            raise ValueError("At least one of the execution times must be set")

    def set_release_time(
        self,
        relative_release_time: timedelta | None = None,
        relative_release_uuid: str | UUID | None = None,
        absolute_release_time: datetime | None = None,
    ) -> None:
        """Sets the release times / condition.

                If all inputs are none it will remove all constraints
        :param relative_release_time: Timedelta to other command with uuid
        :param relative_release_uuid: uuid of other command
        :param absolute_release_time: Datetime of absolute release time
        :return: None
        """
        if relative_release_time is not None:
            if relative_release_uuid is None:
                raise ValueError("Relative release time requires the UUID of the command to be relative to")
            self._command_model.relativeReleaseInfo = RelativeInfoModel(
                relativeUuid=relative_release_uuid
                if isinstance(relative_release_uuid, UUID)
                else UUID(relative_release_uuid),
                relativeTime=relative_release_time,
            )
        elif absolute_release_time is not None:
            self._command_model.absoluteReleaseTime = absolute_release_time

        else:
            raise ValueError("At least one of the release times must be set")

        self._conditional_commit()

    def is_delete_allowed(self) -> bool:
        """Check if the command can be deleted."""
        return self.is_editable()

    def is_editable(self) -> bool:
        """Check if the command is in an editable state."""
        return self._command_model.state.value == CommandState.EDITABLE.value

    def _conditional_commit(self) -> None:
        """Commit the command if the parent activity is set to auto_commit."""
        if self._parent_activity is not None and self._parent_activity.auto_commit:
            self.commit()

    def commit(self) -> None:
        """Commit the command to the API if the parent_activity is set.

        :raises HTTPError: if the request was not successful
        """
        if self._parent_activity is None:
            raise Exception(
                "Command not attached to an activity. "
                "Use command.set_parent_activity(activity) or activity.add_command(command) to attach it."
            )
        resp = put_commands(session=self._session, commands=[self._command_model])
        resp.raise_for_status()

    def wait_for_state(self, state: CommandState, timeout: int = 10, interval: int = 1) -> "SdkCommand":
        """Wait for the command to reach a certain state.

        :param state: State, the state to wait for
        :param timeout: int, the maximum time to wait for the state
        :param interval: int, the interval to check the state

        :return: Command (self)
        :raises TimeoutError: if the command did not reach the state in time, max 60 seconds
        """
        if timeout > MAX_TIMEOUT:
            raise ValueError("Timeout cannot be more than 60 seconds. Use callbacks for more efficient change tracking")

        if interval < 1:
            raise ValueError("Interval cannot be less than 1 second")

        kill_time = datetime.now(tz=timezone.utc) + timedelta(seconds=timeout)

        while self._command_model.state.value < state.value:
            if datetime.now(tz=timezone.utc) > kill_time:
                raise TimeoutError(f"Command {self.name} did not reach state {state} in time")
            self._command_model = get_commands(session=self._session, command_uuid=self.uuid)[0]
            time.sleep(interval)
        return self

    def delete(self) -> None:
        """Delete the command.

        Note that deletion is directly commited to the API independently of the parent activity auto_commit state.

        :raises HTTPError: if the request was not successful
        """
        self._parent_activity.delete_command(self)  # we call parent to remove the command from the local activity
