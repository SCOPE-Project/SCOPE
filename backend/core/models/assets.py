# core/models/assets.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List

APPROXIMATE_ECI_FRAME = "ECI (GMST-only GCRF approximation)"


@dataclass
class SatelliteInformation:
    name: str
    position_r: List[float]
    velocity_v: List[float]
    state_timestamp: datetime


@dataclass
class GroundStationInformation:
    name: str
    latitude: float
    longitude: float
    min_link_elevation: float


@dataclass
class TimeInterval:
    start_time: datetime
    end_time: datetime


@dataclass(frozen=True)
class SatelliteStateInputDefinition:
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
        from math import isfinite
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
    rv: list[float] | tuple[float, ...]
    reference_frame: str = APPROXIMATE_ECI_FRAME

    def __post_init__(self) -> None:
        import numpy as np
        rv_arr = np.asarray(self.rv, dtype=np.float64).copy()
        if rv_arr.shape != (6,) or not np.all(np.isfinite(rv_arr)):
            raise ValueError("rv must be a finite six-element vector.")
        object.__setattr__(self, "rv", tuple(rv_arr.tolist()))

    @property
    def position_m(self) -> list[float]:
        return list(self.rv[:3])

    @property
    def velocity_m_s(self) -> list[float]:
        return list(self.rv[3:])


@dataclass(frozen=True)
class UpdateSatelliteStateConfig:
    """Shared scenario epoch and satellite definitions."""
    epoch_utc: datetime
    satellites: tuple[SatelliteStateInputDefinition, ...]
