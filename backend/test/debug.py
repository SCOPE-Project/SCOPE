import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import sys
from pathlib import Path
from dotenv import load_dotenv

import json

# Add backend directory and backend/app directory to sys.path
backend_path = Path(r"c:\Users\Chris\Documents\Studium\Module_Master\SoftwaresystemeRaumfahrtanwendungen\SCOPE\backend")
sys.path.append(str(backend_path))
sys.path.append(str(backend_path / "app"))
credentials_path = backend_path / "SatOS_credentials" / "credentials.env"
if not load_dotenv(credentials_path):
    raise Exception("No credentials file found")

from app.services.asset_repository import AssetRepository

result = AssetRepository.initialize_repository()

print("Satellite Cache:")
for satellite in AssetRepository._satellite_cache.values():
    print(satellite)
print("\nGroundstation Cache:")
for groundstation in AssetRepository._groundstation_cache.values():
    print(groundstation)
print("\nIneligible Cache:")
for ineligible in AssetRepository._ineligible_cache.items():
    print(ineligible)

print("="*50)
for asset in result:
    print(asset)
print("="*50)