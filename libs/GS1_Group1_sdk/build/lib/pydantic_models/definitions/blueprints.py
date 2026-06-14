"""Contains the pydantic models for the blueprints."""

from datetime import datetime, timedelta, timezone

from pydantic import UUID4, UUID7, AwareDatetime, BaseModel, Field, conlist

from pydantic_models.definitions import VersionModel
from pydantic_models.value_field import ValueFieldModel


class ParameterBlueprint(BaseModel):
    """Model to handle parameters in blueprints."""

    name: str = Field(..., description="Name of the parameter blueprint.")
    value: ValueFieldModel | None = Field(default=None, description="Value of the parameter blueprint.")


class CommandBlueprint(BaseModel):
    """Model to handle commands in blueprints."""

    relative_execution_info: timedelta | None = Field(
        default=None, description="Relative execution info"
    )  # Relative to activity start time
    relative_release_info: timedelta | None = Field(
        default=None, description="Relative release info"
    )  # Relative to previous command release time
    path: str = Field(..., description="Path to the command blueprint.", min_length=1)
    parameters: conlist(ParameterBlueprint, min_length=0) = Field(
        default_factory=list, description="List of parameters for the command blueprint."
    )
    version: VersionModel = Field(..., description="Version of the command blueprint.")
    name: str = Field(..., description="Name of the command blueprint.")


class ActivityBlueprint(BaseModel):
    """Model to handle activity blueprints."""

    name: str = Field(..., description="Name of the activity blueprint.")
    description: str = Field(..., description="Description of the activity blueprint.")
    creator: str = Field(..., description="Creator of the activity blueprint.")
    editor: str = Field(..., description="Last editor of the activity blueprint.")
    commands: conlist(CommandBlueprint, min_length=0) = Field(
        default_factory=list, description="List of commands for the activity blueprint."
    )
    uuid: UUID4 | UUID7 = Field(..., description="UUID of the activity blueprint.")
    creation_time: AwareDatetime = Field(
        default=datetime.now().astimezone(tz=timezone.utc), description="Creation time of the activity blueprint."
    )
    edit_time: AwareDatetime = Field(
        default=datetime.now().astimezone(tz=timezone.utc), description="Edit time of the activity blueprint."
    )
    schedule_name: str = Field(..., description="Name of the schedule for the activity blueprint.")


class ActivityBlueprintListItem(BaseModel):
    """Model to handle activity blueprints in list responses."""

    name: str = Field(..., description="Name of the activity blueprint.")
    description: str = Field(..., description="Description of the activity blueprint.")
    uuid: UUID4 | UUID7 = Field(..., description="UUID of the activity blueprint.")
    creation_time: AwareDatetime = Field(
        default=datetime.now().astimezone(tz=timezone.utc), description="Creation time of the activity blueprint."
    )
    edit_time: AwareDatetime = Field(
        default=datetime.now().astimezone(tz=timezone.utc), description="Edit time of the activity blueprint."
    )
    schedule_name: str = Field(..., description="Name of the schedule for the activity blueprint.")
