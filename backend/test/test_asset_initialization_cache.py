import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.repositories import AssetRepository
from app.models.satos import AssetInformation


def test_asset_repository_caching_return_value():
    """Verify that initialize_repository returns True when served from cache, and False when freshly initialized."""
    # Reset internal state
    AssetRepository._initialized = False
    AssetRepository._initialized_assets = []

    # Mock SatIOSession and SatOS connectors so this test runs reliably offline
    with patch("app.repositories.asset_repository.SatIOSession"), \
         patch("app.repositories.asset_repository.satos_get_asset_list") as mock_list, \
         patch("app.repositories.asset_repository.satos_get_asset") as mock_get, \
         patch("app.repositories.asset_repository.satos_get_activities_list") as mock_acts:
        
        mock_list.return_value = []
        mock_acts.return_value = []

        # 1. Fresh initialization (force_refresh=False, _initialized=False) -> should return False (fresh)
        was_cached_1 = AssetRepository.initialize_repository(force_refresh=False)
        assert was_cached_1 is False
        assert AssetRepository._initialized is True

        # 2. Subsequent call (force_refresh=False, _initialized=True) -> should return True (cached)
        was_cached_2 = AssetRepository.initialize_repository(force_refresh=False)
        assert was_cached_2 is True

        # 3. Forced re-initialization (force_refresh=True) -> should return False (fresh)
        was_cached_3 = AssetRepository.initialize_repository(force_refresh=True)
        assert was_cached_3 is False
        assert AssetRepository._initialized is True


def test_initialize_endpoint_returns_cached_and_source():
    """Verify that GET /tasks/initialize endpoint returns cached and source fields accurately."""
    client = TestClient(app)

    with patch("app.repositories.asset_repository.SatIOSession"), \
         patch("app.repositories.asset_repository.satos_get_asset_list") as mock_list, \
         patch("app.repositories.asset_repository.satos_get_activities_list") as mock_acts:
        
        mock_list.return_value = []
        mock_acts.return_value = []

        # Force refresh first
        res_fresh = client.get("/tasks/initialize?force_refresh=true")
        assert res_fresh.status_code == 200
        data_fresh = res_fresh.json()
        assert data_fresh["cached"] is False
        assert data_fresh["source"] == "initialization"
        assert "assets" in data_fresh
        assert "schedules" in data_fresh

        # Second call without force_refresh -> should return cached: True
        res_cached = client.get("/tasks/initialize")
        assert res_cached.status_code == 200
        data_cached = res_cached.json()
        assert data_cached["cached"] is True
        assert data_cached["source"] == "cache"

        # Third call with force_refresh=true -> should return cached: False
        res_forced = client.get("/tasks/initialize?force_refresh=true")
        assert res_forced.status_code == 200
        data_forced = res_forced.json()
        assert data_forced["cached"] is False
        assert data_forced["source"] == "initialization"
