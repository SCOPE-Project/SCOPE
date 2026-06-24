from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from app.routers import satos, tasks

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# -----------------------------------
# Load SatOS Credentials as Environment Variables
# -----------------------------------

from dotenv import load_dotenv
from pathlib import Path

credentials_path = Path("SatOS_credentials/credentials.env")

# Make sure the .env file exists and is filled correctly
if not load_dotenv(credentials_path):
    raise Exception("No .env file found or empty")


# -----------------------------------
# FastAPI App Initialization
# -----------------------------------

app = FastAPI(title="VLEO SCOPE API")

# -----------------------------------
# Enable CORS
# -----------------------------------

# Crucial CORS configuration for your local environment [cite: 2202]
# Restricts access explicitly to your local React dev server origin [cite: 2203]
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],  # Permits GET, POST, OPTIONS [cite: 2203]
    allow_headers=["*"],
)


# -----------------------------------
# Register API Sub-Routers
# -----------------------------------

app.include_router(satos.router)
app.include_router(tasks.router)


@app.get("/", include_in_schema=False)
def redirect_to_docs():
    return RedirectResponse(url="/docs")