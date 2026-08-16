from dataclasses import dataclass
from datetime import datetime, timezone
import json
from math import isfinite
from pathlib import Path
from typing import Iterable

import numpy as np
from numpy.typing import NDArray

from utils.propagation_utils.constants import Constants
from utils.propagation_utils.kep2rv import kep2rv

J2000_UT = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
SECONDS_PER_DAY = 86_400.0
JULIAN_CENTURY_DAYS = 36_525.0
APPROXIMATE_ECI_FRAME = "ECI (GMST-only GCRF approximation)"
DEFAULT_CONFIG_PATH = Path(__file__).with_name("simulator_config.json")


@dataclass(frozen=True)
class SatelliteDefinition:
    """User-facing orbital elements for one satellite.

    altitude_m is the semi-major-axis height above Constants.R_E. All angles
    are in degrees, and ascending_node_longitude_deg is east-positive.
    """

    name: str
    altitude_m: float
    eccentricity: float
    inclination_deg: float
    ascending_node_longitude_deg: float
    argument_of_periapsis_deg: float = 0.0
    mean_anomaly_deg: float = 0.0

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("Satellite name must not be empty.")

        numeric_values = (
            self.altitude_m,
            self.eccentricity,
            self.inclination_deg,
            self.ascending_node_longitude_deg,
            self.argument_of_periapsis_deg,
            self.mean_anomaly_deg,
        )
        if not all(isfinite(value) for value in numeric_values):
            raise ValueError("Satellite elements must contain only finite values.")

        if self.altitude_m <= 0.0:
            raise ValueError("altitude_m must be greater than zero.")
        if not 0.0 <= self.eccentricity < 1.0:
            raise ValueError("eccentricity must satisfy 0 <= e < 1.")
        if not 0.0 < self.inclination_deg < 180.0:
            raise ValueError(
                "inclination_deg must be between 0 and 180 degrees; "
                "equatorial orbits have no unique ascending node."
            )


@dataclass(frozen=True)
class SatelliteState:
    """Cartesian initial state generated at the shared scenario epoch."""

    name: str
    epoch_utc: datetime
    raan_deg: float
    rv: NDArray[np.float64]
    reference_frame: str = APPROXIMATE_ECI_FRAME

    def __post_init__(self) -> None:
        rv = np.asarray(self.rv, dtype=np.float64).copy()
        if rv.shape != (6,) or not np.all(np.isfinite(rv)):
            raise ValueError("rv must be a finite six-element vector.")
        rv.setflags(write=False)
        object.__setattr__(self, "rv", rv)

    @property
    def position_m(self) -> NDArray[np.float64]:
        return self.rv[:3]

    @property
    def velocity_m_s(self) -> NDArray[np.float64]:
        return self.rv[3:]


@dataclass(frozen=True)
class SimulationConfig:
    """Shared scenario epoch and satellite definitions loaded from JSON."""

    epoch_utc: datetime
    satellites: tuple[SatelliteDefinition, ...]


def _to_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware.")
    return timestamp.astimezone(timezone.utc)


def load_simulation_config(
    config_path: str | Path = DEFAULT_CONFIG_PATH,
) -> SimulationConfig:
    """Load and validate a simulation configuration from JSON."""

    config_path = Path(config_path)
    try:
        raw_config = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Simulation config not found: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Invalid JSON in simulation config {config_path}: {exc.msg}"
        ) from exc

    if not isinstance(raw_config, dict):
        raise ValueError("Simulation config must be a JSON object.")

    epoch_value = raw_config.get("epoch_utc")
    if not isinstance(epoch_value, str):
        raise ValueError("Simulation config field 'epoch_utc' must be a string.")

    try:
        epoch_utc = _to_utc(datetime.fromisoformat(epoch_value))
    except ValueError as exc:
        raise ValueError(
            "Simulation config field 'epoch_utc' must be an ISO 8601 "
            "timezone-aware datetime."
        ) from exc

    satellite_values = raw_config.get("satellites")
    if not isinstance(satellite_values, list) or not satellite_values:
        raise ValueError(
            "Simulation config field 'satellites' must be a non-empty array."
        )

    satellites = []
    for index, satellite_value in enumerate(satellite_values):
        if not isinstance(satellite_value, dict):
            raise ValueError(f"Satellite at index {index} must be a JSON object.")
        try:
            satellites.append(SatelliteDefinition(**satellite_value))
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Invalid satellite definition at index {index}: {exc}"
            ) from exc

    return SimulationConfig(
        epoch_utc=epoch_utc,
        satellites=tuple(satellites),
    )


def seconds_since_j2000(timestamp: datetime) -> float:
    """Return approximate UT seconds since 2000-01-01 12:00 UTC."""

    return (_to_utc(timestamp) - J2000_UT).total_seconds()


def greenwich_mean_sidereal_time_deg(timestamp: datetime) -> float:
    """Return approximate GMST in degrees, using UTC as an UT1 proxy."""

    days_since_j2000 = seconds_since_j2000(timestamp) / SECONDS_PER_DAY
    centuries_since_j2000 = days_since_j2000 / JULIAN_CENTURY_DAYS

    # Standard low-order GMST expression anchored at JD 2451545.0.
    gmst_deg = (
        280.46061837
        + 360.98564736629 * days_since_j2000
        + 0.000387933 * centuries_since_j2000**2
        - centuries_since_j2000**3 / 38_710_000.0
    )
    return gmst_deg % 360.0


def geographic_longitude_to_raan_deg(
    longitude_deg: float,
    timestamp: datetime,
) -> float:
    """Convert an east-positive node longitude to approximate inertial RAAN."""

    if not isfinite(longitude_deg):
        raise ValueError("longitude_deg must be finite.")
    return (greenwich_mean_sidereal_time_deg(timestamp) + longitude_deg) % 360.0


def generate_satellite_states(
    epoch_utc: datetime,
    definitions: Iterable[SatelliteDefinition],
) -> dict[str, SatelliteState]:
    """Generate one epoch RV vector for every configured satellite."""

    epoch_utc = _to_utc(epoch_utc)
    states: dict[str, SatelliteState] = {}

    for definition in definitions:
        if definition.name in states:
            raise ValueError(f"Duplicate satellite name: {definition.name!r}.")

        raan_deg = geographic_longitude_to_raan_deg(
            definition.ascending_node_longitude_deg,
            epoch_utc,
        )
        keplerian_elements = np.array(
            [
                Constants.R_E + definition.altitude_m,
                definition.eccentricity,
                np.deg2rad(definition.inclination_deg),
                np.deg2rad(raan_deg),
                np.deg2rad(definition.argument_of_periapsis_deg % 360.0),
                np.deg2rad(definition.mean_anomaly_deg % 360.0),
            ],
            dtype=np.float64,
        )
        rv = kep2rv(keplerian_elements)[0]
        states[definition.name] = SatelliteState(
            name=definition.name,
            epoch_utc=epoch_utc,
            raan_deg=raan_deg,
            rv=rv,
        )

    return states


def main() -> None:
    config = load_simulation_config()
    states = generate_satellite_states(config.epoch_utc, config.satellites)
    print(f"Epoch (UTC): {config.epoch_utc.isoformat()}")

    for state in states.values():
        rv_text = np.array2string(
            state.rv,
            precision=6,
            separator=", ",
            suppress_small=False,
        )
        print(f"\n{state.name}")
        print(f"  Frame: {state.reference_frame}")
        print(f"  RAAN: {state.raan_deg:.9f} deg")
        print(f"  RV [position m, velocity m/s]: {rv_text}")

        from api_connect.satellites import get_satellite, post_satellite
        from api_connect.satio_session import SatIOSession

        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        import sys
        from dotenv import load_dotenv

        # Add the backend directory to sys.path to resolve core module imports
        sys.path.append(str(Path(__file__).resolve().parent.parent))

        credentials_path = Path(__file__).resolve().parent.parent / "SatOS_credentials" / "credentials.env"

        # Make sure the .env file exists and is filled correctly
        if not load_dotenv(credentials_path):
            raise Exception("No .env file found or empty")


        with SatIOSession() as session:
            # 1. Fetch current satellite definition
            satellite = get_satellite(session, satellite_name=state.name)
            print(satellite.version.model_dump())
            # 2. Locate the target variable and update its default value
            for var in satellite.variableDefinitions:
                print(var.name)
                if var.name == "position_vector" and var.matrixDefinition:
                    print("Found position_vector")
                    print(var.matrixDefinition.defaultValue)
                    
                    # Set new value
                    var.matrixDefinition.defaultValue = state.position_m.tolist()
                    

                if var.name == "velocity_vector" and var.matrixDefinition:
                    print("Found velocity_vector")
                    print(var.matrixDefinition.defaultValue)
                                    
                    # Set new value
                    var.matrixDefinition.defaultValue = state.velocity_m_s.tolist()

                if var.name == "state_timestamp" and var.timeDefinition:
                    print("Found state_timestamp")
                    print(var.timeDefinition.defaultValue)
                
                    # Set new value
                    var.timeDefinition.defaultValue = state.epoch_utc.isoformat()
                                        
            # 3. (Optional) Bump patch version
            satellite.version.patch += 1
            
            # 4. Post updated model back to SatOS
            response = post_satellite(session, satellite)
            response.raise_for_status()


if __name__ == "__main__":
    main()
