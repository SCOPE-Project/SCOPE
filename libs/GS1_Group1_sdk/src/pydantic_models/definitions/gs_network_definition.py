"""Contains models for GroundStationNetworks."""

from pydantic import BaseModel, Field, Json, conlist

from pydantic_models.descriptions import gs_network_def_descriptions as desc

from .command_definition import CommandDefModel
from .component_definition import ComponentModel
from .event_definition import EventDefModel
from .ground_station_definition import GroundStationModel
from .parameter_definition import ParameterDefModel
from .tm_set_definition import TmSetModel
from .version import VersionModel


class GroundStationNetworkModel(BaseModel):
    """Model to handle ground station networks."""

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
    ground_stations: conlist(GroundStationModel, min_length=0) = Field(
        default_factory=list, description=desc.ground_stations
    )
    custom_fields: Json | None = Field(default=None, description=desc.custom_fields)


class GroundStationNetworkInfoModel(BaseModel):
    """Model to represent G/S Network short infos."""

    name: str = Field(description=desc.name)
    description: str = Field(description=desc.description)
    versions: conlist(VersionModel, min_length=1) = Field(description=desc.versions)
    archived: bool = Field(description=desc.archived)
