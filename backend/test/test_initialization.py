import sys
from pathlib import Path
import pytest
from dotenv import load_dotenv

backend_path = Path(__file__).resolve().parent.parent
sys.path.append(str(backend_path))
sys.path.append(str(backend_path / "app"))

credentials_path = backend_path / "SatOS_credentials" / "credentials.env"
if not credentials_path.exists() or not load_dotenv(credentials_path):
    pytest.skip(
        "Skipping integration test: missing backend/SatOS_credentials/credentials.env",
        allow_module_level=True,
    )

from app.services.asset_repository import AssetRepository

def run_tests():
    print("Starting integration tests for AssetRepository...")
    
    # 1. Initialize
    results = AssetRepository.initialize_repository()
    assert len(results) > 0, "No assets initialized!"
    print(f"Successfully initialized {len(results)} assets.")
    
    # 2. Check Sat1_Group1
    sat1 = next((a for a in results if a["name"] == "Sat1_Group1"), None)
    assert sat1 is not None, "Sat1_Group1 not found!"
    assert sat1["eligible"] is True, "Sat1_Group1 should be eligible"
    assert sat1["classification"] == "satellite", "Sat1_Group1 should be classified as satellite"
    assert sat1["details"].name == "Sat1_Group1"
    print("[OK] Sat1_Group1 test passed")
    
    # 3. Check GS1_Group1
    gs1 = next((a for a in results if a["name"] == "GS1_Group1"), None)
    assert gs1 is not None, "GS1_Group1 not found!"
    assert gs1["eligible"] is True, "GS1_Group1 should be eligible"
    assert gs1["classification"] == "groundstation", "GS1_Group1 should be classified as groundstation"
    assert gs1["details"].name == "GS1_Group1"
    print("[OK] GS1_Group1 test passed")
    
    # 4. Check an ineligible asset like testsat_2
    testsat2 = next((a for a in results if a["name"] == "testsat_2"), None)
    assert testsat2 is not None, "testsat_2 not found!"
    assert testsat2["eligible"] is False, "testsat_2 should be ineligible"
    assert testsat2["classification"] == "ineligible", "testsat_2 classification should be ineligible"
    assert "error" in testsat2, "testsat_2 should contain error description"
    print("[OK] testsat_2 test passed")
    
    # 5. Check caching behavior.
    assert "Sat1_Group1" in AssetRepository._satellite_cache
    assert "GS1_Group1" in AssetRepository._groundstation_cache
    assert "testsat_2" in AssetRepository._ineligible_cache
    
    # Try calling get_satellite_information on an ineligible asset, should raise ValueError
    try:
        AssetRepository.get_satellite_information("testsat_2")
        assert False, "Should raise ValueError for ineligible asset"
    except ValueError as e:
        assert "Asset is marked ineligible" in str(e)
        print("[OK] Ineligible cache lookup test passed")

    # 6. Verify candidate categorization retention on validation failures
    sat3 = next((a for a in results if a["name"] == "Sat3_Group1"), None)
    assert sat3 is not None, "Sat3_Group1 not found!"
    assert sat3["eligible"] is False
    assert sat3["classification"] == "satellite"
    assert "Malformed satellite model" in sat3["error"]
    print("[OK] Sat3_Group1 candidate classification test passed")

    gs2 = next((a for a in results if a["name"] == "GS2_Group1"), None)
    assert gs2 is not None, "GS2_Group1 not found!"
    assert gs2["eligible"] is False
    assert gs2["classification"] == "groundstation"
    assert "Malformed ground station model" in gs2["error"]
    print("[OK] GS2_Group1 candidate classification test passed")

    print("\nAll integration tests passed successfully!")

if __name__ == "__main__":
    run_tests()
