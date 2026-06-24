"""SatOS OMM variable and telemetry helpers for the standalone prototype."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from models_test import (
    ORBIT_OMM_VARIABLE_DESCRIPTION,
    ORBIT_OMM_VARIABLE_NAME,
    OrbitOmmTelemetryInput,
    REPO_ROOT,
    SAMPLE_OMM_XML,
    SatOSVersion,
    ensure_satos_sdk_on_path,
    orbit_omm_variable_id,
)


DEFAULT_CREDENTIALS_PATH = REPO_ROOT / "SatOS_credentials" / "credentials.env"


def build_orbit_omm_variable_definition(default_value: str | None = None):
    """Build the SatOS root-level String variable definition for SAT.edit/API use."""
    ensure_satos_sdk_on_path()
    from pydantic_models.definitions.parameter_definition import ParameterDefModel, StringParameterDefinitionModel

    return ParameterDefModel(
        stringDefinition=StringParameterDefinitionModel(defaultValue=default_value),
        name=ORBIT_OMM_VARIABLE_NAME,
        description=ORBIT_OMM_VARIABLE_DESCRIPTION,
        unit="",
    )


def satellite_model_has_orbit_omm_variable(satellite_model) -> bool:
    """Return True when a SatelliteModel already has the root OMM String variable."""
    for variable in getattr(satellite_model, "variableDefinitions", []):
        if variable.name == ORBIT_OMM_VARIABLE_NAME and variable.stringDefinition is not None:
            return True
    return False


def build_orbit_omm_telemetry(
    satellite_name: str,
    omm_xml: str = SAMPLE_OMM_XML,
    version: SatOSVersion | None = None,
    timestamp: datetime | None = None,
    validity: bool = True,
):
    """Build one SatOS TelemetryVariableModel containing OMM XML as stringValue."""
    ensure_satos_sdk_on_path()
    from pydantic_models.telemetry_variables import TelemetryVariableModel
    from pydantic_models.value_field import ValueFieldModel

    telemetry_input = OrbitOmmTelemetryInput(
        satellite_name=satellite_name,
        omm_xml=omm_xml,
        version=version or SatOSVersion(major=1, minor=0, patch=0),
        timestamp=timestamp or datetime.now(timezone.utc),
        validity=validity,
    )

    return TelemetryVariableModel(
        id=telemetry_input.telemetry_id,
        timestamp=telemetry_input.timestamp,
        value=ValueFieldModel(stringValue=telemetry_input.omm_xml),
        validity=telemetry_input.validity,
        version=telemetry_input.version.to_sdk_version_model(),
    )


def load_credentials_env(credentials_path: Path = DEFAULT_CREDENTIALS_PATH) -> None:
    """Load SatOS credentials for optional live helpers without touching main.py."""
    if not credentials_path.exists():
        raise FileNotFoundError(f"SatOS credentials file not found: {credentials_path}")

    from dotenv import load_dotenv

    if not load_dotenv(credentials_path):
        raise RuntimeError(f"SatOS credentials file is empty or could not be loaded: {credentials_path}")

    missing_keys = [
        key
        for key in ("API_CONNECT_API_URL", "API_CONNECT_KEYCLOAK_REALM", "API_CONNECT_USERNAME", "API_CONNECT_PASSWORD")
        if not os.getenv(key)
    ]
    if missing_keys:
        raise RuntimeError(f"SatOS credentials are missing required keys: {', '.join(missing_keys)}")


def post_orbit_omm_telemetry(
    satellite_name: str,
    omm_xml: str = SAMPLE_OMM_XML,
    version: SatOSVersion | None = None,
    timestamp: datetime | None = None,
    credentials_path: Path = DEFAULT_CREDENTIALS_PATH,
):
    """Post one OMM XML telemetry value to the SatOS telemetry endpoint."""
    load_credentials_env(credentials_path)
    ensure_satos_sdk_on_path()
    from api_connect.satio_session import SatIOSession
    from api_connect.telemetry import post_telemetry_data

    telemetry = build_orbit_omm_telemetry(
        satellite_name=satellite_name,
        omm_xml=omm_xml,
        version=version,
        timestamp=timestamp,
        validity=True,
    )

    with SatIOSession() as session:
        response = post_telemetry_data(session=session, telemetry_data=[telemetry])
        response.raise_for_status()
        return response


def fetch_latest_orbit_omm_xml(
    satellite_name: str,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    credentials_path: Path = DEFAULT_CREDENTIALS_PATH,
) -> str:
    """Fetch the newest OMM XML string telemetry value for a satellite."""
    load_credentials_env(credentials_path)
    ensure_satos_sdk_on_path()
    from api_connect.satio_session import SatIOSession
    from api_connect.telemetry import get_telemetry_data

    now = datetime.now(timezone.utc)
    start = start_time or now - timedelta(days=7)
    end = end_time or now
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("start_time and end_time must be timezone-aware")

    with SatIOSession() as session:
        telemetry = get_telemetry_data(
            session=session,
            param_address=orbit_omm_variable_id(satellite_name),
            start_time=start,
            end_time=end,
        )

    if not telemetry.values:
        raise LookupError(f"No OMM XML telemetry found for {orbit_omm_variable_id(satellite_name)}")

    latest = sorted(telemetry.values, key=lambda entry: entry[0])[-1]
    value = latest[1]
    if not isinstance(value, str):
        raise TypeError(f"Expected string OMM XML telemetry, got {type(value).__name__}")
    return value
