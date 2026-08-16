import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

# Ensure backend root is in sys.path
backend_path = Path(__file__).resolve().parent.parent
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from core.astrodynamics import (
    Constants,
    J2000_UT,
    SatelliteStateInputDefinition,
    SatelliteState,
    UpdateSatelliteStateConfig,
    generate_satellite_states,
    geographic_longitude_to_raan_deg,
    greenwich_mean_sidereal_time_deg,
    kep2rv,
    m2theta,
    seconds_since_j2000,
)


def sample_satellite_definition(
    *,
    name: str = "satellite-1",
    inclination_deg: float = 70.0,
    longitude_deg: float = 30.0,
) -> SatelliteStateInputDefinition:
    return SatelliteStateInputDefinition(
        name=name,
        altitude_m=300_000.0,
        eccentricity=0.0001,
        inclination_deg=inclination_deg,
        ascending_node_longitude_deg=longitude_deg,
    )


def test_seconds_since_j2000_uses_aware_utc_datetime() -> None:
    timestamp = J2000_UT + timedelta(days=1)
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


def test_m2theta_newton_and_taylor() -> None:
    M = 0.5
    e = 0.01
    theta_newton = m2theta(M, e, mode="newton")
    theta_taylor = m2theta(M, e, mode="taylor")
    assert theta_newton == pytest.approx(theta_taylor, abs=1e-5)


def test_kep2rv_circular_orbit() -> None:
    r = Constants.R_E + 300_000.0
    v_circ = np.sqrt(Constants.MU_E / r)
    kep = [r, 0.0, 0.0, 0.0, 0.0, 0.0]
    rv = kep2rv(kep)[0]
    
    pos = rv[:3]
    vel = rv[3:]
    assert np.linalg.norm(pos) == pytest.approx(r, rel=1e-6)
    assert np.linalg.norm(vel) == pytest.approx(v_circ, rel=1e-6)


def test_generate_multiple_epoch_states_keyed_by_name() -> None:
    epoch = datetime(2030, 1, 1, tzinfo=timezone.utc)
    definitions = [
        sample_satellite_definition(name="satellite-1", longitude_deg=30.0),
        sample_satellite_definition(name="satellite-2", longitude_deg=-45.0),
    ]

    states = generate_satellite_states(epoch, definitions)

    assert list(states) == ["satellite-1", "satellite-2"]
    assert all(state.epoch_utc == epoch for state in states.values())
    assert all("GCRF approximation" in state.reference_frame for state in states.values())
    assert all(len(state.rv) == 6 for state in states.values())
    assert all(np.all(np.isfinite(state.rv)) for state in states.values())
    assert states["satellite-1"].raan_deg == pytest.approx(
        geographic_longitude_to_raan_deg(30.0, epoch)
    )
    assert len(states["satellite-1"].position_m) == 3
    assert len(states["satellite-1"].velocity_m_s) == 3


def test_rejects_naive_datetime() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        generate_satellite_states(
            datetime(2030, 1, 1),
            [sample_satellite_definition()],
        )


@pytest.mark.parametrize("inclination_deg", [0.0, 180.0])
def test_rejects_equatorial_orbit(inclination_deg: float) -> None:
    with pytest.raises(ValueError, match="no unique ascending node"):
        sample_satellite_definition(inclination_deg=inclination_deg)


def test_rejects_duplicate_names() -> None:
    definitions = [sample_satellite_definition(), sample_satellite_definition()]
    with pytest.raises(ValueError, match="Duplicate satellite name"):
        generate_satellite_states(J2000_UT, definitions)


def test_rejects_invalid_elements() -> None:
    with pytest.raises(ValueError, match="altitude_m must be greater than zero"):
        SatelliteStateInputDefinition(
            name="bad_alt",
            altitude_m=-10.0,
            eccentricity=0.01,
            inclination_deg=50.0,
            ascending_node_longitude_deg=0.0,
        )

    with pytest.raises(ValueError, match="eccentricity must satisfy 0 <= e < 1"):
        SatelliteStateInputDefinition(
            name="bad_ecc",
            altitude_m=300000.0,
            eccentricity=1.5,
            inclination_deg=50.0,
            ascending_node_longitude_deg=0.0,
        )

