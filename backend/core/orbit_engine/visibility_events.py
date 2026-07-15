# core/orbit_engine/visibility_events.py

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import radians
from typing import TYPE_CHECKING, Any

import jpype

from core.models.domain import GroundStationInformation, SatelliteInformation
from core.orbit_engine.groundstation_frames import GroundStationRuntimeContext
from core.orbit_engine.time_utils import normalize_datetime_to_utc

if TYPE_CHECKING:
    from org.hipparchus.ode.events import Action
    from org.orekit.propagation import SpacecraftState
    from org.orekit.propagation.events import EventDetector
    from org.orekit.propagation.numerical import NumericalPropagator
    from org.orekit.time import AbsoluteDate



# ==========================================
# INTERNAL DATACLASSES
@dataclass
class OverpassEvent:
    """Internal AOS/LOS event pair for one satellite and one ground station."""
    satellite_name: str
    groundstation_info: GroundStationInformation
    start_time: datetime
    end_time: datetime


# ==========================================
# VISIBILITY EVENT HANDLING
class VisibilityEventHandler:
    """Collect AOS/LOS event pairs for one satellite-groundstation detector."""

    def __init__(
        self,
        satellite_name: str,
        groundstation_info: GroundStationInformation,
        satellite_event_log: list[OverpassEvent],
        propagation_start_time: datetime,
        propagation_end_time: datetime,
    ) -> None:
        self.satellite_name = satellite_name
        self.groundstation_info = groundstation_info
        self.satellite_event_log = satellite_event_log
        self.propagation_start_time = normalize_datetime_to_utc(
            propagation_start_time,
        )
        self.propagation_end_time = normalize_datetime_to_utc(
            propagation_end_time,
        )
        self.current_overpass_start_time = None

    def init(
        self,
        initial_state: SpacecraftState,
        target: AbsoluteDate,
        detector: EventDetector,
    ) -> None:
        """Remember visibility at propagation start when the pass is already active."""
        is_visible_at_start = detector.g(initial_state) >= 0.0

        if is_visible_at_start:
            self.current_overpass_start_time = self.propagation_start_time

    def eventOccurred(
        self,
        spacecraft_state: SpacecraftState,
        detector: EventDetector,
        increasing: bool,
    ) -> Action:
        """Handle one elevation threshold crossing and keep propagation running."""
        from orekit_jpype.pyhelpers import absolutedate_to_datetime
        from org.hipparchus.ode.events import Action

        event_time = absolutedate_to_datetime(
            spacecraft_state.getDate(),
            tz_aware=True,
        )
        event_time = normalize_datetime_to_utc(event_time)

        if increasing:
            if self.current_overpass_start_time is None:
                self.current_overpass_start_time = event_time

            return Action.CONTINUE

        overpass_start_time = self.current_overpass_start_time

        if overpass_start_time is None:
            overpass_start_time = self.propagation_start_time

        if event_time > overpass_start_time:
            overpass_event = OverpassEvent(
                satellite_name=self.satellite_name,
                groundstation_info=self.groundstation_info,
                start_time=overpass_start_time,
                end_time=event_time,
            )
            self.satellite_event_log.append(overpass_event)

        self.current_overpass_start_time = None
        return Action.CONTINUE

    def finish(
        self,
        final_state: SpacecraftState,
        detector: EventDetector,
    ) -> None:
        """Close a visibility interval that is still active at propagation end."""
        if self.current_overpass_start_time is None:
            return

        overpass_start_time = self.current_overpass_start_time
        overpass_end_time = self.propagation_end_time

        if overpass_end_time > overpass_start_time:
            overpass_event = OverpassEvent(
                satellite_name=self.satellite_name,
                groundstation_info=self.groundstation_info,
                start_time=overpass_start_time,
                end_time=overpass_end_time,
            )
            self.satellite_event_log.append(overpass_event)

        self.current_overpass_start_time = None

    def resetState(
        self,
        detector: EventDetector,
        old_state: SpacecraftState,
    ) -> SpacecraftState:
        """Keep the spacecraft state unchanged after visibility events."""
        return old_state


# ==========================================
# VISIBILITY DETECTOR SETUP
def attach_visibility_detectors(
    propagator: NumericalPropagator,
    satellite_info: SatelliteInformation,
    groundstation_contexts: list[GroundStationRuntimeContext],
    satellite_event_log: list[OverpassEvent],
    propagation_start_time: datetime,
    propagation_end_time: datetime,
) -> None:
    """Attach one elevation detector per ground station to a satellite propagator.

    setup_orekit_environment must run before this function imports Orekit classes.
    """
    visibility_start_time = normalize_datetime_to_utc(propagation_start_time)
    visibility_end_time = normalize_datetime_to_utc(propagation_end_time)

    if visibility_end_time <= visibility_start_time:
        raise ValueError("The visibility end time must be after the start time.")

    from org.orekit.propagation.events import ElevationDetector
    from org.orekit.propagation.events.handlers import EventHandler

    for groundstation_context in groundstation_contexts:
        groundstation_info = groundstation_context.groundstation_info
        minimum_elevation_rad = radians(
            groundstation_info.min_elevation_angle_deg,
        )

        visibility_event_handler = VisibilityEventHandler(
            satellite_name=satellite_info.name,
            groundstation_info=groundstation_info,
            satellite_event_log=satellite_event_log,
            propagation_start_time=visibility_start_time,
            propagation_end_time=visibility_end_time,
        )
        visibility_event_handler_proxy = jpype.JProxy( # type: ignore
            EventHandler,
            inst=visibility_event_handler,
        )

        visibility_detector = ElevationDetector(
            groundstation_context.topocentric_frame,
        )
        visibility_detector = visibility_detector.withConstantElevation(
            minimum_elevation_rad,
        )
        visibility_detector = visibility_detector.withHandler(
            visibility_event_handler_proxy,
        )

        propagator.addEventDetector(visibility_detector)
