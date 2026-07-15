# core/orbit_engine/propagator_builder.py

from org.orekit.propagation import BoundedPropagator
from org.orekit.propagation.numerical import NumericalPropagator
from org.orekit.frames import Frame
from datetime import datetime

from core.models.domain import SatelliteInformation
from core.orbit_engine.time_utils import normalize_datetime_to_utc


# ==========================================
# CONSTANTS
DEFAULT_POSITION_TOLERANCE_M = 10.0


# ==========================================
# SATELLITE PROPAGATOR SETUP
def build_satellite_propagator(
    satellite_info: SatelliteInformation,
    position_tolerance_m: float = DEFAULT_POSITION_TOLERANCE_M,
) -> tuple[NumericalPropagator, Frame]:
    """Build an Orekit numerical propagator from a Cartesian GCRF satellite state.

    setup_orekit_environment must run before this function imports Orekit classes.
    """
    if position_tolerance_m <= 0.0:
        raise ValueError("The position tolerance must be a positive number.")

    from orekit_jpype.pyhelpers import datetime_to_absolutedate
    from org.hipparchus.geometry.euclidean.threed import Vector3D
    from org.hipparchus.ode.nonstiff import DormandPrince853Integrator
    from org.orekit.forces.gravity import J2OnlyPerturbation, NewtonianAttraction
    from org.orekit.frames import FramesFactory
    from org.orekit.orbits import CartesianOrbit, OrbitType
    from org.orekit.propagation import SpacecraftState
    from org.orekit.propagation.numerical import NumericalPropagator
    from org.orekit.utils import IERSConventions, PVCoordinates

    from orbit_propagation_pipeline.utils.propagation_utils.constants import Constants

    state_timestamp = normalize_datetime_to_utc(satellite_info.state_timestamp)
    state_absolute_date = datetime_to_absolutedate(state_timestamp)

    inertial_frame = FramesFactory.getGCRF()
    earth_fixed_frame = FramesFactory.getITRF(IERSConventions.IERS_2010, True)

    # The domain model stores the Cartesian state in GCRF meters and meters per second.
    position_vector_m = Vector3D(
        float(satellite_info.position_r[0]),
        float(satellite_info.position_r[1]),
        float(satellite_info.position_r[2]),
    )
    velocity_vector_mps = Vector3D(
        float(satellite_info.velocity_v[0]),
        float(satellite_info.velocity_v[1]),
        float(satellite_info.velocity_v[2]),
    )

    pv_coordinates = PVCoordinates(
        position_vector_m,
        velocity_vector_mps,
    )
    initial_orbit = CartesianOrbit(
        pv_coordinates,
        inertial_frame,
        state_absolute_date,
        Constants.MU_E,
    )
    initial_spacecraft_state = SpacecraftState(initial_orbit)

    tolerance_vectors = NumericalPropagator.tolerances(
        float(position_tolerance_m),
        initial_orbit,
        OrbitType.CARTESIAN,
    )

    minimum_integration_step_seconds = 0.001
    maximum_integration_step_seconds = 60.0

    integrator = DormandPrince853Integrator(
        minimum_integration_step_seconds,
        maximum_integration_step_seconds,
        tolerance_vectors[0],
        tolerance_vectors[1],
    )

    propagator = NumericalPropagator(integrator)
    propagator.setOrbitType(OrbitType.CARTESIAN)
    propagator.setMu(Constants.MU_E)
    propagator.setInitialState(initial_spacecraft_state)

    # Current force model: Central Earth attraction plus J2.
    propagator.addForceModel(NewtonianAttraction(Constants.MU_E))
    propagator.addForceModel(
        J2OnlyPerturbation(
            Constants.MU_E,
            Constants.R_E,
            Constants.J2_E,
            earth_fixed_frame,
        )
    )

    return propagator, inertial_frame


# ==========================================
# SATELLITE PROPAGATION
def propagate_satellite(
    propagator: NumericalPropagator,
    start_time: datetime,
    end_time: datetime,
) -> BoundedPropagator:
    """Propagate one satellite and return the generated Orekit ephemeris.

    setup_orekit_environment must run before this function imports Orekit helpers.
    """
    propagation_start_time = normalize_datetime_to_utc(start_time)
    propagation_end_time = normalize_datetime_to_utc(end_time)

    if propagation_end_time <= propagation_start_time:
        raise ValueError("The propagation end time must be after the start time.")

    from orekit_jpype.pyhelpers import datetime_to_absolutedate

    start_absolute_date = datetime_to_absolutedate(propagation_start_time)
    end_absolute_date = datetime_to_absolutedate(propagation_end_time)

    # The ephemeris generator records the propagation result for later sampling.
    ephemeris_generator = propagator.getEphemerisGenerator()
    propagator.propagate(start_absolute_date, end_absolute_date)

    return ephemeris_generator.getGeneratedEphemeris()
