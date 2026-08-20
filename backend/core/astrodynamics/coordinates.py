from datetime import datetime, timezone
from math import isfinite
from typing import Iterable

import numpy as np

from core.astrodynamics.constants import Constants
from core.astrodynamics.kepler import kep2rv
from core.models.assets import SatelliteStateInputDefinition, SatelliteState

J2000_UT = datetime(2000, 1, 1, 11, 58, 55, 816000, tzinfo=timezone.utc)
SECONDS_PER_DAY = 86_400.0
JULIAN_CENTURY_DAYS = 36_525.0



def _to_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware.")
    return timestamp.astimezone(timezone.utc)


def seconds_since_j2000(timestamp: datetime) -> float:
    """Return approximate UT seconds since 2000-01-01 11:58:55.816 UTC."""
    return (_to_utc(timestamp) - J2000_UT).total_seconds()


def greenwich_mean_sidereal_time_deg(timestamp: datetime) -> float:
    """Return approximate GMST in degrees, using UTC as a UT1 proxy."""
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
    definitions: Iterable[SatelliteStateInputDefinition],
) -> dict[str, SatelliteState]:
    """Generate one epoch RV state vector for every configured satellite."""
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
            rv=rv.tolist(),
        )

    return states
