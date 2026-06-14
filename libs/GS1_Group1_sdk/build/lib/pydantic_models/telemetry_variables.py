"""Contains all models to handle variables."""

from datetime import datetime

from pydantic import UUID4, UUID7, AwareDatetime, Base64Bytes, BaseModel, Field, field_validator

from libs.GS1_Group1_sdk.src.pydantic_models.definitions import ParameterType, VersionModel
from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import telemetry_variables_descriptions as desc
from libs.GS1_Group1_sdk.src.pydantic_models.value_field import ValueFieldModel


class TelemetryVariableModel(BaseModel):
    """Model to handle telemetry variables."""

    id: str = Field(description=desc.tm_id)
    # TODO this is named address in the protobuf model, but id is kept to be equivalent with the get
    timestamp: AwareDatetime = Field(description=desc.timestamp)
    value: ValueFieldModel = Field(description=desc.value)
    validity: bool = Field(description=desc.validity)
    version: VersionModel = Field(description=desc.version)
    parent_uuid: UUID4 | UUID7 | None = Field(default=None, description=desc.parent_uuid)

    @field_validator("id")
    @classmethod
    def name_must_contain_separator(cls: "TelemetryVariableModel", v: str) -> str:
        """Validator for the id field."""
        if "." not in v:
            raise ValueError('Id must contain at least one "." character for a valid telemetry variable id')
        return v


class TelemetryResponseModel(BaseModel):
    """Model used to respond to a telemetry variable request."""

    id: str = Field(description=desc.tm_id)
    name: str = Field(description=desc.name)
    unit: str = Field(description=desc.unit)
    type: ParameterType = Field(description=desc.tm_type)
    values: list[tuple[datetime, int | float | str | datetime | list[list[float]] | Base64Bytes, bool]] = Field(
        description=desc.values
    )
    header: tuple[str, str, str] = Field(("time", "value", "valid"), frozen=True, description=desc.header)

    def __len__(self):
        """Return the length of the values list."""
        return len(self.values)
