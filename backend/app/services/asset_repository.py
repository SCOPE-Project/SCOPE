# /services/asset_repository.py
from core.models.domain import SatelliteInformation, GroundStationInformation
from pydantic_models.definitions import SatelliteModel
from services.satos_connector import satos_get_asset, satos_get_asset_list
from datetime import datetime
import warnings

class AssetRepository:
    _satellite_cache: dict[str, SatelliteInformation] = {}
    _groundstation_cache: dict[str, GroundStationInformation] = {}
    _ineligible_cache: dict[str, str] = {}

    @classmethod
    def initialize_repository(cls) -> list[dict]:
        """
        Retrieves the list of assets from SatOS, queries the full configuration
        for each asset, parses eligible assets as satellites or ground stations,
        and caches the results (including ineligible ones).
        """
        # Clear existing caches
        cls._satellite_cache.clear()
        cls._groundstation_cache.clear()
        cls._ineligible_cache.clear()

        try:
            asset_list = satos_get_asset_list()
        except Exception as e:
            raise RuntimeError(f"Failed to fetch asset list from SatOS: {e}")

        results = []
        for info in asset_list:
            asset_name = info.name
            try:
                # 1. Fetch raw asset and cache it
                raw_model = satos_get_asset(asset_name=asset_name)

                # 2. Identify the intended classification based on defined variables
                var_names = {var.name for var in raw_model.variableDefinitions}
                
                is_satellite_candidate = any(name in var_names for name in ["position_vector", "velocity_vector", "state_timestamp"])
                is_groundstation_candidate = any(name in var_names for name in ["latitude", "longitude", "min_link_elevation"])

                if is_satellite_candidate and is_groundstation_candidate:
                    reason = "Ambiguous asset type: contains both satellite and ground station variables"
                    cls._ineligible_cache[asset_name] = reason
                    results.append({
                        "name": asset_name,
                        "eligible": False,
                        "classification": "ineligible",
                        "error": reason
                    })
                elif is_satellite_candidate:
                    try:
                        cls.get_satellite_information(asset_name)
                        results.append({
                            "name": asset_name,
                            "eligible": True,
                            "classification": "satellite",
                            "details": cls._satellite_cache[asset_name]
                        })
                    except Exception as e:
                        reason = f"Malformed satellite model: {e}"
                        cls._ineligible_cache[asset_name] = reason
                        results.append({
                            "name": asset_name,
                            "eligible": False,
                            "classification": "satellite",
                            "error": reason
                        })
                elif is_groundstation_candidate:
                    try:
                        cls.get_groundstation_information(asset_name)
                        results.append({
                            "name": asset_name,
                            "eligible": True,
                            "classification": "ground_station",
                            "details": cls._groundstation_cache[asset_name]
                        })
                    except Exception as e:
                        reason = f"Malformed ground station model: {e}"
                        cls._ineligible_cache[asset_name] = reason
                        results.append({
                            "name": asset_name,
                            "eligible": False,
                            "classification": "ground_station",
                            "error": reason
                        })
                else:
                    reason = "Unknown asset type: missing both satellite and ground station variables"
                    cls._ineligible_cache[asset_name] = reason
                    results.append({
                        "name": asset_name,
                        "eligible": False,
                        "classification": "ineligible",
                        "error": reason
                    })

            except Exception as e:
                # This catches communication/fetching failures (like 403 Forbidden)
                reason = f"Fetch error: {e}"
                cls._ineligible_cache[asset_name] = reason
                results.append({
                    "name": asset_name,
                    "eligible": False,
                    "classification": "ineligible",
                    "error": reason
                })

        return results

    @classmethod
    def get_satellite_information(cls, satellite_name: str) -> SatelliteInformation:
        """
        Retrieves the Satellite domain information model, fetching from SatOS if not cached.
        """
        if satellite_name in cls._satellite_cache:
            return cls._satellite_cache[satellite_name]
        
        if satellite_name in cls._ineligible_cache:
            raise ValueError(f"Asset is marked ineligible: {cls._ineligible_cache[satellite_name]}")
        
        raw_satellite_model = satos_get_asset(asset_name=satellite_name)
        
        satellite_name = raw_satellite_model.name

        # 2. Initialize sentinels instead of defaults
        position_r = None
        velocity_v = None
        state_timestamp = None

        # 3. Extract values and fail hard on malformed definitions
        for var in raw_satellite_model.variableDefinitions:
            if var.name == "position_vector":
                if not var.matrixDefinition or var.matrixDefinition.defaultValue is None:
                    raise ValueError(f"{satellite_name}: Malformed satellite model: 'position_vector' missing definition or value.")
                position_r = [float(val) for val in var.matrixDefinition.defaultValue]
                if position_r[0] == 0.0 or position_r[1] == 0.0 or position_r[2] == 0.0:
                    warnings.warn(f"{satellite_name}: Position vector has 0.0 as one of its components. Is this correct or an API default?", UserWarning)
                
            elif var.name == "velocity_vector":
                if not var.matrixDefinition or var.matrixDefinition.defaultValue is None:
                    raise ValueError(f"{satellite_name}: Malformed satellite model: 'velocity_vector' missing definition or value.")
                velocity_v = [float(val) for val in var.matrixDefinition.defaultValue]
                if velocity_v[0] == 0.0 or velocity_v[1] == 0.0 or velocity_v[2] == 0.0:
                    warnings.warn(f"{satellite_name}: Velocity vector has 0.0 as one of its components. Is this correct or an API default?", UserWarning)
                
            elif var.name == "state_timestamp":
                if not var.timeDefinition or var.timeDefinition.defaultValue is None:
                    raise ValueError(f"{satellite_name}: Malformed satellite model: 'state_timestamp' missing definition or value.")
                state_timestamp = var.timeDefinition.defaultValue

        # 4. Fail hard if variables were entirely missing from the loop
        if position_r is None:
            raise ValueError(f"{satellite_name}: Missing required variable: 'position_vector'")
        if velocity_v is None:
            raise ValueError(f"{satellite_name}: Missing required variable: 'velocity_vector'")
        if state_timestamp is None:
            raise ValueError(f"{satellite_name}: Missing required variable: 'state_timestamp'")
        
        # 5. Create the internal domain model
        satellite_information = SatelliteInformation(
            name=satellite_name,
            position_r=position_r,
            velocity_v=velocity_v,
            state_timestamp=state_timestamp
        )
        
        # 6. Cache and return
        cls._satellite_cache[satellite_name] = satellite_information
        return satellite_information
    
    @classmethod
    def get_groundstation_information(cls, groundstation_name: str) -> GroundStationInformation:
        """
        Retrieves the groundstation domain information model, fetching from SatOS if not cached.
        """
        if groundstation_name in cls._groundstation_cache:
            return cls._groundstation_cache[groundstation_name]
        
        if groundstation_name in cls._ineligible_cache:
            raise ValueError(f"Asset is marked ineligible: {cls._ineligible_cache[groundstation_name]}")
        
        groundstation_model = satos_get_asset(asset_name=groundstation_name)
            
        groundstation_name = groundstation_model.name

        # 2. Initialize sentinels instead of defaults
        latitude = None
        longitude = None
        min_link_elevation = None
        
        # 3. Extract values and fail hard on malformed definitions
        for var in groundstation_model.variableDefinitions:
            if var.name == "latitude":
                if not var.floatDefinition or var.floatDefinition.defaultValue is None:
                    raise ValueError(f"{groundstation_name}: Malformed groundstation model: 'latitude' missing definition or value.")
                latitude = float(var.floatDefinition.defaultValue)
                if latitude == 0.0:
                    warnings.warn(f"{groundstation_name}: Latitude is 0.0, is this correct or an API default?", UserWarning)
                    
            elif var.name == "longitude":
                if not var.floatDefinition or var.floatDefinition.defaultValue is None:
                    raise ValueError(f"{groundstation_name}: Malformed groundstation model: 'longitude' missing definition or value.")
                longitude = float(var.floatDefinition.defaultValue)
                if longitude == 0.0:
                    warnings.warn(f"{groundstation_name}: Longitude is 0.0, is this correct or an API default?", UserWarning)
                    
            elif var.name == "min_link_elevation":
                if not var.floatDefinition or var.floatDefinition.defaultValue is None:
                    raise ValueError(f"{groundstation_name}: Malformed groundstation model: 'min_link_elevation' missing definition or value.")
                min_link_elevation = float(var.floatDefinition.defaultValue)
                if min_link_elevation == 0.0:
                    warnings.warn(f"{groundstation_name}: min_link_elevation is 0.0, is this correct or an API default?", UserWarning)

        # 4. Fail hard if variables were entirely missing from the loop
        if latitude is None:
            raise ValueError(f"{groundstation_name}: Missing required variable: 'latitude'")
        if longitude is None:
            raise ValueError(f"{groundstation_name}: Missing required variable: 'longitude'")
        if min_link_elevation is None:
            raise ValueError(f"{groundstation_name}: Missing required variable: 'min_link_elevation'")
        
        groundstation_information = GroundStationInformation(
            name=groundstation_name,
            latitude=latitude,
            longitude=longitude,
            min_link_elevation=min_link_elevation,
        )
        
        # 5. Cache and return
        cls._groundstation_cache[groundstation_name] = groundstation_information
        return groundstation_information