"""Module of navigation."""

from Sat1_Group1_mission.component import Component

from pydantic_core import TzInfo
from pydantic import AwareDatetime
from typing import Callable
from pydantic_models.definitions.command_definition import CommandDefModel
from Sat1_Group1_mission.factory import _command_factory
from api_connect.satio_session import SatIOSession  # Managing the connection to sat:io
from Sat1_Group1_mission.command import SdkCommand
from Sat1_Group1_mission.variable import SdkVariable
from pydantic_models.command import RelativeInfoModel
from pydantic_models.definitions import VersionModel
from pydantic_models.value_field import OctetStringModel, MatrixModel
from pydantic_models.definitions import ParameterDefModel
from enum import Enum
from datetime import datetime
import base64


UTC=0





class Navigation(Component):
    """."""

    

    def __init__(self):
        """Component creation of Sat1_Group1.navigation."""
        super().__init__(description='', id_path='Sat1_Group1.navigation')


    

    