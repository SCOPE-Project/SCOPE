from api_connect.satellites import get_satellite, post_satellite
from api_connect.satio_session import SatIOSession

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import sys
from dotenv import load_dotenv
from pathlib import Path

# Add the backend directory to sys.path to resolve core module imports
sys.path.append(str(Path(__file__).resolve().parent.parent))

credentials_path = Path(__file__).resolve().parent.parent / "SatOS_credentials" / "credentials.env"

# Make sure the .env file exists and is filled correctly
if not load_dotenv(credentials_path):
    raise Exception("No .env file found or empty")


with SatIOSession() as session:
    # 1. Fetch current satellite definition
    satellite = get_satellite(session, satellite_name="Sat3_Group1")
    print(satellite.version.model_dump())
    # 2. Locate the target variable and update its default value
    for var in satellite.variableDefinitions:
        print(var.name)
        if var.name == "position_vector" and var.matrixDefinition:
            print("Found position_vector")
            print(var.matrixDefinition.defaultValue)
            
            # Set new value
            var.matrixDefinition.defaultValue = [1, 0, 0]
            # 3. (Optional) Bump patch version
            satellite.version.patch += 1
    # 4. Post updated model back to SatOS
    response = post_satellite(session, satellite)
    response.raise_for_status()
    
    print("\n\n\n")
    print("Check Update success")
    print("\n\n\n")
    import time
    time.sleep(5)
    satellite = get_satellite(session, satellite_name="Sat3_Group1")
    print(satellite.version.model_dump())

    # 2. Locate the target variable and update its default value
    for var in satellite.variableDefinitions:
        if var.name == "position_vector" and var.matrixDefinition:
            print("Found position_vector")
            print(var.matrixDefinition.defaultValue)
