from argparse import ArgumentParser
from datetime import datetime, timezone
from time import monotonic, sleep

from api_connect.satio_session import SatIOSession
from api_connect.telemetry import post_telemetry_data
from utils.api_utilities import load_credentials
from simulator import propagate

from pydantic_models.definitions import VersionModel
from pydantic_models.telemetry_variables import TelemetryVariableModel
from pydantic_models.value_field import MatrixModel, ValueFieldModel

# Define telemetry variable IDs for position and velocity
POSITION_ID = "Sat1_Group1.navigation.position_vector"
VELOCITY_ID = "Sat1_Group1.navigation.velocity_vector"

# Model version as in SatOS: Keep this in sync with the SatOS model version
MODEL_VERSION = VersionModel(
    major=0,
    minor=2,
    patch=0,
)

# Define the telemetry variable models for position and velocity
def matrix_telemetry(
    telemetry_id: str,
    timestamp: datetime,
    values: list[float],
) -> TelemetryVariableModel:
    return TelemetryVariableModel(
        id=telemetry_id,
        timestamp=timestamp,
        value=ValueFieldModel(
            matrixValue=MatrixModel(
                rows=1,
                columns=3,
                values=values,
            )
        ),
        validity=True,
        version=MODEL_VERSION,
    )

# Build telemetry data for position and velocity
def build_state_telemetry(
    timestamp: datetime,
    position_m: list[float],
    velocity_mps: list[float],
) -> list[TelemetryVariableModel]:
    return [
        matrix_telemetry(POSITION_ID, timestamp, position_m),
        matrix_telemetry(VELOCITY_ID, timestamp, velocity_mps),
    ]

# Post the current state to the SatIO API
def post_current_state(
    *,
    elapsed_s: float,
    timestamp: datetime,
    dry_run: bool,
) -> None:
    state = propagate(Delta_t=elapsed_s)

    position_m = state[0].astype(float).tolist()
    velocity_mps = state[1].astype(float).tolist()
    telemetry = build_state_telemetry(timestamp, position_m, velocity_mps)

    if dry_run:
        print(
            f"[dry-run] {timestamp.isoformat()} "
            f"r={position_m} m v={velocity_mps} m/s"
        )
        return

    # Post the telemetry data to the SatIO API
    response = post_telemetry_data(
    session=SatIOSession.get_session(),
    telemetry_data=telemetry,
)
    # Check for errors in the response and raise an exception if the POST failed
    try:
        response.raise_for_status()
    except Exception as exc:
        print(f"SatOS telemetry POST failed: {response.status_code}")
        print(response.text)
        raise
    print(f"Posted simulated state at {timestamp.isoformat()}")


# Run the state poster with specified interval and sample count
def run_state_poster(
    *,
    interval_s: float,
    samples: int | None,
    dry_run: bool,
    session_refresh_interval_s: float = 120.0,
) -> None:
    simulation_start = monotonic()
    posted_samples = 0

    session = None
    session_started = 0.0

    try:
        while samples is None or posted_samples < samples:
            loop_start = monotonic()

            if not dry_run:
                session_expired = (
                    session is None
                    or loop_start - session_started >= session_refresh_interval_s
                )

                if session_expired:
                    if session is not None:
                        session.close()

                    session = SatIOSession()
                    session_started = loop_start
                    print("Refreshed SatOS session/token")

            elapsed_s = loop_start - simulation_start
            timestamp = datetime.now(tz=timezone.utc)

            post_current_state(
                elapsed_s=elapsed_s,
                timestamp=timestamp,
                dry_run=dry_run,
            )

            posted_samples += 1
            if samples is not None and posted_samples >= samples:
                break

            sleep(max(0.0, interval_s - (monotonic() - loop_start)))

    finally:
        if session is not None:
            session.close()


# Main function to run the state poster
def main() -> None:
    parser = ArgumentParser(
        description="Simulate satellite state and post to SatIO API.")
    
    # Add command-line arguments for simulation parameters
    parser.add_argument("--interval", type=float, default=10.0, help="Interval between state postings (seconds).")
    parser.add_argument("--samples", type=int, default=None, help="Number of samples to post (default: infinite).")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without posting data.")

    args = parser.parse_args()


    print(
        "Simulating/propagating satellite state and posting to SatIO API"
    )

    if args.dry_run:
        run_state_poster(
            interval_s=args.interval,
            samples=args.samples,
            dry_run=True,
        )
        return

    load_credentials()
    with SatIOSession():
        run_state_poster(
            interval_s=args.interval,
            samples=args.samples,
            dry_run=False,
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("State posting stopped by user.")
    except (RuntimeError, ValueError) as exc:
        print(f"State posting failed: {exc}")
        raise SystemExit(1)
