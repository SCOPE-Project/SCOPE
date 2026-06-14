"""Contains all classes to handle event definitions."""

from enum import IntEnum

from pydantic import BaseModel, Field, conlist

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import event_def_descriptions as desc

from .parameter_reference_definition import ParameterReferenceModel


class EventSeverity(IntEnum):
    """Possible Event Severities."""

    RESERVED = 0
    TRACE = 1
    DEBUG = 2
    INFO = 3
    WARNING = 4
    ERROR = 5
    CRITICAL = 6


class EventDefModel(BaseModel):
    """Model to handle event definitions as used for telemetry events."""

    name: str = Field(description=desc.name)
    description: str = Field(default="", description=desc.description)
    severity: EventSeverity = Field(description=desc.severity)
    message: str = Field(description=desc.message)
    parameters: conlist(ParameterReferenceModel, min_length=0) = Field(
        default_factory=list, description=desc.parameters
    )
