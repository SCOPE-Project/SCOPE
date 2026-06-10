"""Module of link."""

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





class Link(Component):
    """Simulated Link."""

    

    def __init__(self):
        """Component creation of testsat_0.link."""
        super().__init__(description='Simulated Link', id_path='testsat_0.link')


    
    class Cmd_switch_uplink(SdkCommand):
        """Command created from definition switch uplink."""
        class SWITCH(int, Enum):
            """Switch the uplink on or off.."""
            CONNECTED = 1
            DISCONNECTED = 2
            
        
        
        def __init__(
        self,
        timer: int = 10,
        switch: SWITCH = 2,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Switch the uplink. It will switch back up after a certain time..
                 
                :param switch: Switch the uplink on or off.
                :param timer: Time until the uplink switches back up in seconds.
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # enum check for {'values': {1: 'CONNECTED', 2: 'DISCONNECTED'}, 'defaultValue': 2}
            if switch not in self.SWITCH.__members__.values():
                raise ValueError(f"switch is not in SWITCH. Was { switch }")
            # int limit check for {'min': 0, 'max': 360, 'defaultValue': 10}
            if not (0 <= timer <= 360):
                raise ValueError(f"timer out of bounds. Should be between 0 and 360 was { timer }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Switch the uplink. It will switch back up after a certain time.', 'name': 'switch uplink', 'parameters': [{'enumDefinition': {'values': {1: 'CONNECTED', 2: 'DISCONNECTED'}, 'defaultValue': 2}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'switch', 'description': 'Switch the uplink on or off.', 'unit': ''}, {'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 360, 'defaultValue': 10}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'timer', 'description': 'Time until the uplink switches back up in seconds.', 'unit': 's'}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.link.switch uplink",
                    params=[
                        switch,
                        timer,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        
    class Cmd_switch_downlink(SdkCommand):
        """Command created from definition switch downlink."""
        class SWITCH(int, Enum):
            """Switch the downlink on or off.."""
            CONNECTED = 1
            DISCONNECTED = 2
            
        
        def __init__(
        self,
        switch: SWITCH = 2,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Switch the downlink..
                 
                :param switch: Switch the downlink on or off.
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # enum check for {'values': {1: 'CONNECTED', 2: 'DISCONNECTED'}, 'defaultValue': 2}
            if switch not in self.SWITCH.__members__.values():
                raise ValueError(f"switch is not in SWITCH. Was { switch }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Switch the downlink.', 'name': 'switch downlink', 'parameters': [{'enumDefinition': {'values': {1: 'CONNECTED', 2: 'DISCONNECTED'}, 'defaultValue': 2}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'switch', 'description': 'Switch the downlink on or off.', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.link.switch downlink",
                    params=[
                        switch,],
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        

    