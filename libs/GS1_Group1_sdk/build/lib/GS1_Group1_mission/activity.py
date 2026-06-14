"""This module provides the Activity class to interact with activities on the API."""

from datetime import datetime
from typing import Literal

from libs.GS1_Group1_sdk.src.api_connect.activities import delete_activity, put_activities
from libs.GS1_Group1_sdk.src.api_connect.commands import delete_commands, get_commands, post_commands, put_commands
from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession
from pydantic import UUID4, UUID7
from libs.GS1_Group1_sdk.src.pydantic_models.activity import ActivityModel

from .command import SdkCommand


class SdkActivity:
    """An activity is a collection of commands and metadata and is executed on an asset."""

    def __init__(self, activity_model: ActivityModel, auto_commit: bool = True, auto_refresh: bool = False):
        """Initialize the activity."""
        self.__activity_model = activity_model
        self._auto_commit: bool = auto_commit
        self._auto_refresh: bool = auto_refresh

        if self._auto_commit:
            self.commit()

    def __repr__(self):
        """Return the activity model as a string."""
        return self.model_dump(mode="python")

    def __str__(self) -> str:
        """Return the activity model as a string."""
        return str(self.model_dump(mode="json"))

    @property
    def _session(self) -> SatIOSession:
        """Get the session.

        :return: SatIOSession
        """
        return SatIOSession.get_session()

    @property
    def auto_commit(self) -> bool:
        """Auto commit activity and changes on it."""
        return self._auto_commit

    @auto_commit.setter
    def auto_commit(self, value: bool) -> None:
        """Auto commit activity and changes on it."""
        if value and not self._auto_commit:  # auto commit status changed to True so we need to commit
            self.commit()

        self._auto_commit = value

    @property
    def schedule_name(self) -> str:
        """Get the schedule name of the activity."""
        return self.__activity_model.scheduleName

    @property
    def uuid(self) -> UUID4 | UUID7:
        """Get the activity UUID."""
        return self.__activity_model.uuid

    def set_start(self, start: datetime) -> None:
        """Set the start time of the activity."""
        raise NotImplementedError

    def set_end(self, end: datetime) -> None:
        """Set the end time of the activity."""
        raise NotImplementedError

    @property
    def name(self) -> str:
        """Get the activity name."""
        return self.__activity_model.name

    @name.setter
    def name(self, value: str) -> None:
        """Set the activity name."""
        self.__activity_model.name = value
        self._conditional_commit()

    def model_dump(self, mode: Literal["json", "python"] = "python") -> dict:
        """Return the activity model as a dictionary."""
        return self.__activity_model.model_dump(mode=mode)

    def commit(self) -> None:
        """Commit any changes to the activity to the API."""
        if self.__activity_model.initiator is None:
            self.__activity_model.initiator = self._session.get_username()
        response = put_activities(session=self._session, activities=[self.__activity_model])
        response.raise_for_status()

    def _conditional_commit(self) -> None:
        if self.auto_commit:
            self.commit()

    def add_command(self, command: SdkCommand, position: int | None = None) -> SdkCommand:
        """Add or update a command for the activity.

        Use this function to add a new command to the activity
        example to append a command to the end of the command list:
        ```
        act = my_tsat.get_activity(test_activity.uuid)
        command = my_tsat.myComponent.myCompCommand()
        act.add_command(command)
        ```

        example to insert a command at a specific position:
        ```
        act = my_tsat.get_activity(test_activity.uuid)
        command = my_tsat.myComponent.myCompCommand()
        act.add_command(command, position=0) # Add the command to the beginning of the command list
        ```

        :param command: Command, the command to add or update
        :param position: int, the position to insert the command at.
            If None or < 0, the command is added to the end of the command list

        """
        self.__activity_model = self.__activity_model.push_cmd(
            command=command._command_model, position=position, distance=100
        )

        command.set_parent_activity(self)

        if self.auto_commit:
            # we need to commit single commands to trigger websocket response
            # Check existence to select right push method
            cmds = get_commands(session=self._session, command_uuid=command.uuid)
            cmd_exists = cmds is not None and len(cmds) > 0
            if cmd_exists:
                put_commands(session=self._session, commands=[command._command_model]).raise_for_status()
            else:
                post_commands(session=self._session, commands=[command._command_model]).raise_for_status()

        return command

    def __command_exists(self, command: SdkCommand, remove: bool = False) -> bool:
        for cmd in self.__activity_model.commands:
            if cmd.uuid == command._command_model.uuid:
                if remove:
                    self.__activity_model.commands.remove(cmd)
                return True
        return False

    def get_command(
        self, command_uuid: UUID4 | UUID7 | None = None, command_index: int | None = None
    ) -> SdkCommand | None:
        """Get a command by index or name.

        :param command_index: int, the index of the command in the activity
        :param command_uuid: UUID4 or UUID7, the uuid of the command

        :return: Command or None the command was not found
        """
        if command_index is None and command_uuid is None:
            raise ValueError("You need to provide either an index or a name to get a command.")
        if command_index is not None and command_uuid is not None:
            raise ValueError("You can only provide an index or a name to get a command.")
        if command_index is not None:
            return self.get_all_commands()[command_index]
        if command_uuid is not None:
            return self.__get_command_by_uuid(command_uuid=command_uuid)
        return None

    def get_all_commands(self) -> list[SdkCommand]:
        """Get all commands in the activity."""
        return [
            SdkCommand.from_command_model(model=cmd, parent_activity=self) for cmd in self.__activity_model.commands
        ]

    def get_commands_by_name(self, command_name: str) -> list[SdkCommand]:
        """Get a command by name.

        :param command_name: str, the name of the command
        :return: list of Command or None if the command was not found
        """
        commands = self.get_all_commands()
        same_cmds = []
        for cmd in commands:
            if cmd._command_model.name == command_name:
                same_cmds.append(cmd)
        return same_cmds

    def __get_command_by_uuid(self, command_uuid: UUID4 | UUID7) -> SdkCommand | None:
        """Get a command by uuid."""
        commands = self.get_all_commands()
        for cmd in commands:
            if cmd.uuid == command_uuid:
                return cmd
        return None

    def delete(self) -> None:
        """Delete the activity from the API.

        Detaches the local activity from the API. If the activity should be used afterwards,
        it has to be re-committed using the commit method.

        :raises HTTPError: if the request was not successful
        """
        response = delete_activity(session=self._session, activity_uuid=self.uuid)
        response.raise_for_status()

    def delete_command(self, command: SdkCommand) -> None:
        """Delete a command from the activity.

        :param command: SdkCommand, the command to delete
        """
        if self.__command_exists(command=command, remove=True):
            response = delete_commands(session=self._session, command_uuids=[command.uuid])
            response.raise_for_status()
        else:
            raise Exception("Command not found in activity.")

    def get_copy(self) -> "SdkActivity":
        """Create a copy of the activity."""
        return SdkActivity.from_activity_model(model=self.__activity_model.get_copy(), auto_commit=self.auto_commit)

    @classmethod
    def from_activity_model(cls, model: ActivityModel, auto_commit: bool = True) -> "SdkActivity":
        """Create an Activity from its parent object ActivityModel."""
        return cls(activity_model=model, auto_commit=auto_commit)
