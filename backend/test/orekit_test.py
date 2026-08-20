# include backend path
import os
import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from datetime import datetime, timezone
from core.orbit_engine.orekit_engine import run_orekit_engine
from core.models.assets import TimeInterval, SatelliteInformation, GroundStationInformation
from app.repositories import AssetRepository

time_interval = TimeInterval(
    start_time=datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc),
    end_time=datetime(2026, 10, 28, 13, 0, 0, tzinfo=timezone.utc),
)

test_sat = SatelliteInformation(
    name="sat1",
    position_r=[7000000.0, 0.0, 0.0],
    velocity_v=[0.0, 7500.0, 0.0],
    state_timestamp=datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc),
)

test_gs = GroundStationInformation(
    name="gs1",
    latitude=0.0,
    longitude=0.0,
    min_link_elevation=10.0,
)

result = run_orekit_engine(
    run_id="test_run",
    time_interval=time_interval,
    satellite_infos=[test_sat],
    groundstation_infos=[test_gs],
)

print(result.metadata)