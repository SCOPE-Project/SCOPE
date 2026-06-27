from argparse import ArgumentParser
from pathlib import Path
import os

from fetch_latest_state import CartesianState, fetch_states
from utils.propagation_utils.constants import Constants

DEFAULT_STEP_SECONDS = 60.0
DEFAULT_SEARCH_HOURS = 24.0
DEFAULT_POSITION_TOLERANCE_M = 10.0
OREKIT_DATA_FILE = Path(__file__).with_name("orekit-data.zip")


def require_orekit_data_file() -> Path:
    if not OREKIT_DATA_FILE.exists():
        raise FileNotFoundError(f"Orekit data not found at {OREKIT_DATA_FILE}")
    return OREKIT_DATA_FILE


def _jdk_jvm_path() -> Path:
    import jdk4py

    java_home = Path(jdk4py.JAVA_HOME)
    candidates = [
        java_home / "bin" / "server" / "jvm.dll",
        java_home / "lib" / "server" / "libjvm.so",
        java_home / "lib" / "server" / "libjvm.dylib",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise FileNotFoundError(f"Could not find JVM shared library below {java_home}")


def setup_orekit() -> Path:
    data_path = require_orekit_data_file()

    import jdk4py
    import orekit_jpype

    java_home = Path(jdk4py.JAVA_HOME)
    os.environ["JAVA_HOME"] = str(java_home)
    os.environ["PATH"] = str(java_home / "bin") + os.pathsep + os.environ.get("PATH", "")

    orekit_jpype.initVM(jvmpath=str(_jdk_jvm_path()))

    from orekit_jpype.pyhelpers import setup_orekit_data

    setup_orekit_data(str(data_path), from_pip_library=False)
    return data_path


def sample_offsets(total_seconds: float, step_seconds: float) -> list[float]:
    if total_seconds <= 0:
        raise ValueError("hours must be greater than 0")
    if step_seconds <= 0:
        raise ValueError("step_seconds must be greater than 0")

    offsets = [0.0]
    next_offset = step_seconds
    while next_offset < total_seconds:
        offsets.append(next_offset)
        next_offset += step_seconds

    if abs(offsets[-1] - total_seconds) > 1e-9:
        offsets.append(total_seconds)
    return offsets


def _orekit_vector_to_list(vector) -> list[float]:
    return [float(vector.getX()), float(vector.getY()), float(vector.getZ())]


def _state_to_orbit(state: CartesianState):
    from orekit_jpype.pyhelpers import datetime_to_absolutedate
    from org.hipparchus.geometry.euclidean.threed import Vector3D
    from org.orekit.frames import FramesFactory
    from org.orekit.orbits import CartesianOrbit
    from org.orekit.utils import PVCoordinates

    date = datetime_to_absolutedate(state.timestamp)
    frame = FramesFactory.getGCRF()
    position = Vector3D(*state.position_m)
    velocity = Vector3D(*state.velocity_mps)
    pv_coordinates = PVCoordinates(position, velocity)
    return CartesianOrbit(pv_coordinates, frame, date, Constants.MU_E)


def _build_j2_propagator(initial_state: CartesianState, step_seconds: float):
    from org.hipparchus.ode.nonstiff import DormandPrince853Integrator
    from org.orekit.forces.gravity import J2OnlyPerturbation, NewtonianAttraction
    from org.orekit.frames import FramesFactory
    from org.orekit.orbits import OrbitType
    from org.orekit.propagation import SpacecraftState
    from org.orekit.propagation.numerical import NumericalPropagator
    from org.orekit.utils import IERSConventions

    orbit = _state_to_orbit(initial_state)
    tolerances = NumericalPropagator.tolerances(
        DEFAULT_POSITION_TOLERANCE_M,
        orbit,
        OrbitType.CARTESIAN,
    )
    integrator = DormandPrince853Integrator(
        0.001,
        max(step_seconds, 60.0),
        tolerances[0],
        tolerances[1],
    )

    propagator = NumericalPropagator(integrator)
    propagator.setOrbitType(OrbitType.CARTESIAN)
    propagator.setMu(Constants.MU_E)
    propagator.setInitialState(SpacecraftState(orbit))

    itrf_frame = FramesFactory.getITRF(IERSConventions.IERS_2010, True)
    propagator.addForceModel(NewtonianAttraction(Constants.MU_E))
    propagator.addForceModel(
        J2OnlyPerturbation(
            Constants.MU_E,
            Constants.R_E,
            Constants.J2_E,
            itrf_frame,
        )
    )
    return propagator, orbit.getFrame(), orbit.getDate()


def _propagate_state(
    initial_state: CartesianState,
    *,
    hours: float,
    step_seconds: float = DEFAULT_STEP_SECONDS,
) -> list[CartesianState]:
    setup_orekit()

    from orekit_jpype.pyhelpers import absolutedate_to_datetime

    total_seconds = hours * 3600.0
    offsets = sample_offsets(total_seconds, step_seconds)
    propagator, frame, initial_date = _build_j2_propagator(initial_state, step_seconds)

    propagated_states = []
    for offset in offsets:
        target_date = initial_date.shiftedBy(offset)
        spacecraft_state = propagator.propagate(target_date)
        pv_coordinates = spacecraft_state.getPVCoordinates(frame)
        propagated_states.append(
            CartesianState(
                timestamp=absolutedate_to_datetime(target_date, tz_aware=True),
                position_m=_orekit_vector_to_list(pv_coordinates.getPosition()),
                velocity_mps=_orekit_vector_to_list(pv_coordinates.getVelocity()),
            )
        )

    return propagated_states


def propagate_from_latest_state(
    *,
    hours: float,
    step_seconds: float = DEFAULT_STEP_SECONDS,
    search_hours: float = DEFAULT_SEARCH_HOURS,
) -> list[CartesianState]:
    if search_hours <= 0:
        raise ValueError("search_hours must be greater than 0")

    sample_offsets(hours * 3600.0, step_seconds)
    require_orekit_data_file()

    initial_state = fetch_states(count=1, search_hours=search_hours)[0]
    return _propagate_state(
        initial_state,
        hours=hours,
        step_seconds=step_seconds,
    )


def print_state(state: CartesianState) -> None:
    print(f"Timestamp: {state.timestamp.isoformat()}")
    print(f"Position GCRF [m]: {state.position_m}")
    print(f"Velocity GCRF [m/s]: {state.velocity_mps}")


def main() -> None:
    parser = ArgumentParser(
        description="Fetch the latest SatOS state and propagate it with Orekit J2."
    )
    parser.add_argument("--hours", type=float, required=True, help="Propagation horizon in hours.")
    parser.add_argument("--step-seconds", type=float, default=DEFAULT_STEP_SECONDS, help="Sampling step in seconds. Default: 60")
    parser.add_argument("--search-hours", type=float, default=DEFAULT_SEARCH_HOURS, help="Lookback window for fetching the latest SatOS state. Default: 24")
    args = parser.parse_args()

    states = propagate_from_latest_state(
        hours=args.hours,
        step_seconds=args.step_seconds,
        search_hours=args.search_hours,
    )

    print(f"Propagated {len(states)} state sample(s)")
    for index, state in enumerate(states, start=1):
        if len(states) > 1:
            print(f"\nState {index}")
        print_state(state)


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        print(f"Orekit propagation failed: {exc}")
        raise SystemExit(1)
