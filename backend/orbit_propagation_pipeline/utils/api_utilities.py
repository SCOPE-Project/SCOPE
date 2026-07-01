from pathlib import Path
from dotenv import load_dotenv

"""
Utility functions for handling API-related tasks, such as loading credentials.

"""


def load_credentials() -> None:
    credentials_path = Path(__file__).resolve().parents[3] / "SatOS_credentials" / "credentials.env"
    if not load_dotenv(credentials_path):
        raise Exception(f"No .env file found or empty at {credentials_path}")
    