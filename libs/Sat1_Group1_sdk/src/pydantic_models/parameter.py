"""This module contains code necessary to handle parameters / variables."""

from pydantic import UUID4, UUID7, BaseModel, Field, conlist

from pydantic_models.definitions.parameter_definition import ParameterDefModel
from pydantic_models.descriptions import parameter_descriptions as desc
from pydantic_models.value_field import ValueFieldModel


class CommandParameterModel(BaseModel):
    """Class to handle command parameters."""

    commandUuid: UUID4 | UUID7 = Field(description=desc.command_uuid)
    uuid: UUID4 | UUID7 = Field(description=desc.uuid)
    name: str | None = Field(default=None, description=desc.name)
    id: str = Field(description=desc.par_id)
    value: ValueFieldModel
    # No need to give Value Field description here, because this is already a pydantic defined class
    # Pydantic automatically gets description from model


class ParameterDefPathModel(BaseModel):
    """Class to handle a single parameter/variable definition with its path."""

    param_def: ParameterDefModel
    # No need to give ParameterDefModel description here, because this is already a pydantic defined class
    # Pydantic automatically gets description from model
    path: str = Field(description=desc.path)


class ParameterDefListModel(BaseModel):
    """Class to handle list of parameter/variable definitions."""

    tm_parameter: conlist(ParameterDefPathModel, min_length=0) = Field(description=desc.tm_parameter)
    tc_parameter: conlist(ParameterDefPathModel, min_length=0) = Field(description=desc.tc_parameter)
