"""Module of Sat1_Group1."""

from pydantic_models.definitions import (SatelliteModel)
from .satellite import Satellite

from pydantic_core import TzInfo
from pydantic import AwareDatetime
from typing import Callable
from pydantic_models.definitions.command_definition import CommandDefModel
from .factory import _command_factory
from api_connect.satio_session import SatIOSession  # Managing the connection to sat:io
from .command import SdkCommand
from .variable import SdkVariable
from pydantic_models.command import RelativeInfoModel
from pydantic_models.definitions import VersionModel
from pydantic_models.value_field import OctetStringModel, MatrixModel
from pydantic_models.definitions import ParameterDefModel
from enum import Enum
from datetime import datetime
import base64
from .Sat1_Group1_components.navigation import Navigation


UTC=0




class Sat1_Group1(Satellite):
    """."""

    
    Comp_navigation: Navigation = Navigation()
    

    def __init__(self):
        """Initialize object.name ."""
        satellite_model = SatelliteModel.model_validate({'version': {'major': 0, 'minor': 5, 'patch': 0, 'description': None}, 'archived': False, 'name': 'Sat1_Group1', 'description': '', 'components': [{'name': 'navigation', 'description': '', 'components': [], 'commandDefinitions': [], 'eventDefinitions': [], 'variableDefinitions': [], 'tmSetDefinitions': []}], 'commandDefinitions': [], 'eventDefinitions': [], 'variableDefinitions': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 1, 'columns': 3, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'position_vector', 'description': 'Cartesian position vector [x, y, z], that describes the current position of the satellite in the GCRF coordinate frame.', 'unit': 'm'}, {'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 1, 'columns': 3, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'velocity_vector', 'description': 'Cartesian velocity vector [vx, vy, vz], that describes the current velocity of the satellite in the GCRF coordinate frame.', 'unit': 'm/s'}], 'tmSetDefinitions': [], 'norad_id': None, 'opm_object_id': None, 'custom_fields': None})
        super().__init__(satellite_model=satellite_model)




    

    
    @property
    def Var_position_vector(self) -> SdkVariable:
        """Cartesian position vector [x, y, z], that describes the current position of the satellite in the GCRF coordinate frame.."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 1, 'columns': 3, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'position_vector', 'description': 'Cartesian position vector [x, y, z], that describes the current position of the satellite in the GCRF coordinate frame.', 'unit': 'm'}), id_path="Sat1_Group1.position_vector"
        )
    
    @property
    def Var_velocity_vector(self) -> SdkVariable:
        """Cartesian velocity vector [vx, vy, vz], that describes the current velocity of the satellite in the GCRF coordinate frame.."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': {'rows': 1, 'columns': 3, 'defaultValue': None}, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'velocity_vector', 'description': 'Cartesian velocity vector [vx, vy, vz], that describes the current velocity of the satellite in the GCRF coordinate frame.', 'unit': 'm/s'}), id_path="Sat1_Group1.velocity_vector"
        )
    