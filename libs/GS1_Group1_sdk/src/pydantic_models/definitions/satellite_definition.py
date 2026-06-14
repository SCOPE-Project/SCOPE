"""Contains class to handle satellites."""

from pydantic import BaseModel, Field, Json, conlist

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import satellite_def_descriptions as desc

from .command_definition import CommandDefModel
from .component_definition import ComponentModel
from .event_definition import EventDefModel
from .parameter_definition import ParameterDefModel
from .tm_set_definition import TmSetModel
from .version import VersionModel


class SatelliteModel(BaseModel):
    """Model to represent a satellite model."""

    version: VersionModel = Field(description=desc.version)
    archived: bool = Field(default=False, description=desc.archived)
    name: str = Field(description=desc.name)
    description: str = Field(default="", description=desc.description)
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
    norad_id: int | None = Field(default=None, description=desc.norad_id)
    opm_object_id: str | None = Field(default=None, description=desc.opm_id)
    custom_fields: Json | None = Field(default=None, description=desc.custom_fields)


class SatelliteInfoModel(BaseModel):
    """Model to represent a satellite short info."""

    name: str = Field(description=desc.name)
    description: str = Field(description=desc.description)
    versions: conlist(VersionModel, min_length=1) = Field(description=desc.versions)
    archived: bool = Field(description=desc.archived)
    norad_id: int | None = Field(default=None, description=desc.norad_id)
    opm_object_id: str | None = Field(default=None, description=desc.opm_id)
