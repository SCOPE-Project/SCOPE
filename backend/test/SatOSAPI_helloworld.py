# API Connect imports: All API endpoints for interacting with SAT.IO exposed in the Python SDK, corresponding to the Swagger documentation

from pydantic import UUID4
from api_connect.satio_session import SatIOSession  # Managing the connection to sat:io

# Working with API endpoints defined in api_connect/... should be sufficient. No necessity for direct asset import of testsat_0_mission.testsat_0 or so.

# /satellite/...
from api_connect.satellites import get_satellite_list, get_satellite, post_satellite, delete_satellite

# /activities/...
from api_connect.activities import post_activities, put_activities, get_activities, get_activity_list, delete_activity

# /schedules/...
from api_connect.schedules import get_schedules_list, _delete_schedule

# /commands/...
from api_connect.commands import post_commands, put_commands, get_commands, delete_commands

# /blueprints/...
from api_connect.blueprints import post_blueprint, get_blueprint_list, get_blueprint, delete_blueprint

# /telemetry/...
from api_connect.telemetry import get_telemetry_data, post_telemetry_data

# /schedule_events/...
from api_connect.schedule_events import get_schedule_events

# no Swagger definition
from api_connect.command_history import get_command_states

###
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import sys
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime

# Add the backend directory to sys.path to resolve core module imports
sys.path.append(str(Path(__file__).resolve().parent.parent))

credentials_path = Path(__file__).resolve().parent.parent / "SatOS_credentials" / "credentials.env"

# Make sure the .env file exists and is filled correctly
if not load_dotenv(credentials_path):
    raise Exception("No .env file found or empty")

# Create a session with SAT.IO using a settings file

# Create a session with SAT.IO using environment variables
session = SatIOSession()
from core.models.domain import SatelliteInformation, GroundStationInformation
import warnings
with SatIOSession() as session:
    groundstation_model = get_satellite(session, satellite_name="GS1_Group1")
    name = groundstation_model.name

    # 1. Initialize sentinels instead of defaults
    latitude = None
    longitude = None
    min_elevation_angle_deg = None
    print(groundstation_model)
    # 2. Extract values and fail hard on malformed definitions
    for var in groundstation_model.variableDefinitions:
        if var.name == "latitude":
            if not var.floatDefinition or var.floatDefinition.defaultValue is None:
                raise ValueError("Malformed groundstation model: 'latitude' missing definition or value.")
            latitude = float(var.floatDefinition.defaultValue)
            if latitude == 0.0:
                warnings.warn("Latitude is 0.0, is this correct or an API default?", UserWarning)
                
        elif var.name == "longitude":
            if not var.floatDefinition or var.floatDefinition.defaultValue is None:
                raise ValueError("Malformed groundstation model: 'longitude' missing definition or value.")
            longitude = float(var.floatDefinition.defaultValue)
            if longitude == 0.0:
                warnings.warn("Longitude is 0.0, is this correct or an API default?", UserWarning)
                
        elif var.name == "min_elevation_angle_deg":
            if not var.floatDefinition or var.floatDefinition.defaultValue is None:
                raise ValueError("Malformed groundstation model: 'min_elevation_angle_deg' missing definition or value.")
            min_elevation_angle_deg = float(var.floatDefinition.defaultValue)
            if min_elevation_angle_deg == 0.0:
                warnings.warn("min_elevation_angle_deg is 0.0, is this correct or an API default?", UserWarning)

    # 3. Fail hard if variables were entirely missing from the loop
    if latitude is None:
        raise ValueError("Missing required variable: 'latitude'")
    if longitude is None:
        raise ValueError("Missing required variable: 'longitude'")
    if min_elevation_angle_deg is None:
        raise ValueError("Missing required variable: 'min_elevation_angle_deg'")
    
    
    groundstation_information = GroundStationInformation(
        name=name,
        latitude=latitude,
        longitude=longitude,
        min_elevation_angle_deg=min_elevation_angle_deg,
    )
    print(groundstation_information)
