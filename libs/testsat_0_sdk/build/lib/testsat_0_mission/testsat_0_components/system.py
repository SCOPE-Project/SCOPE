"""Module of system."""

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





class System(Component):
    """."""

    

    def __init__(self):
        """Component creation of testsat_0.system."""
        super().__init__(description='', id_path='testsat_0.system')


    
    class Cmd_PING(SdkCommand):
        """Command created from definition PING."""
        def __init__(
        self,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """A simple ping command.
                 
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            

            cmd_def = CommandDefModel.model_validate({'description': 'A simple ping command', 'name': 'PING', 'parameters': []})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.system.PING",
                    
                    absolute_release_time=absolute_release_time,
                    relative_release_info=relative_release_info,
                    absolute_execution_time=absolute_execution_time,
                    relative_execution_info=relative_execution_info,
                    command_version=VersionModel.model_validate({'major': 2, 'minor': 1, 'patch': 2, 'description': 'Test satellite used for tests .'}),
                    )
                )
            if change_callback is not None:
                SatIOSession.get_session().attach_socket_callback(for_object=self.uuid, callback_function=change_callback)
        

    