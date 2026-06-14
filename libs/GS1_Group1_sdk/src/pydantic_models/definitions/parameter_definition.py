"""Contains all the classes required to handle Parameter / Variable definitions."""

from collections.abc import Mapping
from typing import ClassVar

from pydantic import AwareDatetime, Base64Bytes, BaseModel, Field, model_validator
from typing_extensions import Self

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import parameter_def_descriptions as desc


class SintParameterDefinitionModel(BaseModel):
    """Model to handle signed integers."""

    min: int = Field(gt=-(2**53), lt=2**53, description=desc.sint_min)
    max: int = Field(gt=-(2**53), lt=2**53, description=desc.sint_max)
    defaultValue: int | None = Field(default=None, gt=-(2**53), lt=2**53, description=desc.default)


class FloatParameterDefinitionModel(BaseModel):
    """Model to handle float parameters."""

    min: float = Field(description=desc.float_min)
    max: float = Field(description=desc.float_max)
    defaultValue: float | None = Field(default=None, description=desc.default)


class EnumParameterDefinitionModel(BaseModel):
    """Model to handle Enum parameters."""

    MIN_INT: ClassVar[int] = -(2**53)

    MAX_INT: ClassVar[int] = 2**53

    values: Mapping[int, str] = Field(default={}, description=desc.enum_values)
    defaultValue: int | None = Field(default=None, gt=MIN_INT, lt=MAX_INT, description=desc.enum_default)

    @model_validator(mode="after")
    def validate_keys_in_mapping(self) -> Self:
        """Check that all keys in the mapping are within the bounds."""
        for key in self.values:
            if not (self.MIN_INT < key < self.MAX_INT):
                raise ValueError(
                    f"Key {key} in 'values' is out of bounds. Must be between {self.MIN_INT} and {self.MAX_INT}."
                )
        return self


class StringParameterDefinitionModel(BaseModel):
    """Model to handle string parameters."""

    defaultValue: str | None = Field(default=None, description=desc.string_default)


class OctetParameterDefinitionModel(BaseModel):
    """Model to handle binary data."""

    MIN_INT: ClassVar[int] = 0
    MAX_INT: ClassVar[int] = 2**31

    length: int = Field(default=0, ge=MIN_INT, lt=MAX_INT, description=desc.octet_length)
    defaultValue: Base64Bytes | None = Field(default=None, description=desc.octet_default)


class MatrixParameterDefinitionModel(BaseModel):
    """Model to handle double, 2-dimensional arrays."""

    MIN_INT: ClassVar[int] = 0
    MAX_INT: ClassVar[int] = 2**32

    rows: int = Field(ge=MIN_INT, lt=MAX_INT, description=desc.matrix_rows)
    columns: int = Field(ge=MIN_INT, lt=MAX_INT, description=desc.matrix_columns)
    defaultValue: list[float] | None = Field(default=None, max_length=MAX_INT - 1, description=desc.matrix_default)

    @model_validator(mode="after")
    def validate_size(self) -> Self:
        """Validates the size of the matrix."""
        if self.defaultValue is not None and self.rows * self.columns != len(self.defaultValue):
            raise ValueError("Default value size does not match the given row and column size")
        return self


class TimeParameterDefinitionModel(BaseModel):
    """Model to handle time parameters."""

    minimum: AwareDatetime = Field(description=desc.time_min)
    maximum: AwareDatetime = Field(description=desc.time_max)
    defaultValue: AwareDatetime | None = Field(default=None, description=desc.time_default)


class ParameterDefModel(BaseModel):
    """Represents parameters / variables in the system."""

    enumDefinition: EnumParameterDefinitionModel | None = Field(default=None, description=desc.enum_definition)
    floatDefinition: FloatParameterDefinitionModel | None = Field(default=None, description=desc.float_definition)
    matrixDefinition: MatrixParameterDefinitionModel | None = Field(default=None, description=desc.matrix_definition)
    octetDefinition: OctetParameterDefinitionModel | None = Field(default=None, description=desc.octet_definition)
    sintDefinition: SintParameterDefinitionModel | None = Field(default=None, description=desc.sint_definition)
    stringDefinition: StringParameterDefinitionModel | None = Field(default=None, description=desc.string_definition)
    timeDefinition: TimeParameterDefinitionModel | None = Field(default=None, description=desc.time_definition)

    name: str = Field(description=desc.name)
    description: str = Field(default="", description=desc.description)
    unit: str = Field(default="", description=desc.unit)

    @model_validator(mode="after")
    def check_only_one_set(self) -> Self:
        """Check that only one value is set."""
        param = [
            self.enumDefinition,
            self.floatDefinition,
            self.matrixDefinition,
            self.octetDefinition,
            self.sintDefinition,
            self.stringDefinition,
            self.timeDefinition,
        ]
        param = [p for p in param if p is not None]
        if len(param) != 1:
            raise ValueError(f"{len(param)} parameter model set. Should only be 1.")
        return self
