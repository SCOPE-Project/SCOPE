"""Contains models to represent TM sets."""

from pydantic import BaseModel, Field, conlist

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import tm_set_def_descriptions as desc

from .parameter_reference_definition import ParameterReferenceModel


class TmSetModel(BaseModel):
    """TM sets are used to describe a list of parameters that are received as one entity (like a Packet)."""

    name: str = Field(description=desc.name)
    description: str = Field(default="", description=desc.description)
    parameters: conlist(ParameterReferenceModel, min_length=0) = Field(
        default_factory=list, description=desc.parameters
    )
