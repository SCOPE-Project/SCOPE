# /services/asset_repository.py
from pydantic_models.definitions import SatelliteModel
from core.models.domain import SatelliteInformation, GroundStationInformation
from pydantic_models.activity import ActivityInfoModel
from app.services.satos_connector import satos_get_asset, satos_get_asset_list, satos_get_activities_list
from datetime import datetime
import warnings
from api_connect.satio_session import SatIOSession
from app.models.tasks import AssetInformation, AssetSchedule, Activity

class AssetRepository:
    _satellite_infos: dict[str, SatelliteInformation] = {}
    _groundstation_infos: dict[str, GroundStationInformation] = {}
    
    _raw_asset_models: dict[str, SatelliteModel] = {}
    
    _ineligible_cache: dict[str, str] = {}
    
    _raw_schedules : dict[str, list[ActivityInfoModel]] = {}
    _schedules: list[AssetSchedule] = []
    
    _initialized_assets: list[AssetInformation] = []

    
    _initialized = False
    
    @classmethod
    def initialize_repository(cls, force_refresh: bool = False) -> None:
        """
        Retrieves the list of assets from SatOS, queries the full configuration
        for each asset, parses eligible assets as satellites or ground stations,
        and caches the results (including ineligible ones).
        """
        # Clear existing caches
        if force_refresh:
            cls._satellite_infos.clear()
            cls._groundstation_infos.clear()
            cls._raw_asset_models.clear()
            cls._ineligible_cache.clear()
            cls._schedules.clear()
            cls._initialized = False
        
        # For debugging, read the return list from cache instead of querying SatOS
        if cls._initialized:
            return

        with SatIOSession():
            try:
                asset_list = satos_get_asset_list()
            except Exception as e:
                raise RuntimeError(f"Failed to fetch asset list from SatOS: {e}")

            cls._schedules.clear()
            results = []
            for info in asset_list:
                asset_name = info.name
                try:
                    # 1. Fetch raw asset and cache it
                    raw_asset_model = satos_get_asset(asset_name=asset_name)
                    cls._raw_asset_models[asset_name] = raw_asset_model
                    
                    raw_schedule = satos_get_activities_list(schedule_name=asset_name)
                    cls._raw_schedules[asset_name] = raw_schedule

                    activities_list = []
                    for act in raw_schedule:
                        activities_list.append(
                            Activity(
                                uuid=act.uuid,
                                schedule_name=act.schedule_name,
                                status=act.status,
                                start_event=act.start_event,
                                end_event=act.end_event
                            )
                        )
                    cls._schedules.append(
                        AssetSchedule(
                            name=asset_name,
                            activities=activities_list
                        )
                    )

                    # 2. Identify the intended classification based on defined variables
                    var_names = {var.name for var in raw_asset_model.variableDefinitions}
                    
                    is_satellite_candidate = any(name in var_names for name in ["position_vector", "velocity_vector", "state_timestamp"])
                    is_groundstation_candidate = any(name in var_names for name in ["latitude", "longitude", "min_link_elevation"])

                    if is_satellite_candidate and is_groundstation_candidate:
                        reason = "Ambiguous asset type: contains both satellite and ground station variables"
                        cls._ineligible_cache[asset_name] = reason
                        results.append(AssetInformation(
                            name=asset_name,
                            eligible=False,
                            classification="ineligible",
                            error=reason
                        ))
                    elif is_satellite_candidate:
                        try:
                            cls.get_satellite_information(asset_name)
                            results.append(AssetInformation(
                                name=asset_name,
                                eligible=True,
                                classification="satellite",
                                details=cls._satellite_infos[asset_name]
                            ))
                        except Exception as e:
                            reason = f"Malformed satellite model: {e}"
                            cls._ineligible_cache[asset_name] = reason
                            results.append(AssetInformation(
                                name=asset_name,
                                eligible=False,
                                classification="satellite",
                                error=reason
                            ))
                    elif is_groundstation_candidate:
                        try:
                            cls.get_groundstation_information(asset_name)
                            results.append(AssetInformation(
                                name=asset_name,
                                eligible=True,
                                classification="groundstation",
                                details=cls._groundstation_infos[asset_name]
                            ))
                        except Exception as e:
                            reason = f"Malformed ground station model: {e}"
                            cls._ineligible_cache[asset_name] = reason
                            results.append(AssetInformation(
                                name=asset_name,
                                eligible=False,
                                classification="groundstation",
                                error=reason
                            ))
                    else:
                        reason = "Unknown asset type: missing both satellite and ground station variables"
                        cls._ineligible_cache[asset_name] = reason
                        results.append(AssetInformation(
                            name=asset_name,
                            eligible=False,
                            classification="ineligible",
                            error=reason
                        ))

                except Exception as e:
                    # This catches communication/fetching failures (like 403 Forbidden)
                    reason = f"Fetch error: {e}"
                    cls._ineligible_cache[asset_name] = reason
                    results.append(AssetInformation(
                        name=asset_name,
                        eligible=False,
                        classification="ineligible",
                        error=reason
                    ))

            cls._initialized_assets = results
            cls._initialized = True

    @classmethod
    def get_assets(cls) -> list[AssetInformation]:
        """
        Retrieves the cached list of initialized assets.
        """
        return cls._initialized_assets

    @classmethod
    def get_asset_raw_schedules(cls) -> dict[str, list[ActivityInfoModel]]:
        """
        Retrieves the cached dictionary mapping asset names to their raw activity schedules.
        """
        return cls._raw_schedules

    @classmethod
    def get_asset_schedules(cls) -> list[AssetSchedule]:
        """
        Retrieves the cached list of condensed AssetSchedules.
        """
        return cls._schedules

    @classmethod
    def get_satellite_information(cls, satellite_name: str) -> SatelliteInformation:
        """
        Retrieves the Satellite domain information model, fetching from SatOS if not cached.
        """
        if satellite_name in cls._satellite_infos:
            return cls._satellite_infos[satellite_name]
        
        if satellite_name in cls._ineligible_cache:
            raise ValueError(f"Asset is marked ineligible: {cls._ineligible_cache[satellite_name]}")
        
        if satellite_name in cls._raw_asset_models:
            raw_satellite_model = cls._raw_asset_models[satellite_name]
        else:
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
        cls._satellite_infos[satellite_name] = satellite_information
        return satellite_information
    
    @classmethod
    def get_groundstation_information(cls, groundstation_name: str) -> GroundStationInformation:
        """
        Retrieves the groundstation domain information model, fetching from SatOS if not cached.
        """
        if groundstation_name in cls._groundstation_infos:
            return cls._groundstation_infos[groundstation_name]
        
        if groundstation_name in cls._ineligible_cache:
            raise ValueError(f"Asset is marked ineligible: {cls._ineligible_cache[groundstation_name]}")
        
        if groundstation_name in cls._raw_asset_models:
            groundstation_model = cls._raw_asset_models[groundstation_name]
        else:
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
        cls._groundstation_infos[groundstation_name] = groundstation_information
        return groundstation_information
    
    @classmethod
    def get_schedule(cls, schedule_name: str) -> list[ActivityInfoModel]:
        """
        Retrieves the schedule information, fetching from SatOS if not cached.
        """
        if schedule_name in cls._raw_schedules:
            return cls._raw_schedules[schedule_name]
        
        try:
            schedule_information = satos_get_activities_list(schedule_name=schedule_name)
            cls._raw_schedules[schedule_name] = schedule_information
            
            # Keep _schedules list in sync
            cls._schedules = [s for s in cls._schedules if s.name != schedule_name]
            cls._schedules.append(
                AssetSchedule(
                    name=schedule_name,
                    activities=[
                        Activity(
                            uuid=act.uuid,
                            schedule_name=act.schedule_name,
                            status=act.status,
                            start_event=act.start_event,
                            end_event=act.end_event
                        )
                        for act in schedule_information
                    ]
                )
            )
            
            return schedule_information
        except Exception as e:
            raise RuntimeError(f"Failed to fetch schedule information for {schedule_name} from SatOS: {e}")