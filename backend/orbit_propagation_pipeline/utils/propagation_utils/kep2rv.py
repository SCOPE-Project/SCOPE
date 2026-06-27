import numpy as np
from numpy.typing import ArrayLike, NDArray

from utils.propagation_utils.constants import Constants
from utils.propagation_utils.M2Theta import m2theta


def kep2rv(kep: ArrayLike) -> NDArray[np.float64]:
    """
    kep2rv converts Keplerian elements into position and velocity in ECI.

    Syntax:
        [rv] = kep2rv(kep)

    Inputs:
        kep - [m,6], [double], Keplerian element sets with mean anomaly

    Outputs:
        rv - [m,6], [type], Position and velocity in ECI system

    References:
        [1] D.A. Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., Microcosm Press, Hawthorne, CA, USA, 2013.

     Implemented in Matlab R2025a.
     2025 Institute of Space Systems, University of Stuttgart.

    Ported to Python in 2026 by J. Homann.
    """

    kep = np.asarray(kep, dtype=np.float64)

    # Accept a single element set [a, e, i, RAAN, omega, M].
    if kep.ndim == 1:
        kep = kep[np.newaxis, :]

    if kep.ndim != 2 or kep.shape[1] != 6:
        raise ValueError(
            "kep must have shape (m, 6) or (6,), "
            f"but received {kep.shape}."
        )

    if not np.all(np.isfinite(kep)):
        raise ValueError("kep must contain only finite numerical values.")

    # Transposing allows all six columns to be unpacked directly.
    a, e, inclination, raan, arg_periapsis, mean_anomaly = kep.T

    true_anomaly = np.asarray(
        m2theta(mean_anomaly, e),
        dtype=np.float64,
    )

    # Semi-latus rectum.
    p = a * (1.0 - e**2)

    if np.any(p <= 0.0):
        raise ValueError(
            "The semi-latus rectum must be positive. Check a and e."
        )

    cos_theta = np.cos(true_anomaly)
    sin_theta = np.sin(true_anomaly)

    # Orbital radius.
    r_norm = p / (1.0 + e * cos_theta)

    zeros = np.zeros_like(true_anomaly)

    # Position in the perifocal coordinate system.
    r_pf = np.column_stack(
        (
            r_norm * cos_theta,
            r_norm * sin_theta,
            zeros,
        )
    )

    # Velocity in the perifocal coordinate system.
    velocity_factor = np.sqrt(Constants.MU_E / p)

    v_pf = np.column_stack(
        (
            -velocity_factor * sin_theta,
            velocity_factor * (e + cos_theta),
            zeros,
        )
    )

    cos_raan = np.cos(raan)
    sin_raan = np.sin(raan)

    cos_omega = np.cos(arg_periapsis)
    sin_omega = np.sin(arg_periapsis)

    cos_i = np.cos(inclination)
    sin_i = np.sin(inclination)

    number_of_states = kep.shape[0]

    # Perifocal-to-ECI rotation matrices.
    # Shape: (m, 3, 3)
    rotation = np.empty(
        (number_of_states, 3, 3),
        dtype=np.float64,
    )

    rotation[:, 0, 0] = (
        cos_raan * cos_omega
        - sin_raan * sin_omega * cos_i
    )
    rotation[:, 0, 1] = (
        -cos_raan * sin_omega
        - sin_raan * cos_omega * cos_i
    )
    rotation[:, 0, 2] = sin_raan * sin_i

    rotation[:, 1, 0] = (
        sin_raan * cos_omega
        + cos_raan * sin_omega * cos_i
    )
    rotation[:, 1, 1] = (
        -sin_raan * sin_omega
        + cos_raan * cos_omega * cos_i
    )
    rotation[:, 1, 2] = -cos_raan * sin_i

    rotation[:, 2, 0] = sin_omega * sin_i
    rotation[:, 2, 1] = cos_omega * sin_i
    rotation[:, 2, 2] = cos_i

    # Batched matrix-vector multiplication:
    #
    # rotation              -> (m, 3, 3)
    # r_pf[..., None]       -> (m, 3, 1)
    # result                -> (m, 3, 1)
    #
    # [..., 0] removes only the final singleton dimension.
    r_eci = (rotation @ r_pf[..., np.newaxis])[..., 0]
    v_eci = (rotation @ v_pf[..., np.newaxis])[..., 0]

    return np.hstack((r_eci, v_eci))
