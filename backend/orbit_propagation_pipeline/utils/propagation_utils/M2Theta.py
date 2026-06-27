
from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray

"""
M2theta converts mean anomaly to true anomaly by solving the Kepler Equation 
using either Newton's method or a Taylor series approximation. 

Syntax:  
  [theta] = M2theta(M, e, eps)

Inputs:
  M - [m,1], [double], Mean anomaly
  e - [m,1], [double], Eccentricity
  mode - [string], Solving mode for Kepler equation ("newton" or "taylor"),
  default: "newton"

Outputs:
  theta - [m,1], [double], True anomaly
             
References:
  - 

Implemented in Matlab R2025a.
2025 Institute of Space Systems, University of Stuttgart.

Ported to Python in 2026 by J. Homann.
"""

def m2theta(
    M: ArrayLike,
    e: ArrayLike,
    mode: Literal["newton", "taylor"] = "newton",
    *,
    tolerance: float = 1e-6,
    max_iterations: int = 100,
) -> NDArray[np.float64]:
    
    M, e = np.broadcast_arrays(
        np.asarray(M, dtype=np.float64),
        np.asarray(e, dtype=np.float64),
    )

    if not np.all(np.isfinite(M)):
        raise ValueError("M must contain only finite values.")

    if not np.all(np.isfinite(e)):
        raise ValueError("e must contain only finite values.")

    if np.any((e < 0.0) | (e >= 1.0)):
        raise ValueError(
            "m2theta supports elliptic orbits with 0 <= e < 1."
        )

    if mode == "newton":
        E_previous = M.copy()

        for _ in range(max_iterations):
            E = E_previous - (
                E_previous
                - e * np.sin(E_previous)
                - M
            ) / (
                1.0 - e * np.cos(E_previous)
            )

            error = np.max(np.abs(E - E_previous))

            if error <= tolerance:
                break

            E_previous = E

        else:
            raise RuntimeError(
                "Newton's method did not converge within "
                f"{max_iterations} iterations."
            )

        theta = np.arctan2(
            np.sqrt(1.0 - e**2) * np.sin(E),
            np.cos(E) - e,
        )

    elif mode == "taylor":
        E = _eccentric_anomaly_taylor(M, e)

        denominator = 1.0 - e * np.cos(E)

        cos_theta = (
            np.cos(E) - e
        ) / denominator

        sin_theta = (
            np.sqrt(1.0 - e**2)
            * np.sin(E)
            / denominator
        )

        theta = np.arctan2(
            sin_theta,
            cos_theta,
        )

        # MATLAB:
        # theta(theta < 0) = theta(theta < 0) + 2*pi
        theta = np.where(
            theta < 0.0,
            theta + 2.0 * np.pi,
            theta,
        )

    else:
        raise ValueError(
            "mode must be either 'newton' or 'taylor'."
        )
    
    theta = np.mod(theta, 2.0 * np.pi)
    
    return theta


def _eccentric_anomaly_taylor(
    M: NDArray[np.float64],
    e: NDArray[np.float64],
) -> NDArray[np.float64]:
    """
    Approximate eccentric anomaly using an order-20
    Taylor series.
    """
    sin = np.sin

    E = (
        M
        + sin(M) * e
        + sin(0.2e1 * M) * e**2 / 0.2e1
        + (
            -sin(M) / 0.8e1
            + 0.3e1 / 0.8e1 * sin(0.3e1 * M)
        ) * e**3
        + (
            sin(0.4e1 * M) / 0.3e1
            - sin(0.2e1 * M) / 0.6e1
        ) * e**4
        + (
            sin(M) / 0.192e3
            + 0.125e3 / 0.384e3 * sin(0.5e1 * M)
            - 0.27e2 / 0.128e3 * sin(0.3e1 * M)
        ) * e**5
        + (
            0.27e2 / 0.80e2 * sin(0.6e1 * M)
            + sin(0.2e1 * M) / 0.48e2
            - 0.4e1 / 0.15e2 * sin(0.4e1 * M)
        ) * e**6
        + (
            -0.3125e4 / 0.9216e4 * sin(0.5e1 * M)
            + 0.16807e5 / 0.46080e5 * sin(0.7e1 * M)
            - sin(M) / 0.9216e4
            + 0.243e3 / 0.5120e4 * sin(0.3e1 * M)
        ) * e**7
        + (
            -sin(0.2e1 * M) / 0.720e3
            + 0.128e3 / 0.315e3 * sin(0.8e1 * M)
            - 0.243e3 / 0.560e3 * sin(0.6e1 * M)
            + 0.4e1 / 0.45e2 * sin(0.4e1 * M)
        ) * e**8
        + (
            -0.823543e6 / 0.1474560e7 * sin(0.7e1 * M)
            + sin(M) / 0.737280e6
            - 0.243e3 / 0.40960e5 * sin(0.3e1 * M)
            + 0.78125e5 / 0.516096e6 * sin(0.5e1 * M)
            + 0.531441e6 / 0.1146880e7 * sin(0.9e1 * M)
        ) * e**9
        + (
            -0.2048e4 / 0.2835e4 * sin(0.8e1 * M)
            - 0.16e2 / 0.945e3 * sin(0.4e1 * M)
            + 0.2187e4 / 0.8960e4 * sin(0.6e1 * M)
            + sin(0.2e1 * M) / 0.17280e5
            + 0.78125e5 / 0.145152e6 * sin(0.10e2 * M)
        ) * e**10
        + (
            -sin(M) / 0.88473600e8
            - 0.43046721e8 / 0.45875200e8 * sin(0.9e1 * M)
            + 0.2357947691e10 / 0.3715891200e10
            * sin(0.11e2 * M)
            + 0.2187e4 / 0.4587520e7 * sin(0.3e1 * M)
            - 0.1953125e7 / 0.49545216e8 * sin(0.5e1 * M)
            + 0.40353607e8 / 0.106168320e9 * sin(0.7e1 * M)
        ) * e**11
        + (
            0.1458e4 / 0.1925e4 * sin(0.12e2 * M)
            + 0.8192e4 / 0.14175e5 * sin(0.8e1 * M)
            - 0.1953125e7 / 0.1596672e7 * sin(0.10e2 * M)
            - sin(0.2e1 * M) / 0.604800e6
            + 0.2e1 / 0.945e3 * sin(0.4e1 * M)
            - 0.729e3 / 0.8960e4 * sin(0.6e1 * M)
        ) * e**12
        + (
            0.3486784401e10 / 0.4037017600e10
            * sin(0.9e1 * M)
            + 0.48828125e8 / 0.7134511104e10
            * sin(0.5e1 * M)
            - 0.19683e5 / 0.734003200e9
            * sin(0.3e1 * M)
            - 0.1977326743e10 / 0.12740198400e11
            * sin(0.7e1 * M)
            - 0.285311670611e12 / 0.178362777600e12
            * sin(0.11e2 * M)
            + sin(M) / 0.14863564800e11
            + 0.1792160394037e13 / 0.1961990553600e13
            * sin(0.13e2 * M)
        ) * e**13
        + (
            -0.131072e6 / 0.467775e6 * sin(0.8e1 * M)
            + 0.6561e4 / 0.358400e6 * sin(0.6e1 * M)
            + sin(0.2e1 * M) / 0.29030400e8
            - 0.52488e5 / 0.25025e5 * sin(0.12e2 * M)
            + 0.1977326743e10 / 0.1779148800e10
            * sin(0.14e2 * M)
            + 0.48828125e8 / 0.38320128e8
            * sin(0.10e2 * M)
            - 0.8e1 / 0.42525e5 * sin(0.4e1 * M)
        ) * e**14
        + (
            -0.31381059609e11 / 0.64592281600e11
            * sin(0.9e1 * M)
            + 0.96889010407e11 / 0.2242274918400e13
            * sin(0.7e1 * M)
            + 0.34522712143931e14 / 0.18549728870400e14
            * sin(0.11e2 * M)
            - sin(M) / 0.3329438515200e13
            - 0.48828125e8 / 0.57076088832e11
            * sin(0.5e1 * M)
            - 0.302875106592253e15 / 0.109871471001600e15
            * sin(0.13e2 * M)
            + 0.6561e4 / 0.5872025600e10
            * sin(0.3e1 * M)
            + 0.320361328125e12 / 0.235115905024e12
            * sin(0.15e2 * M)
        ) * e**15
        + (
            -sin(0.2e1 * M) / 0.1828915200e10
            + 0.8e1 / 0.637875e6 * sin(0.4e1 * M)
            + 0.131072e6 / 0.1403325e7 * sin(0.8e1 * M)
            + 0.472392e6 / 0.175175e6 * sin(0.12e2 * M)
            + 0.1073741824e10 / 0.638512875e9
            * sin(0.16e2 * M)
            - 0.1220703125e10 / 0.1494484992e10
            * sin(0.10e2 * M)
            - 0.59049e5 / 0.19712000e8 * sin(0.6e1 * M)
            - 0.96889010407e11 / 0.26687232000e11
            * sin(0.14e2 * M)
        ) * e**16
        + (
            sin(M) / 0.958878292377600e15
            + 0.2541865828329e13 / 0.13435194572800e14
            * sin(0.9e1 * M)
            + 0.1220703125e10 / 0.15068087451648e14
            * sin(0.5e1 * M)
            - 0.4747561509943e13 / 0.538145980416000e15
            * sin(0.7e1 * M)
            + 0.51185893014090757e17
            / 0.13184576520192000e17
            * sin(0.13e2 * M)
            + 0.2862423051509815793e19
            / 0.1371195958099968000e19
            * sin(0.17e2 * M)
            - 0.59049e5 / 0.1644167168000e13
            * sin(0.3e1 * M)
            - 0.72081298828125e14
            / 0.15047417921536e14
            * sin(0.15e2 * M)
            - 0.4177248169415651e16
            / 0.3116354450227200e16
            * sin(0.11e2 * M)
        ) * e**17
        + (
            sin(0.2e1 * M) / 0.146313216000e12
            - 0.1889568e7 / 0.875875e6
            * sin(0.12e2 * M)
            + 0.30517578125e11 / 0.83691159552e11
            * sin(0.10e2 * M)
            + 0.4747561509943e13 / 0.853991424000e12
            * sin(0.14e2 * M)
            + 0.59049e5 / 0.157696000e9
            * sin(0.6e1 * M)
            - 0.2097152e7 / 0.91216125e8
            * sin(0.8e1 * M)
            - 0.68719476736e11 / 0.10854718875e11
            * sin(0.16e2 * M)
            - 0.32e2 / 0.49116375e8
            * sin(0.4e1 * M)
            + 0.2541865828329e13 / 0.975822848000e12
            * sin(0.18e2 * M)
        ) * e**18
        + (
            -0.205891132094649e15
            / 0.3761854480384000e16
            * sin(0.9e1 * M)
            - 0.30517578125e11
            / 0.5062877383753728e16
            * sin(0.5e1 * M)
            - sin(M) / 0.345196185255936000e18
            + 0.232630513987207e15
            / 0.167901545889792000e18
            * sin(0.7e1 * M)
            + 0.5480386857784802185939e22
            / 0.1678343852714360832000e22
            * sin(0.19e2 * M)
            + 0.16218292236328125e17
            / 0.2046448837328896e16
            * sin(0.15e2 * M)
            - 0.8650415919381337933e19
            / 0.2531438691876864000e19
            * sin(0.13e2 * M)
            + 0.505447028499293771e18
            / 0.747925068054528000e18
            * sin(0.11e2 * M)
            - 0.827240261886336764177e21
            / 0.98726108983197696000e20
            * sin(0.17e2 * M)
            + 0.531441e6 / 0.578746843136000e15
            * sin(0.3e1 * M)
        ) * e**19
        + (
            -0.232630513987207e15
            / 0.43553562624000e14
            * sin(0.14e2 * M)
            + 0.8388608e7 / 0.1915538625e10
            * sin(0.8e1 * M)
            + 0.1099511627776e13 / 0.97692469875e11
            * sin(0.16e2 * M)
            - 0.30517578125e11 / 0.251073478656e12
            * sin(0.10e2 * M)
            - sin(0.2e1 * M) / 0.14485008384000e14
            + 0.1062882e7 / 0.875875e6
            * sin(0.12e2 * M)
            + 0.4e1 / 0.147349125e9
            * sin(0.4e1 * M)
            - 0.531441e6 / 0.14350336000e11
            * sin(0.6e1 * M)
            - 0.205891132094649e15
            / 0.18540634112000e14
            * sin(0.18e2 * M)
            + 0.61035156250e11
            / 0.14849255421e11
            * sin(0.20e2 * M)
        ) * e**20
    )

    return E
