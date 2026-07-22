from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import numpy as np
import pytest


PIPELINE_DIRECTORY = Path(__file__).parents[1] / "orbit_propagation_pipeline"
sys.path.insert(0, str(PIPELINE_DIRECTORY))

from simulator import (  # noqa: E402
    J2000_UT,
    SatelliteDefinition,
    generate_satellite_states,
    geographic_longitude_to_raan_deg,
    greenwich_mean_sidereal_time_deg,
    seconds_since_j2000,
)


def satellite_definition(
    *,
    name: str = "satellite-1",
    inclination_deg: float = 70.0,
    longitude_deg: float = 30.0,
) -> SatelliteDefinition:
    return SatelliteDefinition(
        name=name,
        altitude_m=300_000.0,
        eccentricity=0.0001,
        inclination_deg=inclination_deg,
        ascending_node_longitude_deg=longitude_deg,
    )


def test_seconds_since_j2000_uses_aware_utc_datetime() -> None:
    timestamp = datetime(2000, 1, 2, 13, tzinfo=timezone(timedelta(hours=1)))

    assert seconds_since_j2000(timestamp) == pytest.approx(86_400.0)


def test_gmst_at_j2000_reference() -> None:
    assert greenwich_mean_sidereal_time_deg(J2000_UT) == pytest.approx(
        280.46061837,
        abs=1e-10,
    )


def test_east_longitude_is_added_to_gmst() -> None:
    assert geographic_longitude_to_raan_deg(30.0, J2000_UT) == pytest.approx(
        310.46061837,
        abs=1e-10,
    )


def test_generate_multiple_epoch_states_keyed_by_name() -> None:
    epoch = datetime(2030, 1, 1, tzinfo=timezone.utc)
    definitions = [
        satellite_definition(name="satellite-1", longitude_deg=30.0),
        satellite_definition(name="satellite-2", longitude_deg=-45.0),
    ]

    states = generate_satellite_states(epoch, definitions)

    assert list(states) == ["satellite-1", "satellite-2"]
    assert all(state.epoch_utc == epoch for state in states.values())
    assert all(
        "GCRF approximation" in state.reference_frame
        for state in states.values()
    )
    assert all(state.rv.shape == (6,) for state in states.values())
    assert all(np.all(np.isfinite(state.rv)) for state in states.values())
    assert states["satellite-1"].raan_deg == pytest.approx(
        geographic_longitude_to_raan_deg(30.0, epoch)
    )


def test_rejects_naive_datetime() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        generate_satellite_states(
            datetime(2030, 1, 1),
            [satellite_definition()],
        )


@pytest.mark.parametrize("inclination_deg", [0.0, 180.0])
def test_rejects_equatorial_orbit(inclination_deg: float) -> None:
    with pytest.raises(ValueError, match="no unique ascending node"):
        satellite_definition(inclination_deg=inclination_deg)


def test_rejects_duplicate_names() -> None:
    definitions = [satellite_definition(), satellite_definition()]

    with pytest.raises(ValueError, match="Duplicate satellite name"):
        generate_satellite_states(J2000_UT, definitions)
