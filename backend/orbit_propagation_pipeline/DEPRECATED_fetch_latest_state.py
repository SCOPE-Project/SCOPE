from argparse import ArgumentParser
from datetime import datetime, timezone

from api_connect.satio_session import SatIOSession
from api_connect.satellites import get_satellite
from pydantic import AwareDatetime, BaseModel, ConfigDict
from utils.api_utilities import load_credentials

SATELLITE_NAME = "Sat1_Group1"
POSITION_VARIABLE_NAME = "position_vector"
VELOCITY_VARIABLE_NAME = "velocity_vector"


class CartesianState(BaseModel):
    model_config = ConfigDict(frozen=True)

    timestamp: AwareDatetime
    position_m: tuple[float, float, float]
    velocity_mps: tuple[float, float, float]


def _find_variable(satellite_model, variable_name: str):
    for variable in satellite_model.variableDefinitions:
        if variable.name == variable_name:
            return variable

    raise ValueError(
        f"Variable {variable_name!r} not found directly under satellite {satellite_model.name!r}"
    )


def _matrix_default_value(variable, *, expected_unit: str) -> tuple[float, float, float]:
    matrix_definition = variable.matrixDefinition
    if matrix_definition is None:
        raise TypeError(f"Variable {variable.name!r} is not a matrix variable")

    if matrix_definition.rows != 1 or matrix_definition.columns != 3:
        raise ValueError(
            f"Variable {variable.name!r} must be a 1x3 matrix, "
            f"got {matrix_definition.rows}x{matrix_definition.columns}"
        )

    if variable.unit != expected_unit:
        raise ValueError(
            f"Variable {variable.name!r} must use unit {expected_unit!r}, "
            f"got {variable.unit!r}"
        )

    if matrix_definition.defaultValue is None:
        raise ValueError(
            f"Variable {variable.name!r} has no matrixDefinition.defaultValue. "
            "get_satellite() returns the satellite model definition, so this "
            "workflow needs the latest state to be stored as the matrix default."
        )

    values = [float(component) for component in matrix_definition.defaultValue]
    if len(values) != 3:
        raise ValueError(
            f"Variable {variable.name!r} defaultValue must contain 3 entries, "
            f"got {len(values)}"
        )
    return tuple(values)


def satellite_model_to_cartesian_state(satellite_model) -> CartesianState:
    position_variable = _find_variable(
        satellite_model,
        POSITION_VARIABLE_NAME,
    )
    velocity_variable = _find_variable(
        satellite_model,
        VELOCITY_VARIABLE_NAME,
    )

    return CartesianState(
        # The satellite model definition has no telemetry timestamp. Treat the
        # fetch time as the epoch for this latest-state workflow.
        timestamp=datetime.now(tz=timezone.utc),
        position_m=_matrix_default_value(position_variable, expected_unit="m"),
        velocity_mps=_matrix_default_value(velocity_variable, expected_unit="m/s"),
    )


def fetch_latest_state() -> CartesianState:
    load_credentials()

    with SatIOSession() as session:
        satellite_model = get_satellite(
            session=session,
            satellite_name=SATELLITE_NAME,
        )

    return satellite_model_to_cartesian_state(satellite_model)


def print_state(state: CartesianState) -> None:
    print(f"Timestamp: {state.timestamp.isoformat()}")
    print(f"Position GCRF [m]: {state.position_m}")
    print(f"Velocity GCRF [m/s]: {state.velocity_mps}")


def main() -> None:
    parser = ArgumentParser(description="Fetch the latest Sat1_Group1 Cartesian state from get_satellite().")
    parser.parse_args()

    state = fetch_latest_state()
    print("Fetched the latest complete state")
    print_state(state)


if __name__ == "__main__":
    main()
