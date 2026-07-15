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

from dotenv import load_dotenv
from pathlib import Path

credentials_path = Path(__file__).resolve().parent.parent / "SatOS_credentials" / "credentials.env"

# Make sure the .env file exists and is filled correctly
if not load_dotenv(credentials_path):
    raise Exception("No .env file found or empty")

# Create a session with SAT.IO using a settings file

# Create a session with SAT.IO using environment variables
session = SatIOSession()

with SatIOSession() as session:
    satellite_model = get_satellite(session, satellite_name="Sat1_Group1")
    # 1. Set fallback/default values
    position_r = [0.0, 0.0, 0.0]
    velocity_v = [0.0, 0.0, 0.0]
    
    # 2. Extract position and velocity from variable definitions
    for var in satellite_model.variableDefinitions:
        if var.name == "position_vector" and var.matrixDefinition:
            if var.matrixDefinition.defaultValue is not None:
                position_r = [float(val) for val in var.matrixDefinition.defaultValue]
        elif var.name == "velocity_vector" and var.matrixDefinition:
            if var.matrixDefinition.defaultValue is not None:
                velocity_v = [float(val) for val in var.matrixDefinition.defaultValue]
    print(satellite_model.model_dump_json(indent=2))
    print(position_r)
    print(velocity_v)
