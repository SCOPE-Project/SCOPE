"""Module of sub_B."""

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





class Sub_B(Component):
    """."""

    

    def __init__(self):
        """Component creation of testsat_0.sub_B."""
        super().__init__(description='', id_path='testsat_0.sub_B')


    
    class Cmd_set_mode(SdkCommand):
        """Command created from definition set mode."""
        class MODE(int, Enum):
            """Mode of the subsystem."""
            NONE = 0
            SAFE = 1
            POINT = 2
            POINTEVENMORE = 3
            ELEVEN = 11
            
        
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

            # enum check for {'values': {0: 'none', 1: 'safe', 2: 'point', 3: 'pointevenmore', 11: 'eleven'}, 'defaultValue': 0}
            if mode not in self.MODE.__members__.values():
                raise ValueError(f"mode is not in MODE. Was { mode }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'A command to set the subsystem mode', 'name': 'set mode', 'parameters': [{'enumDefinition': {'values': {0: 'none', 1: 'safe', 2: 'point', 3: 'pointevenmore', 11: 'eleven'}, 'defaultValue': 0}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'mode', 'description': 'Mode of the subsystem', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_B.set mode",
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
        
    class Cmd_set_position(SdkCommand):
        """Command created from definition set position."""
        
        def __init__(
        self,
        position: MatrixModel,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Command to set the position of the simulated S/C.
                 
                :param position: Current position vector
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # matrix size check for None
            if 1 != position.columns:
                raise ValueError(f"position has wrong columns. Should be 1 was { position.columns }")
            if 3 != position.rows:
                raise ValueError(f"position has wrong rows. Should be 3 was { position.rows }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Command to set the position of the simulated S/C', 'name': 'set position', 'parameters': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 3, 'columns': 1, 'defaultValue': [0.0, 0.0, 6978100.0]}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'Position', 'description': 'Current position vector', 'unit': 'm'}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.sub_B.set position",
                    params=[
                        position,],
                    
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
        """Mode of the subsystem B."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'none', 1: 'safe', 2: 'point', 11: 'eleven', 3: 'pointevenmore'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'mode', 'description': 'Mode of the subsystem B', 'unit': ''}), id_path="testsat_0.sub_B.mode"
        )
    
    @property
    def Var_rotation(self) -> SdkVariable:
        """Current rotation rates of the satellite."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 3, 'columns': 1, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'rotation', 'description': 'Current rotation rates of the satellite', 'unit': 'rad/s'}), id_path="testsat_0.sub_B.rotation"
        )
    
    @property
    def Var_attitude(self) -> SdkVariable:
        """Current attitude quaternion of the satellite."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 4, 'columns': 1, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'attitude', 'description': 'Current attitude quaternion of the satellite', 'unit': '-'}), id_path="testsat_0.sub_B.attitude"
        )
    
    @property
    def Var_position(self) -> SdkVariable:
        """Current position of the satellite in WGS84."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 3, 'columns': 1, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'position', 'description': 'Current position of the satellite in WGS84', 'unit': 'm'}), id_path="testsat_0.sub_B.position"
        )
    
    @property
    def Var_velocity(self) -> SdkVariable:
        """Current velocity of the satellite in WGS84."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 3, 'columns': 1, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'velocity', 'description': 'Current velocity of the satellite in WGS84', 'unit': 'm/s'}), id_path="testsat_0.sub_B.velocity"
        )
    