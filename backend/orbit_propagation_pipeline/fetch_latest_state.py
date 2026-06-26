from argparse import ArgumentParser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from api_connect.satio_session import SatIOSession
from api_connect.telemetry import get_telemetry_data
from dotenv import load_dotenv


POSITION_ID = "Sat1_Group1.navigation.position_vector"
VELOCITY_ID = "Sat1_Group1.navigation.velocity_vector"


def load_credentials() -> None:
    credentials_path = Path(__file__).resolve().parents[2] / "SatOS_credentials" / "credentials.env"
    if not load_dotenv(credentials_path):
        raise Exception(f"No .env file found or empty at {credentials_path}")


def matrix_to_vector(value: Any) -> list[float]:
    if isinstance(value, dict) and "values" in value:
        value = value["values"]

    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], list):
        return [float(component) for component in value[0]]

    if isinstance(value, list):
        return [float(component) for component in value]

    raise TypeError(f"Expected matrix telemetry value, got {type(value).__name__}: {value!r}")


def latest_valid_sample(response) -> tuple[datetime, list[float]]:
    valid_samples = [sample for sample in response.values if sample[2]]
    if not valid_samples:
        raise ValueError(f"No valid samples found for {response.id}")

    timestamp, value, _valid = max(valid_samples, key=lambda sample: sample[0])
    return timestamp, matrix_to_vector(value)


def main() -> None:
    parser = ArgumentParser(description="Fetch the latest posted Sat1_Group1 Cartesian state from SatOS.")
    parser.add_argument("--hours", type=float, default=1.0, help="Lookback window in hours. Default: 1")
    args = parser.parse_args()

    load_credentials()

    end_time = datetime.now(tz=timezone.utc)
    start_time = end_time - timedelta(hours=args.hours)

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

    position_time, position_m = latest_valid_sample(position_response)
    velocity_time, velocity_mps = latest_valid_sample(velocity_response)
    timestamp_delta_s = abs((position_time - velocity_time).total_seconds())

    print(f"Fetched window: {start_time.isoformat()} to {end_time.isoformat()}")
    print(f"Position timestamp: {position_time.isoformat()}")
    print(f"Position GCRF [m]: {position_m}")
    print(f"Velocity timestamp: {velocity_time.isoformat()}")
    print(f"Velocity GCRF [m/s]: {velocity_mps}")
    print(f"Position/velocity timestamp delta [s]: {timestamp_delta_s:g}")


if __name__ == "__main__":
    main()
