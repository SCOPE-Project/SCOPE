import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure backend root is in sys.path
backend_path = Path(__file__).resolve().parent.parent
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from app.main import app
from app.services.satos_connector import (
    DEFAULT_UPDATE_STATE_CONFIG_PATH,
    load_update_state_config,
    update_and_post_satellite_states,
)
from core.models.domain import SatelliteStateInputDefinition, UpdateSatelliteStateConfig


def test_loads_bundled_default_config() -> None:
    config = load_update_state_config(DEFAULT_UPDATE_STATE_CONFIG_PATH)

    assert config.epoch_utc == datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    assert len(config.satellites) == 3
    assert [satellite.name for satellite in config.satellites] == [
        "Sat1_Group1",
        "Sat2_Group1",
        "Sat3_Group1",
    ]


def test_simulate_and_post_dry_run() -> None:
    config = load_update_state_config()
    states = update_and_post_satellite_states(config=config, dry_run=True)

    assert len(states) == 3
    for state in states:
        assert len(state.position_m) == 3
        assert len(state.velocity_m_s) == 3
        assert state.epoch_utc == config.epoch_utc


@patch("app.services.satos_connector.satos_update_satellite_state")
def test_simulate_and_post_with_mocked_satos(mock_update) -> None:
    mock_update.return_value = MagicMock()
    config = load_update_state_config()

    states = update_and_post_satellite_states(config=config, dry_run=False)

    assert len(states) == 3
    assert mock_update.call_count == 3


@patch("app.services.satos_connector.update_and_post_satellite_states")
def test_fastapi_endpoint_default_config(mock_update) -> None:
    from core.models.domain import SatelliteState
    mock_update.return_value = [

        SatelliteState(
            name="Sat1_Group1",
            epoch_utc=datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc),
            raan_deg=45.0,
            rv=[7000000.0, 0.0, 0.0, 0.0, 7500.0, 0.0],
        )
    ]

    client = TestClient(app)
    response = client.post("/satos/satellites/update-satellite-state", json={})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert len(data["updated_satellites"]) == 1
    assert data["updated_satellites"][0]["name"] == "Sat1_Group1"
    assert data["updated_satellites"][0]["position_m"] == [7000000.0, 0.0, 0.0]


@patch("app.services.satos_connector.update_and_post_satellite_states")
def test_fastapi_endpoint_custom_config(mock_update) -> None:
    from core.models.domain import SatelliteState
    mock_update.return_value = [
        SatelliteState(
            name="CustomSat",
            epoch_utc=datetime(2026, 8, 1, 0, 0, 0, tzinfo=timezone.utc),
            raan_deg=50.0,
            rv=[6800000.0, 0.0, 0.0, 0.0, 7600.0, 0.0],
        )
    ]

    client = TestClient(app)
    payload = {
        "epoch_utc": "2026-08-01T00:00:00Z",
        "satellites": [
            {
                "name": "CustomSat",
                "altitude_m": 400000.0,
                "eccentricity": 0.001,
                "inclination_deg": 97.0,
                "ascending_node_longitude_deg": 10.0,
                "argument_of_periapsis_deg": 0.0,
                "mean_anomaly_deg": 0.0,
            }
        ],
    }
    response = client.post("/satos/satellites/update-satellite-state", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["updated_satellites"][0]["name"] == "CustomSat"
