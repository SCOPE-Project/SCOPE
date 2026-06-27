from typing import Final


class Constants:
    """
    constants contains values of several constants used within orbital mechanics.

    Details:
      None

    Syntax:
      constants

    Inputs:
      None

    Outputs:
      None

    Examples:
      None

    See also:
      None
    Author:                     F. Turco
    Email:                      turcof@irs.uni-stuttgart.de
    Created:                    15-May-2024 16:41:10
    References:
      [1] D. A. Vallado, Fundamentals of Astrodynamics and Applications, 4th ed. Hawthorne, CA, USA: Microcosm Press, 2013.
      [2] National Imagery and Mapping Agency (NIMA), 'Department of Defense World Geodetic System 1984: its definition and relationships with local geodetic systems', TR8350.2, Jan. 2000.
      [3] O. Montenbruck, E. Gill, Satellite Orbits: Models, Methods, and Applications, Applied Mechanics Reviews 55 (2002) B27–B28. https://doi.org/10.1115/1.1451162.
      [4] R.R. Bate, D.D. Mueller, J.E. White, Fundamentals of astrodynamics, First publ, Dover Publ, New York, 1971.

    Revision history:
      None

    Implemented in Matlab R2024a.
    2024 Institute of Space Systems, University of Stuttgart.

    Ported to Python in 2026 by J. Homann.
    """

    # General
    SID_YEAR: Final[float] = 365.256363 * 24 * 60 * 60  # [s], Duration of a sidereal year, [1]
    SSO_YEAR: Final[float] = 365.2421897 * 24 * 60 * 60  # [s], Duration of one year for SSO, [1]
    SOLAR_DAY: Final[float] = 86400  # [s], Duration of a solar day, [1]
    c: Final[float] = 299792458  # [m/s], Speed of light in vacuum [3]
    G: Final[float] = 6.673e-11  # [m^3/kgs^2], Universal gravitational constant [3]

    # Earth
    R_E: Final[float] = 6378137  # [m], Earth's mean equatorial radius, [1,2]
    MU_E: Final[float] = 3.986004418e14  # [m^3/s^2], Earth's gravitational parameter, [1,2]
    ECC_E: Final[float] = 0.081819221456  # [-], Earth's eccentricity (not of its orbit!), [1]
    f_E: Final[float] = 1 / 298.257223563  # [-], Earth's flattening factor, [3]
    J2_E: Final[float] = 0.0010826267  #  [-], J2, [1]
    J3_E: Final[float] = -0.0000025327  #  [-], J3, [1]
    J4_E: Final[float] = -0.0000016196  #  [-], J4, [1]
    J5_E: Final[float] = -0.15e-6  #  [-], J5, [4]
    J6_E: Final[float] = 0.57e-6  #  [-], J6, [4]
    J7_E: Final[float] = -0.44e-7  #  [-], J7, [4]
    w_E: Final[float] = 0.7292115e-4  # [rad/s], Earth's rotational velocity, [3]

    # Sun
    R_S: Final[float] = 6.96e8  # [m], Sun's radius, [3]
    MU_S: Final[float] = 1.32712440018e20  # [m^3/s^2], Sun's gravitational parameter, [3]
    P_S: Final[float] = 4.560e-6  # [N/m^2], Solar radiation pressure at Earth, [3]
    AU: Final[float] = 149597870691  # [m], Astronomical unit, [3]

    # Moon
    R_M: Final[float] = 1738000  # [m], Moon's radius, [3]
    MU_M: Final[float] = 4902.801e9  # [m^3/s^2], Moon's gravitational parameter, [3]

    # Chemical constants from ADBSat
    R: Final[float] = 8.31446261815324  # Molar (Universal/Ideal) Gas constant [J K^-1 mol^-1]
    kb: Final[float] = 1.3806503e-23  # Boltzmann constant [m^2 kg^-2 K^-1]
    NA: Final[float] = 6.02214076e23  # Avogadro constant [n mol^-1]
    mHe: Final[float] = 4.002602  # Molecular mass of He [g mol^-1]
    mO: Final[float] = 15.9994  # Molecular mass of O [g mol^-1]
    mN2: Final[float] = 28.0134  # Molecular mass of N2 [g mol^-1]
    mO2: Final[float] = 31.9988  # Molecular mass of O2 [g mol^-1]
    mAr: Final[float] = 39.948  # Molecular mass of Ar [g mol^-1]
    mH: Final[float] = 1.0079  # Molecular mass of H [g mol^-1]
    mN: Final[float] = 14.0067  # Molecular mass of N [g mol^-1]
    mAnO: Final[float] = 15.99  # Molecular mass of anomalous oxygen [g mol^-1]

# ----------------- End of file -----------------