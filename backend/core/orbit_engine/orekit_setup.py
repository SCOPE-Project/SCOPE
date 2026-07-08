# core/orbit_engine/orekit_setup.py

import os
import threading
from pathlib import Path

import jdk4py
import jpype
import orekit_jpype


# ==========================================
# OREKIT LOCKS AND JVM SETUP CACHE
_OREKIT_SETUP_LOCK = threading.Lock()
_OREKIT_ENVIRONMENT_IS_READY = False


# ==========================================
# OREKIT ENVIRONMENT SETUP
def setup_orekit_environment() -> None:
    """Initialize the JVM and load Orekit data exactly once per Python process."""
    global _OREKIT_ENVIRONMENT_IS_READY

    with _OREKIT_SETUP_LOCK:
        if _OREKIT_ENVIRONMENT_IS_READY:
            return

        # Set up the JVM and Orekit data path.
        project_root = Path(__file__).resolve().parents[3]
        orekit_data_path = project_root / "orekit-data"

        if not orekit_data_path.is_dir():
            raise FileNotFoundError(
                f"Orekit data directory not found at {orekit_data_path}."
            )

        # Set up the Java environment variables and paths.
        java_home_path = Path(jdk4py.JAVA_HOME)
        java_bin_path = java_home_path / "bin"

        os.environ["JAVA_HOME"] = str(java_home_path)

        current_path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if str(java_bin_path) not in current_path_entries:
            os.environ["PATH"] = (
                str(java_bin_path)
                + os.pathsep
                + os.environ.get("PATH", "")
            )

        jvm_library_candidates = [
            java_home_path / "bin" / "server" / "jvm.dll",         # Windows
            java_home_path / "lib" / "server" / "libjvm.so",       # Linux
            java_home_path / "lib" / "server" / "libjvm.dylib",    # macOS
        ]

        jvm_library_path = None
        for candidate_path in jvm_library_candidates:
            if candidate_path.exists():
                jvm_library_path = candidate_path
                break

        if jvm_library_path is None:
            raise FileNotFoundError(
                f"Could not find the JVM shared library below {java_home_path}."
            )

        if not jpype.isJVMStarted():
            orekit_jpype.initVM(jvmpath=str(jvm_library_path))

        # Load Orekit data from the local directory, not the pip package.
        from orekit_jpype.pyhelpers import setup_orekit_data

        setup_orekit_data(str(orekit_data_path), from_pip_library=False)
        _OREKIT_ENVIRONMENT_IS_READY = True
