"""Contains a helper class to show the user representation of the available types."""

from enum import Enum


class ParameterType(Enum):
    """Type as presented in the models to the user."""

    STRING = "string"
    FLOAT = "float"
    OCTET = "octet"
    INT = "int"
    ENUM = "enum"
    TIMESTAMP = "timestamp"
    MATRIX = "matrix"
