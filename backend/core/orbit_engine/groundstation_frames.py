# core/orbit_engine/groundstation_frames.py

from org.orekit.frames import TopocentricFrame
from org.orekit.bodies import BodyShape
from dataclasses import dataclass
from math import radians

from core.models.domain import GroundStationInformation


# ==========================================
# CONSTANTS
DEFAULT_GROUNDSTATION_ALTITUDE_M = 0.0


# ==========================================
# INTERNAL DATACLASSES
@dataclass
class GroundStationRuntimeContext:
    """Runtime link between a ground station and its Orekit topocentric frame."""
    groundstation_info: GroundStationInformation
    topocentric_frame: TopocentricFrame


# ==========================================
# GROUND STATION FRAMES
def build_groundstation_contexts(
    groundstation_infos: list[GroundStationInformation],
    earth_shape: BodyShape,
) -> list[GroundStationRuntimeContext]:
    """Build Orekit topocentric frames for all selected ground stations."""
    from org.orekit.bodies import GeodeticPoint
    from org.orekit.frames import TopocentricFrame

    groundstation_contexts = []

    for groundstation_info in groundstation_infos:
        # Orekit geodetic latitude and longitude are expected in radians.
        latitude_rad = radians(groundstation_info.latitude)
        longitude_rad = radians(groundstation_info.longitude)
        altitude_m = DEFAULT_GROUNDSTATION_ALTITUDE_M

        geodetic_point = GeodeticPoint(
            latitude_rad,
            longitude_rad,
            altitude_m,
        )

        topocentric_frame = TopocentricFrame(
            earth_shape,
            geodetic_point,
            groundstation_info.name,
        )

        groundstation_context = GroundStationRuntimeContext(
            groundstation_info=groundstation_info,
            topocentric_frame=topocentric_frame,
        )
        groundstation_contexts.append(groundstation_context)

    return groundstation_contexts
