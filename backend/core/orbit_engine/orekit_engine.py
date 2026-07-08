# core/orbit_engine/orekit_engine.py

from typing import Callable
from datetime import datetime

from app.models.domain import SatelliteInformation, GroundStationInformation, TimeInterval


def run_orekit_engine(
        task_id: str, 
        satellite_infos: list[SatelliteInformation], 
        ground_station_infos: list[GroundStationInformation], 
        time_interval: TimeInterval, 
        on_progress_update : Callable | None = None
    ) -> dict[str, list]:
    """
    Runs the OREKIT engine for a given task.

    :param task_id: The ID of the task.
    :param satellite_infos: A list of satellite identifiers.
    :param ground_station_infos: A list of ground station identifiers.
    :param time_interval: The time interval.
    :param on_progress_update: A callback function to update the progress.

    :return: A dictionary containing the global tracks and schedule blocks.
    """
    # These will aggregate the data for all satellites and stations
    master_global_tracks = {}
    master_schedule_blocks = []
    
    total_sats = len(satellite_infos)
    total_duration = (time_interval.end_time - time_interval.start_time).total_seconds()
    
    # ==========================================
    # THE OUTER LOOP: ONE SATELLITE AT A TIME (N)
    # ==========================================
    for sat_id in enumerate(satellite_infos):
        
        
        # 1. Initialize Engine for this specific satellite
        initial_state = create_state_from_tle(sat_data["tle"])
        propagator = NumericalPropagator()
        propagator.setInitialState(initial_state)
        
        # 2. Attach Tape Recorder
        ephemeris_generator = propagator.getEphemerisGenerator()
        
        # 3. Attach FastAPI Progress Tracker (Math handles the outer loop % offset)
        propagator.setStepHandler(60.0, on_progress_update)
        
        # 4. Create a temporary log for this satellite's events
        satellite_event_log = [] 
        
        # ==========================================
        # THE INNER LOOP: MULTIPLE TRIPWIRES (M)
        # ==========================================
        for station in ground_stations:
            # We must create a distinct geodetic frame for each ground station
            topo_frame = create_topocentric_frame(station["lat"], station["lon"])
            
            # Create the detector
            detector = ElevationDetector(topo_frame).withConstantElevation(0.0)
            
            # Attach a customized logger that remembers WHO tripped the wire
            handler = MultiStationHandler(
                sat_id=sat_id, 
                station_id=station["id"], 
                log_list=satellite_event_log
            )
            detector.withHandler(handler)
            
            # Attach this specific station's tripwire to the propagator
            propagator.addEventDetector(detector)
        
        # ==========================================
        # EXECUTE FAST SWEEP & EXTRACT
        # ==========================================
        # The engine runs 24h. It might trip Station A, then Station B, etc.
        propagator.propagate(start_time, end_time) 
        
        # Get the Tape
        ephemeris = ephemeris_generator.getGeneratedEphemeris()
        
        # Extract Low-Res Global Track (Saved to the master dictionary)
        master_global_tracks[sat_id] = extract_low_res_track(ephemeris, start_time, end_time)
        
        # Extract High-Res Overpass profiles for all events logged by this satellite
        # event dict looks like: {"sat_id": "V1", "station_id": "GS-A", "aos": T1, "los": T2}
        for event in satellite_event_log:
            high_res_track = extract_high_res_profile(
                ephemeris=ephemeris,
                station_lat_lon=get_station_coords(event["station_id"]),
                start=event["aos"], 
                end=event["los"]
            )
            
            master_schedule_blocks.append({
                "satellite_id": event["sat_id"],
                "station_id": event["station_id"],
                "start_time": event["aos"],
                "end_time": event["los"],
                "high_res_trajectory": high_res_track
            })

    # ==========================================
    # COMPLETE
    # ==========================================
    if on_progress_update != None:
        on_progress_update(task_id, "Complete", 100)
    
    return {
        "global_tracks": master_global_tracks,
        "schedule_blocks": master_schedule_blocks
    }