"""Contains component definitions."""

from pydantic import BaseModel, Field, conlist

from pydantic_models.descriptions import component_def_descriptions as desc

from .command_definition import CommandDefModel
from .event_definition import EventDefModel
from .parameter_definition import ParameterDefModel
from .tm_set_definition import TmSetModel


class ComponentModel(BaseModel):
    """Model to handle ComponentModels."""

    name: str = Field(description=desc.name)
    description: str = Field(description=desc.description)
    components: conlist("ComponentModel", min_length=0) = Field(default_factory=list, description=desc.components)
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
