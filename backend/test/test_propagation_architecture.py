import pytest
from datetime import datetime, timezone
from core.models.propagation import (
    PropagationMetadata,
    GlobalTrackPoint,
    OverpassProfilePoint,
    OverpassBlock,
    PropagationResult,
    SatelliteTrajectory,
)
from app.repositories import PropagationResultRepository
from app.models.propagation import PropagationResultDTO

def test_propagation_repository_and_dto_mapping():
    # 1. Clear repository before testing
    PropagationResultRepository.clear()
    
    # 2. Setup mock domain data
    run_id = "test-run-123"
    start_time = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
    end_time = datetime(2026, 7, 15, 14, 0, 0, tzinfo=timezone.utc)
    
    metadata = PropagationMetadata(
        run_id=run_id,
        start_time=start_time,
        end_time=end_time,
        global_track_step_seconds=60.0,
        overpass_profile_step_seconds=10.0,
    )
    
    track_point = GlobalTrackPoint(
        timestamp=start_time,
        position_gcrf_m=[7000000.0, 0.0, 0.0],
        velocity_gcrf_mps=[0.0, 7500.0, 0.0],
        latitude_deg=0.0,
        longitude_deg=0.0,
        altitude_m=500000.0,
    )
    
    overpass_point = OverpassProfilePoint(
        timestamp=start_time,
        latitude_deg=0.0,
        longitude_deg=0.0,
        altitude_m=500000.0,
        elevation_deg=15.0,
        azimuth_deg=90.0,
        range_m=600000.0,
    )
    
    overpass_block = OverpassBlock(
        overpass_id="OP_0001",
        overpass_name="pass__sat1__gs1__001",
        satellite_name="sat1",
        groundstation_name="gs1",
        start_time=start_time,
        end_time=end_time,
        duration_seconds=7200.0,
        max_elevation_deg=45.0,
        high_res_trajectory=[overpass_point],
    )
    
    domain_result = PropagationResult(
        metadata=metadata,
        global_tracks=[SatelliteTrajectory(satellite_name="sat1", track=[track_point])],
        overpass_blocks=[overpass_block],
    )
    
    # 3. Test saving to repository
    PropagationResultRepository.save_result(domain_result)
    
    # 4. Test retrieving from repository
    retrieved = PropagationResultRepository.get_result(run_id)
    assert retrieved is not None
    assert retrieved.metadata.run_id == run_id
    assert retrieved.metadata.global_track_step_seconds == 60.0
    assert len(retrieved.global_tracks) == 1
    assert retrieved.global_tracks[0].satellite_name == "sat1"
    assert len(retrieved.global_tracks[0].track) == 1
    assert retrieved.global_tracks[0].track[0].position_gcrf_m == [7000000.0, 0.0, 0.0]
    
    # 5. Test mapping to Pydantic DTO
    dto = PropagationResultDTO.from_domain(retrieved)
    
    assert dto.metadata.task_id == run_id  # verify it was mapped to task_id
    assert dto.metadata.start_time == "2026-07-15T12:00:00Z"
    assert dto.metadata.end_time == "2026-07-15T14:00:00Z"
    
    assert "sat1" in dto.global_tracks
    assert len(dto.global_tracks["sat1"]) == 1
    assert dto.global_tracks["sat1"][0].timestamp == "2026-07-15T12:00:00Z"
    assert dto.global_tracks["sat1"][0].position_gcrf_m == [7000000.0, 0.0, 0.0]
    
    assert len(dto.overpass_blocks) == 1
    assert dto.overpass_blocks[0].overpass_id == "OP_0001"
    assert dto.overpass_blocks[0].overpass_name == "pass__sat1__gs1__001"
    assert dto.overpass_blocks[0].start_time == "2026-07-15T12:00:00Z"
    assert dto.overpass_blocks[0].high_res_trajectory[0].elevation_deg == 15.0
    
    # 6. Test JSON serialization works without error
    json_data = dto.model_dump()
    assert json_data["metadata"]["task_id"] == run_id
    assert json_data["global_tracks"]["sat1"][0]["altitude_m"] == 500000.0
    
    # Clean up
    PropagationResultRepository.delete_result(run_id)
    assert PropagationResultRepository.get_result(run_id) is None
