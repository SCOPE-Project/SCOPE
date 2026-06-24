# FastAPI main application file. This is the entry point for the backend server, where the FastAPI app is created and all routes are defined.

import uvicorn
from fastapi import FastAPI

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from dotenv import load_dotenv
from pathlib import Path


credentials_path = Path(__file__).resolve().parent.parent / "SatOS_credentials" / "credentials.env"

# Make sure the .env file exists and is filled correctly
if not load_dotenv(credentials_path):
    raise Exception("No .env file found or empty")


# FastAPI app instance creation
app = FastAPI()

# Enable CORS for frontend connectivity
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/status")
def read_status():
    return {"status": "ok"}


# API Connect imports: All API endpoints for interacting with SAT.IO exposed in the Python SDK, corresponding to the Swagger documentation
from api_connect.satio_session import SatIOSession  # Managing the connection to sat:io

# Working with API endpoints defined in api_connect/... should be sufficient. No necessity for direct asset import of testsat_0_mission.testsat_0 or so.
# /satellite/...
from api_connect.satellites import get_satellite_list

@app.get("/satellite/list")
def satos_get_satellite_list():
    with SatIOSession() as session:
        satellite_list = get_satellite_list(session)
        return {"satellites": [sat.name for sat in satellite_list]}

@app.get("/schedule")
def satos_get_schedule():
    with SatIOSession() as session:
        satellite_list = get_satellite_list(session)
        return {"satellites": [sat.name for sat in satellite_list]}



if __name__ == "__main__":
    # Note: When using reload=True programmatically, the application 
    # must be referenced via an import string matching the filename.
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
    