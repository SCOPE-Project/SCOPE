"""Contains all models to handle command definitions."""

from pydantic import BaseModel, Field, conlist

from pydantic_models.definitions.parameter_definition import ParameterDefModel
from pydantic_models.descriptions import command_def_descriptions as desc


class CommandDefModel(BaseModel):
    """Model to handle command definitions."""

    description: str = Field(default="", description=desc.description)
    name: str = Field(description=desc.name)
    parameters: conlist(ParameterDefModel, min_length=0) = Field(default_factory=list, description=desc.parameters)
