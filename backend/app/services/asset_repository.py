# /services/asset_repository.py
from core.models.domain import SatelliteInformation, GroundStationInformation
from services.satos_connector import satos_get_asset

class AssetRepository:
    _satellite_cache: dict[str, SatelliteInformation] = {}
    _groundstation_cache: dict[str, GroundStationInformation] = {}

    @classmethod
    def get_satellite_information(cls, asset_name: str) -> SatelliteInformation:
        """
        Retrieves the domain information model, fetching from SatOS if not cached.
        """
        if asset_name in cls._satellite_cache:
            return cls._satellite_cache[asset_name]
        
        # 1. Fetch the heavy web model from SatOS
        raw_satos_model = satos_get_asset(asset_name=asset_name)
        
        # 2. Extract ONLY the astrodynamics data to create the internal domain model
        sat_physics = SatelliteInformation(
            name=raw_satos_model.name,
            id=raw_satos_model.id,
            position_r=raw_satos_model.position_r,
            velocity_v=raw_satos_model.velocity_v,
            state_timestamp=raw_satos_model.state_timestamp
        )
        
        # 3. Cache and return
        cls._satellite_cache[asset_id] = sat_physics
        return sat_physics
    
    @classmethod
    def get_groundstation_information(cls, asset_id: str) -> GroundStationInformation:
        """
        Retrieves the domain information model, fetching from SatOS if not cached.
        """
        if asset_id in cls._groundstation_cache:
            return cls._groundstation_cache[asset_id]
        
        # 1. Fetch the heavy web model from SatOS
        raw_satos_model = satos_get_asset(asset_id)
        
        # 2. Extract ONLY the astrodynamics data to create the internal domain model
        sat_physics = GroundStationInformation(
            id=raw_satos_model.name,
            
            # --- THE MAPPING GAP ---
            # Orekit requires state vectors (position/velocity), TLEs, or OPMs.
            # Where are these extracted from the SatelliteModel?
            tle_line_1=..., 
            tle_line_2=...,
            mass_kg=...
        )
        
        # 3. Cache and return
        cls._groundstation_cache[asset_id] = sat_physics
        return sat_physics