from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Iterable

import numpy as np
from numpy.typing import NDArray

from utils.propagation_utils.constants import Constants
from utils.propagation_utils.kep2rv import kep2rv


J2000_UT = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
SECONDS_PER_DAY = 86_400.0
JULIAN_CENTURY_DAYS = 36_525.0
APPROXIMATE_ECI_FRAME = "ECI (GMST-only GCRF approximation)"


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


# Edit this epoch and list to define the initial states for a scenario.
SCENARIO_EPOCH_UTC = datetime(2030, 1, 1, tzinfo=timezone.utc)

SATELLITE_DEFINITIONS = [
    SatelliteDefinition(
        name="satellite-1",
        altitude_m=300_000.0,
        eccentricity=0.0001,
        inclination_deg=70.0,
        ascending_node_longitude_deg=30.0,
        argument_of_periapsis_deg=0.0,
        mean_anomaly_deg=0.0,
    ),
    SatelliteDefinition(
            name="satellite-2",
            altitude_m=300_000.0,
            eccentricity=0.0001,
            inclination_deg=71.0,
            ascending_node_longitude_deg=30.5,
            argument_of_periapsis_deg=0.0,
            mean_anomaly_deg=1.0,
        ),
    SatelliteDefinition(
            name="satellite-3",
            altitude_m=300_000.0,
            eccentricity=0.0001,
            inclination_deg=72.0,
            ascending_node_longitude_deg=31.0,
            argument_of_periapsis_deg=0.0,
            mean_anomaly_deg=2.0,
        ),
]


def _to_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware.")
    return timestamp.astimezone(timezone.utc)


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
    epoch_utc: datetime = SCENARIO_EPOCH_UTC,
    definitions: Iterable[SatelliteDefinition] | None = None,
) -> dict[str, SatelliteState]:
    """Generate one epoch RV vector for every configured satellite."""

    epoch_utc = _to_utc(epoch_utc)
    definitions = SATELLITE_DEFINITIONS if definitions is None else definitions
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
    states = generate_satellite_states()
    print(f"Epoch (UTC): {SCENARIO_EPOCH_UTC.isoformat()}")

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


if __name__ == "__main__":
    main()
