# app/repositories/asset_repository.py
import uuid
import warnings
from collections.abc import Sequence
from datetime import datetime, timezone
from api_connect.satio_session import SatIOSession
from pydantic_models.definitions import SatelliteModel
from pydantic_models.activity import ActivityInfoModel, ActivityStatus
from pydantic_models.schedule_event import ScheduleEventModel
from core.models.assets import SatelliteInformation, GroundStationInformation
from core.models.scheduling import LinkBlock
from core.models.activities import Activity, AssetSchedule
from app.models.satos import ActivityDTO, AssetInformation
from app.services.satos_connector import (
    satos_get_asset,
    satos_get_asset_list,
    satos_get_activities_list,
    push_activities_to_SatOS,
    satos_delete_activities,
    satos_clear_schedules,
    satos_clear_scope_activities,
)


class AssetRepository:
    _satellite_infos: dict[str, SatelliteInformation] = {}
    _groundstation_infos: dict[str, GroundStationInformation] = {}
    
    _raw_asset_models: dict[str, SatelliteModel] = {}
    
    _ineligible_cache: dict[str, str] = {}
    
    _raw_schedules: dict[str, list[ActivityInfoModel]] = {}
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
                                end_event=act.end_event,
                                name=getattr(act, "name", "") or "",
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
                if len(position_r) != 3:
                    raise ValueError(f"{satellite_name}: 'position_vector' must contain exactly 3 float values.")

            elif var.name == "velocity_vector":
                if not var.matrixDefinition or var.matrixDefinition.defaultValue is None:
                    raise ValueError(f"{satellite_name}: Malformed satellite model: 'velocity_vector' missing definition or value.")
                velocity_v = [float(val) for val in var.matrixDefinition.defaultValue]
                if velocity_v[0] == 0.0 or velocity_v[1] == 0.0 or velocity_v[2] == 0.0:
                    warnings.warn(f"{satellite_name}: Velocity vector has 0.0 as one of its components. Is this correct or an API default?", UserWarning)
                if len(velocity_v) != 3:
                    raise ValueError(f"{satellite_name}: 'velocity_vector' must contain exactly 3 float values.")

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

        # 5. Create internal domain model
        groundstation_information = GroundStationInformation(
            name=groundstation_name,
            latitude=latitude,
            longitude=longitude,
            min_link_elevation=min_link_elevation
        )
        
        # 6. Cache and return
        cls._groundstation_infos[groundstation_name] = groundstation_information
        return groundstation_information

    # =========================================================================
    # Scheduled Links -> SatOS Activity Bridge
    # =========================================================================

    @classmethod
    def create_activity_pair_from_link_block(
        cls,
        link: LinkBlock,
    ) -> tuple[Activity, Activity]:
        """
        Converts a single LinkBlock into a pair of correlated SatOS Activity objects:
        one for the satellite schedule and one for the ground station schedule.
        Both share the same AOS (start) and LOS (end) ScheduleEvent timestamps,
        and receive distinct, deterministic UUIDs.

        :param link: LinkBlock domain object
        :return: (satellite_activity, groundstation_activity)
        """
        start_time = link.start_time
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)

        end_time = link.end_time
        if end_time.tzinfo is None:
            end_time = end_time.replace(tzinfo=timezone.utc)

        # 1. Create AOS Event
        aos_uuid = uuid.uuid4()
        aos_event = ScheduleEventModel(
            uuid=aos_uuid,
            id=f"{link.link_id}_AOS",
            name=f"AOS: {link.satellite_name} - {link.groundstation_name}",
            timestamp=start_time,
            schedule_1=link.satellite_name,
            schedule_2=link.groundstation_name,
        )

        # 2. Create LOS Event
        los_uuid = uuid.uuid4()
        los_event = ScheduleEventModel(
            uuid=los_uuid,
            id=f"{link.link_id}_LOS",
            name=f"LOS: {link.satellite_name} - {link.groundstation_name}",
            timestamp=end_time,
            schedule_1=link.satellite_name,
            schedule_2=link.groundstation_name,
        )

        # 3. Create Satellite Activity
        act_name = f"DOWNLINK_{link.link_id}_{link.satellite_name}-{link.groundstation_name}"
        act_description = f"Downlink from {link.satellite_name} to {link.groundstation_name} from {start_time.isoformat()} to {end_time.isoformat()}"
        sat_activity = Activity(
            uuid=uuid.uuid4(),
            schedule_name=link.satellite_name,
            status=int(ActivityStatus.SUSPENDED),
            start_event=aos_event,
            end_event=los_event,
            name=act_name,
            description=act_description,
            priority=1,
            initiator="SCOPE_Scheduler",
            executor=link.satellite_name,
        )

        # 4. Create Ground Station Activity
        gs_activity = Activity(
            uuid=uuid.uuid4(),
            schedule_name=link.groundstation_name,
            status=int(ActivityStatus.SUSPENDED),
            start_event=aos_event,
            end_event=los_event,
            name=act_name,
            description=act_description,
            priority=1,
            initiator="SCOPE_Scheduler",
            executor=link.groundstation_name,
        )

        return sat_activity, gs_activity

    create_activities_from_link_block = create_activity_pair_from_link_block

    @classmethod
    def create_activities_from_link_blocks(
        cls,
        links: list[LinkBlock],
    ) -> list[Activity]:
        """
        Converts a collection of LinkBlock domain objects into a flat list
        of SatOS Activity domain objects (two per link: satellite and groundstation).

        :param links: sequence of LinkBlock domain objects
        :return: flat list of Activity domain objects
        """
        activities: list[Activity] = []
        for link in links:
            sat_act, gs_act = cls.create_activity_pair_from_link_block(link)
            activities.extend([sat_act, gs_act])
        return activities

    @classmethod
    def create_activity_from_dto(cls, dto: ActivityDTO) -> Activity:
        """
        Creates a domain Activity object from an ActivityDTO.

        :param dto: ActivityDTO model
        :return: Activity domain object
        """
        if isinstance(dto.start_time, datetime):
            start_ts = dto.start_time
        else:
            start_ts = datetime.fromisoformat(str(dto.start_time))
        if start_ts.tzinfo is None:
            start_ts = start_ts.replace(tzinfo=timezone.utc)

        if isinstance(dto.end_time, datetime):
            end_ts = dto.end_time
        else:
            end_ts = datetime.fromisoformat(str(dto.end_time))
        if end_ts.tzinfo is None:
            end_ts = end_ts.replace(tzinfo=timezone.utc)

        start_event = ScheduleEventModel(
            uuid=uuid.uuid4(),
            id=f"{dto.name}_start_{uuid.uuid4().hex[:8]}",
            name=f"{dto.name} - Start",
            timestamp=start_ts,
            schedule_1=dto.schedule_name,
        )

        end_event = ScheduleEventModel(
            uuid=uuid.uuid4(),
            id=f"{dto.name}_end_{uuid.uuid4().hex[:8]}",
            name=f"{dto.name} - End",
            timestamp=end_ts,
            schedule_1=dto.schedule_name,
        )

        dto_uuid = getattr(dto, "uuid", None)
        act_uuid = uuid.UUID(str(dto_uuid)) if dto_uuid else uuid.uuid4()

        return Activity(
            uuid=act_uuid,
            schedule_name=dto.schedule_name,
            status=dto.status,
            start_event=start_event,
            end_event=end_event,
            name=dto.name,
            description=dto.description,
            priority=dto.priority,
            initiator=dto.initiator,
            executor=dto.executor,
        )

    @classmethod
    def create_activities_from_dtos(cls, dtos: list[ActivityDTO]) -> list[Activity]:
        """
        Converts a list of ActivityDTO objects to a list of Activity domain objects.

        :param dtos: list of ActivityDTO models
        :return: list of Activity domain objects
        """
        return [cls.create_activity_from_dto(dto) for dto in dtos]

    @classmethod
    def push_activities_to_satos(cls, activities: list[Activity]) -> list[Activity]:
        """
        Pushes a list of Activity objects to SatOS and synchronizes the local _schedules cache.

        :param activities: list of Activity domain objects
        :return: list of pushed Activity objects
        """
        if not activities:
            return []

        # Push to SatOS
        push_activities_to_SatOS(activities)

        # Synchronize local _schedules cache
        for activity in activities:
            sched_name = activity.schedule_name
            existing_sched = next((s for s in cls._schedules if s.name == sched_name), None)
            if existing_sched:
                existing_sched.activities = [a for a in existing_sched.activities if a.uuid != activity.uuid]
                existing_sched.activities.append(activity)
            else:
                cls._schedules.append(
                    AssetSchedule(
                        name=sched_name,
                        activities=[activity]
                    )
                )

        return activities

    @classmethod
    def push_scheduled_links_to_satos(cls, links: list[LinkBlock]) -> list[Activity]:
        """
        Converts LinkBlock objects to Activity objects, pushes them to SatOS,
        synchronizes the local _schedules cache, and returns the created activities.

        :param links: list of LinkBlock domain objects
        :return: list of pushed Activity objects
        """
        activities = cls.create_activities_from_link_blocks(links)
        return cls.push_activities_to_satos(activities)

    push_link_blocks_to_satos = push_scheduled_links_to_satos

    @classmethod
    def delete_activities_from_satos(cls, activity_uuids: Sequence[uuid.UUID | str]) -> list[str]:
        """
        Deletes activities by their UUIDs from SatOS and synchronizes local schedule caches.

        :param activity_uuids: sequence of activity UUIDs (UUID objects or strings)
        :return: list of deleted activity UUID strings
        """
        if not activity_uuids:
            return []

        deleted_uuids = satos_delete_activities(activity_uuids)
        deleted_set = set(str(u) for u in deleted_uuids)

        # Synchronize _schedules cache
        for sched in cls._schedules:
            sched.activities = [a for a in sched.activities if str(a.uuid) not in deleted_set]

        # Synchronize _raw_schedules cache
        for sched_name, acts in cls._raw_schedules.items():
            cls._raw_schedules[sched_name] = [a for a in acts if str(a.uuid) not in deleted_set]

        return deleted_uuids

    @classmethod
    def clear_schedules_in_satos(cls, schedule_names: Sequence[str]) -> dict[str, list[str]]:
        """
        Clears all activities for each specified schedule in SatOS and synchronizes local caches.

        :param schedule_names: sequence of schedule names to clear
        :return: dictionary mapping each schedule_name to list of deleted activity UUID strings
        """
        if not schedule_names:
            return {}

        cleared_summary = satos_clear_schedules(schedule_names)

        for sched_name in schedule_names:
            # Clear local caches for this schedule
            cls._raw_schedules[sched_name] = []
            existing_sched = next((s for s in cls._schedules if s.name == sched_name), None)
            if existing_sched:
                existing_sched.activities = []

        return cleared_summary

    @classmethod
    def clear_scope_activities_in_satos(
        cls,
        schedule_names: Sequence[str],
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> dict[str, list[str]]:
        """
        Clears all SCOPE-generated activities (initiator == "SCOPE_Scheduler") for the specified
        schedules in SatOS, with optional time window filtering, and synchronizes local caches.

        :param schedule_names: sequence of schedule names to clear
        :param start_time: optional start of time window filter (inclusive)
        :param end_time: optional end of time window filter (inclusive)
        :return: dictionary mapping each schedule_name to list of deleted activity UUID strings
        """
        if not schedule_names:
            return {}

        cleared_summary = satos_clear_scope_activities(schedule_names, start_time, end_time)

        all_deleted_uuids = set()
        for deleted_list in cleared_summary.values():
            for u in deleted_list:
                all_deleted_uuids.add(str(u))

        # Synchronize _schedules cache
        for sched in cls._schedules:
            if sched.name in cleared_summary:
                sched.activities = [a for a in sched.activities if str(a.uuid) not in all_deleted_uuids]

        # Synchronize _raw_schedules cache
        for sched_name in schedule_names:
            if sched_name in cls._raw_schedules:
                cls._raw_schedules[sched_name] = [
                    a for a in cls._raw_schedules[sched_name] if str(a.uuid) not in all_deleted_uuids
                ]

        return cleared_summary
