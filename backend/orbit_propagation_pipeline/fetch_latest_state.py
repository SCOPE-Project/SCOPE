from argparse import ArgumentParser
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from api_connect.satio_session import SatIOSession
from api_connect.telemetry import get_telemetry_data
from utils.api_utilities import load_credentials

# Define telemetry variable IDs for position and velocity
POSITION_ID = "Sat1_Group1.navigation.position_vector"
VELOCITY_ID = "Sat1_Group1.navigation.velocity_vector"
DEFAULT_COUNT_SEARCH_HOURS = 24.0

# Define a dataclass to represent the Cartesian state of the satellite
@dataclass(frozen=True)
class CartesianState:
    timestamp: datetime
    position_m: list[float]
    velocity_mps: list[float]

# Function to flatten the telemetry value into a list of floats (vector)
def flatten(value: Any) -> list[float]:

    # Only expect the value to be a list of lists (matrix) and extract the first and only row (vector)
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], list):
        return [float(component) for component in value[0]]

    # Otherwise, raise error
    raise TypeError(f"Expected matrix telemetry value, got {type(value).__name__}: {value!r}")

# Function to extract valid samples from the telemetry response
def valid_samples(response) -> list[tuple[datetime, list[float]]]:
    return [
        (timestamp, flatten(value))
        for timestamp, value, valid in response.values
        if valid
    ]

# Function to find the latest complete valid Cartesian states from position and velocity telemetry responses
def latest_complete_states(
    position_response,
    velocity_response,
    count: int | None = None,
) -> list[CartesianState]:
    if count is not None and count < 1:
        raise ValueError("count must be at least 1")

    position_samples = dict(valid_samples(position_response))
    velocity_samples = dict(valid_samples(velocity_response))
    common_timestamps = sorted(     # Sort the timestamps in descending order to get the latest states first
        position_samples.keys() & velocity_samples.keys(), # Find the intersection of timestamps that have both valid position and velocity samples
        reverse=True,
    )

    if not common_timestamps:
        raise ValueError("No complete valid position/velocity states found")

    selected_timestamps = common_timestamps
    if count is not None:
        selected_timestamps = common_timestamps[:count]

    return [
        CartesianState(
            timestamp=timestamp,
            position_m=position_samples[timestamp],
            velocity_mps=velocity_samples[timestamp],
        )
        for timestamp in selected_timestamps
    ]

# Function to fetch complete valid Cartesian states from the SatOS API
def fetch_complete_states(
        
    *,
    hours: float,
    count: int | None = None,
) -> list[CartesianState]:
    if count is not None and count < 1:
        raise ValueError("count must be at least 1")
    if hours <= 0:
        raise ValueError("hours must be greater than 0")

    load_credentials()

    end_time = datetime.now(tz=timezone.utc)
    start_time = end_time - timedelta(hours=hours)

    with SatIOSession():
        position_response = get_telemetry_data(
            session=SatIOSession.get_session(),
            param_address=POSITION_ID,
            start_time=start_time,
            end_time=end_time,
        )
        velocity_response = get_telemetry_data(
            session=SatIOSession.get_session(),
            param_address=VELOCITY_ID,
            start_time=start_time,
            end_time=end_time,
        )

    states = latest_complete_states(
        position_response=position_response,
        velocity_response=velocity_response,
        count=count,
    )
    if count is not None and len(states) < count:
        raise ValueError(
            f"Only found {len(states)} complete valid states in the last {hours:g} hours"
        )

    return states


# Function to fetch either all states from a time window or the latest N states
def fetch_states(
    *,
    hours: float | None = None,
    count: int | None = None,
    search_hours: float = DEFAULT_COUNT_SEARCH_HOURS,
) -> list[CartesianState]:
    if (hours is None) == (count is None):
        raise ValueError("Pass exactly one of hours or count")

    if hours is not None:
        return fetch_complete_states(hours=hours)

    return fetch_complete_states(hours=search_hours, count=count)


def print_state(state: CartesianState) -> None:
    print(f"Timestamp: {state.timestamp.isoformat()}")
    print(f"Position GCRF [m]: {state.position_m}")
    print(f"Velocity GCRF [m/s]: {state.velocity_mps}")


def latest_valid_sample(response) -> tuple[datetime, list[float]]:
    valid_samples_list = valid_samples(response)
    if not valid_samples_list:
        raise ValueError(f"No valid samples found for {response.id}")

    return max(valid_samples_list, key=lambda sample: sample[0])


def main() -> None:
    parser = ArgumentParser(description="Fetch the latest posted Sat1_Group1 Cartesian state from SatOS.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--hours", type=float, help="Fetch all complete states from the last HOURS hours.")
    mode.add_argument("--count", type=int, help="Fetch the latest COUNT complete states.")
    parser.add_argument(
        "--search-hours",
        type=float,
        default=DEFAULT_COUNT_SEARCH_HOURS,
        help="Lookback window used only with --count. Default: 24",
    )
    args = parser.parse_args()

    if args.hours is not None:
        states = fetch_states(hours=args.hours)
        print(f"Fetched {len(states)} complete state(s) from the last {args.hours:g} hours")
    else:
        count = args.count if args.count is not None else 1
        states = fetch_states(count=count, search_hours=args.search_hours)
        print(f"Fetched the latest {len(states)} complete state(s)")

    for index, state in enumerate(states, start=1):
        if len(states) > 1:
            print(f"\nState {index}")
        print_state(state)


if __name__ == "__main__":
    main()
