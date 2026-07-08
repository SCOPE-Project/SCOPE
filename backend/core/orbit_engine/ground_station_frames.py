# core/orbit_engine/ground_station_frames.py

from dataclasses import dataclass
from math import radians
from typing import Any

from core.models.domain import GroundStationInformation


# ==========================================
# CONSTANTS
DEFAULT_GROUND_STATION_ALTITUDE_M = 0.0


# ==========================================
# INTERNAL DATACLASSES
@dataclass
class GroundStationRuntimeContext:
    """Runtime link between a ground station and its Orekit topocentric frame."""
    ground_station_info: GroundStationInformation
    topocentric_frame: Any


# ==========================================
# GROUND STATION FRAMES
def build_ground_station_contexts(
    ground_station_infos: list[GroundStationInformation],
    earth_shape: Any,
) -> list[GroundStationRuntimeContext]:
    """Build Orekit topocentric frames for all selected ground stations."""
    from org.orekit.bodies import GeodeticPoint
    from org.orekit.frames import TopocentricFrame

    ground_station_contexts = []

    for ground_station_info in ground_station_infos:
        # Orekit geodetic latitude and longitude are expected in radians.
        latitude_rad = radians(ground_station_info.latitude)
        longitude_rad = radians(ground_station_info.longitude)
        altitude_m = DEFAULT_GROUND_STATION_ALTITUDE_M

        geodetic_point = GeodeticPoint(
            latitude_rad,
            longitude_rad,
            altitude_m,
        )

        topocentric_frame = TopocentricFrame(
            earth_shape,
            geodetic_point,
            ground_station_info.name,
        )

        ground_station_context = GroundStationRuntimeContext(
            ground_station_info=ground_station_info,
            topocentric_frame=topocentric_frame,
        )
        ground_station_contexts.append(ground_station_context)

    return ground_station_contexts
