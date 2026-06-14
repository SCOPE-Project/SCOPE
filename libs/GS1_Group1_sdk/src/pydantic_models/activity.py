"""Contains all models to work with activities."""

import uuid
from datetime import timedelta
from enum import IntEnum

import libs.GS1_Group1_sdk.src.lexorank as lexorank
from pydantic import UUID4, UUID7, BaseModel, ConfigDict, Field, conlist, field_validator

from libs.GS1_Group1_sdk.src.pydantic_models.command import CommandModel, CommandState
from libs.GS1_Group1_sdk.src.pydantic_models.demand import AbsoluteDemandModel, RelativeDemandModel
from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import activity_descriptions as desc
from libs.GS1_Group1_sdk.src.pydantic_models.schedule_event_relation import ScheduleEventRelationModel


class ActivityStatus(IntEnum):
    """Possible Activity Status."""

    INVALID_STATUS = 0
    IN_PROGRESS = 1
    SUSPENDED = 2
    FAILED = 3
    CLOSED = 4


class ActivityStages(IntEnum):
    """Possible Activity Stages."""

    INVALID_STAGE = 0
    REQUESTED = 1
    SCHEDULED_ON_GROUND = 2
    IN_TRANSMISSION = 3
    SCHEDULED_ON_BOARD = 4
    IN_PROCESS = 5
    EXECUTED = 6
    VERIFIED = 7


class ActivityModel(BaseModel):
    """This model defines Activities, which are stored in the schedule."""

    autoScheduled: bool = Field(default=False, description=desc.auto_scheduled)
    description: str = Field(default="", description=desc.description)
    uuid: UUID4 | UUID7 = Field(description=desc.uuid)
    initiator: str | None = Field(default=None, description=desc.initiator)
    priority: int = Field(default=0, description=desc.priority)
    scheduleName: str = Field(description=desc.schedule_name)
    commands: conlist(CommandModel, min_length=0) = Field(default_factory=list, description=desc.commands)
    status: int = Field(default=ActivityStatus.SUSPENDED, description=desc.status)
    stage: int = Field(default=ActivityStages.REQUESTED, description=desc.stage)
    executor: str | None = Field(default=None, description=desc.executor)
    startEvent: ScheduleEventRelationModel | None = Field(default=None, description=desc.start_event)
    endEvent: ScheduleEventRelationModel | None = Field(default=None, description=desc.end_event)
    parentActivityUuid: UUID4 | UUID7 | None = Field(default=None, description=desc.parent_activity_uuid)
    relativeDemand: RelativeDemandModel | None = Field(default=None)
    # No need to give RelativeDemandModel description here, because this is already a pydantic defined class
    # Pydantic automatically gets description from model
    absoluteDemand: AbsoluteDemandModel | None = Field(default=None)
    # No need to give AbsoluteDemandModel description here, because this is already a pydantic defined class
    # Pydantic automatically gets description from model
    eventRelations: conlist(ScheduleEventRelationModel, min_length=0) = Field(default_factory=list)
    childActivities: conlist("ActivityModel", min_length=0) = Field(
        default_factory=list, description=desc.child_activities
    )
    name: str | None = Field(default="", description=desc.name)

    model_config = ConfigDict(from_attributes=True)

    @field_validator("commands", mode="after")
    @classmethod
    def rank_must_be_unique(cls, commands: list[CommandModel]) -> list[CommandModel]:
        """Check that the ranks of the commands are unique.

        :param commands: list of commands
        :return: list of commands
        :raises ValueError: if the ranks are not unique
        """
        if len({x.rank for x in commands}) != len(commands):
            last_rank = "ffff"
            for cmd in commands:
                cmd.rank = last_rank
                last_rank = lexorank.get_new_rank(last_rank, distance=100, min_overflow_add_size=3)
        return commands

    class RankExistsError(ValueError):
        """Raised when a rank already exists in the activity."""

    def push_cmd(self, command: CommandModel, position: int | None = None, distance: int = 100) -> "ActivityModel":
        """Add a new command to the activity and resort commands according to ranks.

        :param command: Command, the command to add or update
        :param position: int, the position to insert the command at.
            If None or > length of existing activity commands, the command is added to the end of the command list
            If <= 0, the command is added to the beginning of the command list
         :param distance: int, the distance between the new command and the previous one.

         :return: The activity with the new command.
        """
        command_exists = self.command_exists(activity=self, command=command, remove=True)  # Exists in activity

        command.activityUuid = self.uuid

        curr_len = len(self.commands)
        self.__sort_cmds()
        if curr_len == 0:  # first command
            command.rank = "ffff"
        elif (position is None and not command_exists) or (
            position is not None and position >= curr_len
        ):  # insert at end when it's a new command
            command.rank = lexorank.get_new_rank(self.commands[-1].rank, distance=distance, min_overflow_add_size=3)
        elif position is not None and position <= 0:  # insert at the beginning
            command.rank = lexorank.get_new_rank(
                self.commands[0].rank, distance=-1 * distance if distance > 0 else distance, min_overflow_add_size=3
            )
        elif position is not None:  # insert in between
            command.rank = lexorank.get_rank_between(
                self.commands[position - 1].rank,
                self.commands[position].rank,
                overflow_add_size=3,
            )

        self.commands.append(command)
        # sort commands by rank
        self.__sort_cmds()
        return self

    def __sort_cmds(self) -> "ActivityModel":
        """Sort the commands by rank."""
        self.commands.sort(key=lambda x: x.rank)
        return self

    @staticmethod
    def command_exists(activity: "ActivityModel", command: CommandModel, remove: bool = False) -> bool:
        """Check if a command exists in the activity and optionally remove it.

        :param activity: ActivityModel, the activity to check
        :param command: CommandModel, the command to check
        :param remove: bool, if True, remove the command from the activity if it exists

        :return: bool, True if the command exists in the activity, False otherwise
        """
        for cmd in activity.commands:
            if cmd.uuid == command.uuid:
                if remove:
                    activity.commands.remove(cmd)
                return True
        return False

    def has_delete_allow_state(self) -> bool:
        """Check if the activity has a state that allows it to be deleted.

        The allowed deletion states are:
        on hold (9), withdrawn (10), rejected (14) and release failed (15)
        """
        return (
            (self.stage == ActivityStages.REQUESTED and self.status == ActivityStatus.SUSPENDED)
            or (self.stage == ActivityStages.SCHEDULED_ON_GROUND and self.status == ActivityStatus.SUSPENDED)
            or (self.stage == ActivityStages.SCHEDULED_ON_GROUND and self.status == ActivityStatus.FAILED)
            or (self.stage == ActivityStages.IN_TRANSMISSION and self.status == ActivityStatus.FAILED)
            or (
                self.stage not in ActivityStages.__members__.values()
                or self.status not in ActivityStatus.__members__.values()
            )
        )

    def get_copy(self) -> "ActivityModel":
        """Create a copy of the activity."""
        return ActivityModel.create_copy(self)

    @staticmethod
    def create_copy(activity: "ActivityModel") -> "ActivityModel":
        """Create a copy of the given activity.

        Resets all uuids for activity and all child commands and activities as well as markers.
        """
        new_activity_model: ActivityModel = activity.model_copy(deep=True)

        # TODO: Change relative command release infos to new command uuids
        #  (create a map of all coommand_uuids: {old_uuid: new_uuid}
        #  and replace them in the relative infos and command uuids)

        def _reset_command(command: CommandModel) -> None:
            """Reset the UUID of the command."""
            command.uuid = uuid.uuid4()
            command.state = CommandState.EDITABLE
            command.failed = False

        def _reset_activity(new_act: ActivityModel) -> None:
            """Reset the activity and its child activities as well as commands."""
            new_act.uuid = uuid.uuid4()
            new_act.stage = ActivityStages.REQUESTED
            new_act.status = ActivityStatus.SUSPENDED

            for cmd in new_act.commands:
                _reset_command(cmd)

            for child_act in new_act.childActivities:
                _reset_activity(child_act)

        _reset_activity(new_activity_model)

        return new_activity_model


class ActivityInfoModel(BaseModel):
    """Model to handle activities without their children."""

    uuid: UUID4 | UUID7 = Field(description=desc.uuid)
    auto_scheduled: bool = Field(default=False, description=desc.auto_scheduled)
    description: str = Field(description=desc.description)
    initiator: str = Field(description=desc.initiator)
    priority: int = Field(default=0, description=desc.priority)
    schedule_name: str = Field(description=desc.schedule_name)
    status: int = Field(default=ActivityStatus.SUSPENDED, description=desc.status)
    stage: int = Field(default=ActivityStages.REQUESTED, description=desc.stage)
    executor: str | None = Field(default=None, description=desc.executor)
    start_event_uuid: UUID4 | UUID7 | None = Field(default=None, description=desc.start_event_uuid)
    end_event_uuid: UUID4 | UUID7 | None = Field(default=None, description=desc.end_event_uuid)
    start_event_timedelta: timedelta | None = Field(default=None, description=desc.start_event_timedelta)
    end_event_timedelta: timedelta | None = Field(default=None, description=desc.end_event_timedelta)
    parent_activity_uuid: UUID4 | UUID7 | None = Field(default=None, description=desc.parent_activity_uuid)
    name: str = Field(description=desc.name)
    model_config = ConfigDict(from_attributes=True)
