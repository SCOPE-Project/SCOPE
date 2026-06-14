"""This module contains the class necessary to handle a groundstation."""

from pydantic import BaseModel, Field, Json, conlist

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import ground_station_def_descriptions as desc

from .command_definition import CommandDefModel
from .component_definition import ComponentModel
from .event_definition import EventDefModel
from .parameter_definition import ParameterDefModel
from .position_definition import PositionModel
from .tm_set_definition import TmSetModel
from .version import VersionModel


class GroundStationModel(BaseModel):
    """Model to handle a groundstation."""

    version: VersionModel = Field(description=desc.version)
    archived: bool | None = Field(default=False, description=desc.archived)
    name: str = Field(description=desc.name)
    description: str | None = Field(default="", description=desc.description)
    components: conlist(ComponentModel, min_length=0) = Field(default_factory=list, description=desc.components)
    commandDefinitions: conlist(CommandDefModel, min_length=0) = Field(
        default_factory=list, description=desc.command_definitions
    )
    eventDefinitions: conlist(EventDefModel, min_length=0) = Field(
        default_factory=list, description=desc.event_definitions
    )
    variableDefinitions: conlist(ParameterDefModel, min_length=0) = Field(
        default_factory=list, description=desc.variable_definitions
    )
    tmSetDefinitions: conlist(TmSetModel, min_length=0) = Field(
        default_factory=list, description=desc.tm_set_definitions
    )
    position: PositionModel | None = Field(default=None, description=desc.position)
    custom_fields: Json | None = Field(default=None, description=desc.custom_fields)


class GroundStationInfoModel(BaseModel):
    """Model to represent G/S short infos."""

    name: str = Field(description=desc.name)
    description: str = Field(description=desc.description)
    versions: conlist(VersionModel, min_length=1) = Field(description=desc.versions)
    archived: bool = Field(description=desc.archived)
