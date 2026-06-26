# API Connect imports: All API endpoints for interacting with SAT.IO exposed in the Python SDK, corresponding to the Swagger documentation

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

# no Swagger definition
from api_connect.command_history import get_command_states

###

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from dotenv import load_dotenv
from pathlib import Path


credentials_path = Path(__file__).resolve().parents[2] / "SatOS_credentials" / "credentials.env"

# Make sure the .env file exists and is filled correctly
if not load_dotenv(credentials_path):
    raise Exception("No .env file found or empty")

# Create a session with SAT.IO using a settings file

# Create a session with SAT.IO using environment variables
session = SatIOSession()

with SatIOSession() as session:
    print("Running testsat_0_example with SAT.IO session...")
    sat_list = get_satellite_list(session)
    schedules_list = get_schedules_list(session)
    activities_list = get_activity_list(session, schedules_list[0].name)  # Get activities for the first schedule
    activities = get_activities(session, activities_list[0].uuid)  # Get activities for the first schedule
    print(f"Satellites in the system: {[sat.name for sat in sat_list]}")
    print(f"Schedules in the system: {[schedule.name for schedule in schedules_list]}")
    print(f"Activities in the system: {[activity.name for activity in activities_list]}")
    print("Finished running testsat_0_example.")
    
