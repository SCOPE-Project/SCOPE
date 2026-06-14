"""Contains all the necessary class to handle the values in the parameters/variables."""

import base64
from datetime import datetime

from pydantic import AwareDatetime, Base64Bytes, BaseModel, Field, conlist, model_validator
from typing_extensions import Self

from libs.GS1_Group1_sdk.src.pydantic_models.definitions.parameter_definition import MatrixParameterDefinitionModel
from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import value_field_descriptions as desc


class MatrixModel(BaseModel):
    """Model to describe a 2 dimensional double matrix."""

    columns: int = Field(gt=0, lt=MatrixParameterDefinitionModel.MAX_INT, description=desc.matrix_columns)
    rows: int = Field(gt=0, lt=MatrixParameterDefinitionModel.MAX_INT, description=desc.matrix_row)
    values: conlist(float, min_length=0, max_length=MatrixParameterDefinitionModel.MAX_INT - 1) = Field(
        description=desc.matrix_values
    )

    @model_validator(mode="after")
    def validate_size(self) -> Self:
        """Validates the size of the matrix."""
        if self.rows * self.columns != len(self.values):
            raise ValueError("Matrix size does not match the given values")
        return self


class OctetStringModel(BaseModel):
    """Model used to describe binary data."""

    value: Base64Bytes

    def get_base64_value(self) -> bytes:
        """Returns the base64 encoded value.

        :return: Base64 encoded value
        """
        return base64.b64encode(self.value)

    def __len__(self):
        """Return the length of the bytes."""
        return len(self.value)


plain_types = float | int | str | datetime


class ValueFieldModel(BaseModel, validate_assignment=True):
    """Handles the fields of parameters or variables."""

    floatValue: float | None = Field(default=None, description=desc.float_value)
    intValue: int | None = Field(default=None, gt=-(2**53), lt=2**53, description=desc.int_value)
    matrixValue: MatrixModel | None = Field(default=None, description=desc.matrix_value)
    octetStringValue: OctetStringModel | None = Field(default=None, description=desc.octet_string_value)
    stringValue: str | None = Field(default=None, description=desc.string_value)
    timestampValue: AwareDatetime | None = Field(default=None, description=desc.timestamp_value)

    def get_value(self) -> plain_types | MatrixModel | OctetStringModel:
        """Returns the current set value.

        :return: The currently set value as proto model.
        """
        if self.floatValue is not None:
            return self.floatValue

        if self.intValue is not None:
            return self.intValue

        if self.matrixValue is not None:
            return self.matrixValue

        if self.octetStringValue is not None:
            return self.octetStringValue

        if self.stringValue is not None:
            return self.stringValue

        if self.timestampValue is not None:
            return self.timestampValue

        raise ValueError("No valid type found")

    def set_value(self, new_value: plain_types | MatrixModel | OctetStringModel) -> "ValueFieldModel":
        """Sets the internal value of the valueField.

        :param new_value: Any valid value
        :return: None
        """
        if isinstance(new_value, int):
            self.intValue = new_value
        elif isinstance(new_value, float):
            self.floatValue = new_value
        elif isinstance(new_value, str):
            self.stringValue = new_value
        elif isinstance(new_value, OctetStringModel):
            self.octetStringValue = new_value
        elif isinstance(new_value, MatrixModel):
            self.matrixValue = new_value
        elif isinstance(new_value, datetime):
            self.timestampValue = new_value
        else:
            raise ValueError("No valid type found")
        return self
