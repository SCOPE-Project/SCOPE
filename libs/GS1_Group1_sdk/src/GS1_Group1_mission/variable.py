"""The SDK variable lives here. A variable is a single value that can be subscribed to and fetched."""

import base64
from datetime import datetime

import pandas as pd
from libs.GS1_Group1_sdk.src.api_connect.satio_session import SatIOSession
from libs.GS1_Group1_sdk.src.api_connect.telemetry import get_telemetry_data
from pydantic import AwareDatetime
from libs.GS1_Group1_sdk.src.pydantic_models.definitions import ParameterDefModel, ParameterType
from libs.GS1_Group1_sdk.src.pydantic_models.telemetry_variables import TelemetryResponseModel


class SdkVariable:
    """A variable is a single value that can be subscribed to and fetched."""

    def __init__(self, variable_model: ParameterDefModel, id_path: str):
        """Initialize the variable.

        :param variable_model: The variable model to initialize the variable with.
        """
        self._variable_model = variable_model
        self._id_path = id_path

    def __str__(self):
        """Return the string representation of the variable."""
        return f"SdkVariable({self.name}, {self.description}, {self.unit})"

    def __repr__(self):
        """Return the string representation of the variable."""
        return self.__str__()

    def __check_type(self, value_to_check: float | str | datetime | list[list[float]] | bytes) -> None:
        def _check_matrix() -> bool:
            if self.type == ParameterType.MATRIX and isinstance(value_to_check, list):
                if not all(isinstance(row, list) for row in value_to_check):
                    raise ValueError("Matrix value must be a list of lists.")
                if not all(len(row) == len(value_to_check[0]) for row in value_to_check):
                    raise ValueError("Matrix rows must have the same length.")
                if not all(isinstance(value, float | int) for row in value_to_check for value in row):
                    raise ValueError("Matrix values must be floats or ints.")
                return True
            return False

        if type(value_to_check) not in self._valid_python_types() and not _check_matrix():
            raise ValueError("Value type must match variable type.")

    @property
    def name(self) -> str:
        """Get the variable name."""
        return self._variable_model.name

    @property
    def description(self) -> str:
        """Get the variable description."""
        return self._variable_model.description

    @property
    def unit(self) -> str:
        """Get the variable unit."""
        return self._variable_model.unit

    def _valid_python_types(self) -> tuple[type]:
        if self.type == ParameterType.FLOAT:
            python_type = (float,)
        elif self.type == ParameterType.INT:
            python_type = (int,)
        elif self.type == ParameterType.STRING:
            python_type = (str,)
        elif self.type == ParameterType.TIMESTAMP:
            python_type = AwareDatetime, datetime
        elif self.type == ParameterType.ENUM:
            python_type = (str,)
        elif self.type == ParameterType.OCTET:
            python_type = (bytes,)
        elif self.type == ParameterType.MATRIX:
            python_type = (list[list[float]],)
        else:
            raise ValueError("Unknown variable type.")
        return python_type

    @property
    def type(self) -> ParameterType:
        """Get the variable type."""
        if self._variable_model.enumDefinition:
            param_type = ParameterType.ENUM
        elif self._variable_model.floatDefinition:
            param_type = ParameterType.FLOAT
        elif self._variable_model.matrixDefinition:
            param_type = ParameterType.MATRIX
        elif self._variable_model.octetDefinition:
            param_type = ParameterType.OCTET
        elif self._variable_model.sintDefinition:
            param_type = ParameterType.INT
        elif self._variable_model.stringDefinition:
            param_type = ParameterType.STRING
        elif self._variable_model.timeDefinition:
            param_type = ParameterType.TIMESTAMP
        else:
            raise ValueError("Unknown variable type.")

        return param_type

    def minimum_limit(self) -> float | int | AwareDatetime:
        """Get the minimum value of the variable."""
        if self.type == ParameterType.FLOAT:
            return self._variable_model.floatDefinition.min
        if self.type == ParameterType.INT:
            return self._variable_model.sintDefinition.min
        if self.type == ParameterType.TIMESTAMP:
            return self._variable_model.timeDefinition.minimum
        raise ValueError("Variable type does not have a minimum value.")

    def maximum_limit(self) -> float | int | AwareDatetime:
        """Get the maximum value of the variable."""
        if self.type == ParameterType.FLOAT:
            return self._variable_model.floatDefinition.max
        if self.type == ParameterType.INT:
            return self._variable_model.sintDefinition.max
        if self.type == ParameterType.TIMESTAMP:
            return self._variable_model.timeDefinition.maximum
        raise ValueError("Variable type does not have a maximum value.")

    @staticmethod
    def tm_model_to_pandas(tm_model: TelemetryResponseModel) -> pd.DataFrame:
        """Convert a telemetry response model to a pandas dataframe.

        :param tm_model: The telemetry response model to convert.

        :returns: A pandas dataframe.
            The 'time' column is set as the index.
            The 'value' column is decoded from base64 to bytes if the variable type is OCTET.
        """
        df = pd.DataFrame(tm_model.values, columns=tm_model.header)
        df.set_index("time", inplace=True)
        if tm_model.type == ParameterType.OCTET:
            df["value"] = df["value"].map(base64.b64decode)
        if tm_model.type == ParameterType.TIMESTAMP:
            df["value"] = pd.to_datetime(df["value"])
            # df['value'] = df['value'].map(lambda x: datetime.fromisoformat(x))
        return df

    def fetch(
        self, start_time: datetime, end_time: datetime, as_pandas: bool = False
    ) -> TelemetryResponseModel | pd.DataFrame:
        """Fetch the current value of the variable.

        :param start_time: The start time of the fetch.
        :param end_time: The end time of the fetch.
        :param as_pandas: Return the data as a pandas dataframe.
        """
        if start_time > end_time:
            raise ValueError("Start time must be before end time.")

        if start_time.tzinfo is None or end_time.tzinfo is None:
            raise ValueError("Start time and end time must have timezone information.")

        response = get_telemetry_data(SatIOSession.get_session(), self._id_path, start_time, end_time)

        if as_pandas:
            return self.tm_model_to_pandas(response)

        return response
