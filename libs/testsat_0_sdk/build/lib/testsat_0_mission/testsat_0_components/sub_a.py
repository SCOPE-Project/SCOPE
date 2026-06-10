"""Module of sub_A."""

from testsat_0_mission.component import Component

from pydantic_core import TzInfo
from pydantic import AwareDatetime
from typing import Callable
from pydantic_models.definitions.command_definition import CommandDefModel
from testsat_0_mission.factory import _command_factory
from api_connect.satio_session import SatIOSession  # Managing the connection to sat:io
from testsat_0_mission.command import SdkCommand
from testsat_0_mission.variable import SdkVariable
from pydantic_models.command import RelativeInfoModel
from pydantic_models.definitions import VersionModel
from pydantic_models.value_field import OctetStringModel, MatrixModel
from pydantic_models.definitions import ParameterDefModel
from enum import Enum
from datetime import datetime
import base64


UTC=0





class Sub_A(Component):
    """."""

    

    def __init__(self):
        """Component creation of testsat_0.sub_A."""
        super().__init__(description='', id_path='testsat_0.sub_A')


    
    class Cmd_set_mode(SdkCommand):
        """Command created from definition set mode."""
        class MODE(int, Enum):
            """Mode of the subsystem."""
            INIT = 0
            SAFE = 1
            NORMAL = 2
            
        
        def __init__(
        self,
        mode: MODE = 0,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """A command to set the subsystem mode.
                 
                :param mode: Mode of the subsystem
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # enum check for {'values': {0: 'init', 1: 'safe', 2: 'normal'}, 'defaultValue': 0}
            if mode not in self.MODE.__members__.values():
                raise ValueError(f"mode is not in MODE. Was { mode }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'A command to set the subsystem mode', 'name': 'set mode', 'parameters': [{'enumDefinition': {'values': {0: 'init', 1: 'safe', 2: 'normal'}, 'defaultValue': 0}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'mode', 'description': 'Mode of the subsystem', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_A.set mode",
                    params=[
                        mode,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        
    class Cmd_set_parameters(SdkCommand):
        """Command created from definition set parameters."""
        
        
        def __init__(
        self,
        parameter_1: int = 0,
        parameter_2: float = 10.2,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Command to set two parameters.
                 
                :param parameter_1: Parameter 1 of the subsystem
                :param parameter_2: Parameter 2 of the subsystem
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # int limit check for {'min': -100, 'max': 100, 'defaultValue': 0}
            if not (-100 <= parameter_1 <= 100):
                raise ValueError(f"parameter_1 out of bounds. Should be between -100 and 100 was { parameter_1 }")
            # float limit check for {'min': 0.0, 'max': 25.678, 'defaultValue': 10.2}
            if not (0.0 <= parameter_2 <= 25.678):
                raise ValueError(f"parameter_2 out of bounds. Should be between 0.0 and 25.678 was { parameter_2 }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Command to set two parameters', 'name': 'set parameters', 'parameters': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': -100, 'max': 100, 'defaultValue': 0}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'parameter 1', 'description': 'Parameter 1 of the subsystem', 'unit': ''}, {'enumDefinition': None, 'floatDefinition': {'min': 0.0, 'max': 25.678, 'defaultValue': 10.2}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'parameter 2', 'description': 'Parameter 2 of the subsystem', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_A.set parameters",
                    params=[
                        parameter_1,
                        parameter_2,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        
    class Cmd_set_binary(SdkCommand):
        """Command created from definition set binary."""
        
        def __init__(
        self,
        binary: OctetStringModel,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Command to set binary value.
                 
                :param binary: Binary value to be set.
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # octet length check for {'length': 10, 'defaultValue': None}
            if not 10 == len(binary ):
                raise ValueError(f"binary has wrong length. Should be 10 was { len(binary) }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Command to set binary value', 'name': 'set binary', 'parameters': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': {'length': 10, 'defaultValue': None}, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'binary', 'description': 'Binary value to be set.', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_A.set binary",
                    params=[
                        binary,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        
    class Cmd_request_dir_listing(SdkCommand):
        """Command created from definition request dir listing."""
        
        def __init__(
        self,
        directory: str = '',
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Command to request directory listing.
                 
                :param directory: Directory to receive the listing.
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            

            cmd_def = CommandDefModel.model_validate({'description': 'Command to request directory listing', 'name': 'request dir listing', 'parameters': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'directory', 'description': 'Directory to receive the listing.', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_A.request dir listing",
                    params=[
                        directory,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        
    class Cmd_set_packet_interval(SdkCommand):
        """Command created from definition set packet interval."""
        
        def __init__(
        self,
        interval: int = 5000000,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Command to set packet interval.
                 
                :param interval: Packet interval in microseconds
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # int limit check for {'min': 0, 'max': 180000000, 'defaultValue': 5000000}
            if not (0 <= interval <= 180000000):
                raise ValueError(f"interval out of bounds. Should be between 0 and 180000000 was { interval }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Command to set packet interval', 'name': 'set packet interval', 'parameters': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 180000000, 'defaultValue': 5000000}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'interval', 'description': 'Packet interval in microseconds', 'unit': 'us'}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_A.set packet interval",
                    params=[
                        interval,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        

    
    @property
    def Var_mode(self) -> SdkVariable:
        """Mode of the subsystem."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'init', 1: 'safe', 2: 'normal'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'mode', 'description': 'Mode of the subsystem', 'unit': ''}), id_path="testsat_0.sub_A.mode"
        )
    
    @property
    def Var_temperature(self) -> SdkVariable:
        """Temperature of the subsystem."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': {'min': -30.0, 'max': 30.0, 'defaultValue': 0.0}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'temperature', 'description': 'Temperature of the subsystem', 'unit': '°C'}), id_path="testsat_0.sub_A.temperature"
        )
    
    @property
    def Var_time(self) -> SdkVariable:
        """Time of the subsystem."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': {'minimum': datetime.datetime(1970, 1, 1, 0, 0, tzinfo=datetime.timezone.utc), 'maximum': datetime.datetime(1970, 1, 1, 0, 0, tzinfo=datetime.timezone.utc), 'defaultValue': datetime.datetime(2024, 8, 20, 15, 37, 53, 551369, tzinfo=datetime.timezone.utc)}, 'name': 'time', 'description': 'Time of the subsystem', 'unit': ''}), id_path="testsat_0.sub_A.time"
        )
    
    @property
    def Var_binary_data_device_X(self) -> SdkVariable:
        """Binary data of the subsystem."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': {'length': 0, 'defaultValue': b'yv4='}, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'binary data device X', 'description': 'Binary data of the subsystem', 'unit': ''}), id_path="testsat_0.sub_A.binary data device X"
        )
    
    @property
    def Var_dir_listing(self) -> SdkVariable:
        """Directory to receive the listing.."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'dir listing', 'description': 'Directory to receive the listing.', 'unit': ''}), id_path="testsat_0.sub_A.dir listing"
        )
    
    @property
    def Var_random_int(self) -> SdkVariable:
        """Random integer value."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 10, 'defaultValue': 0}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'random int', 'description': 'Random integer value', 'unit': ''}), id_path="testsat_0.sub_A.random int"
        )
    