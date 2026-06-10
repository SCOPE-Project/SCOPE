"""Module of gnd."""

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
from .gnd_components.cfdp import Cfdp


UTC=0





class Gnd(Component):
    """."""

    
    Comp_cfdp: Cfdp = Cfdp()
    

    def __init__(self):
        """Component creation of testsat_0.gnd."""
        super().__init__(description='', id_path='testsat_0.gnd')


    

    