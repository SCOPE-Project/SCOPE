from math import pi, sqrt

import numpy as np
from utils.propagation_utils.constants import Constants
from utils.propagation_utils.kep2rv import kep2rv

# Initial Keplerian elements for the satellite
a = Constants.R_E + 300_000.0
e = 0.0001
i = np.deg2rad(70.0)
raan = 0.0
omega = 0.0
m0 = 0.0

def propagate(Delta_t) -> tuple[np.ndarray, np.ndarray]:
    # Compute the mean anomaly at time t = t0 + Delta_t
    mean_anomaly = (m0 + sqrt(Constants.MU_E / a**3) * Delta_t) % (2 * pi)

    kep = np.array([
        a,
        e,
        i,
        raan,
        omega,
        mean_anomaly,
    ])

    # Convert Keplerian elements to Cartesian state in the an inertial frame. By Convention, this is the GCRF frame
    rv = kep2rv(kep)[0]
    position_m = rv[:3]
    velocity_m_s = rv[3:]

    # Return the position and velocity vectors in meters and meters per second
    return (position_m, velocity_m_s)
