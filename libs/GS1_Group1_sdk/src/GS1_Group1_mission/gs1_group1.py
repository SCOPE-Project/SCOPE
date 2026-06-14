"""Module of GS1_Group1."""

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


UTC=0




class GS1_Group1(Satellite):
    """Owned by Group 1 for Project: Decision-Making for VLEO Communications Scheduling

GS1-Spitzbergen
(78.24, 15.41)

Actual KSAT Svalbard Ground Station location."""

    

    def __init__(self):
        """Initialize object.name Owned by Group 1 for Project: Decision-Making for VLEO Communications Scheduling

GS1-Spitzbergen
(78.24, 15.41)

Actual KSAT Svalbard Ground Station location."""
        satellite_model = SatelliteModel.model_validate({'version': {'major': 1, 'minor': 0, 'patch': 0, 'description': None}, 'archived': False, 'name': 'GS1_Group1', 'description': 'Owned by Group 1 for Project: Decision-Making for VLEO Communications Scheduling\n\nGS1-Spitzbergen\n(78.24, 15.41)\n\nActual KSAT Svalbard Ground Station location', 'components': [], 'commandDefinitions': [], 'eventDefinitions': [], 'variableDefinitions': [{'enumDefinition': None, 'floatDefinition': {'min': -90.0, 'max': 90.0, 'defaultValue': 78.24}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'latitude', 'description': '', 'unit': ''}, {'enumDefinition': None, 'floatDefinition': {'min': -180.0, 'max': 180.0, 'defaultValue': 15.41}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'longitude', 'description': '', 'unit': ''}], 'tmSetDefinitions': [], 'norad_id': None, 'opm_object_id': None, 'custom_fields': None})
        super().__init__(satellite_model=satellite_model)




    

    
    @property
    def Var_latitude(self) -> SdkVariable:
        """."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': {'min': -90.0, 'max': 90.0, 'defaultValue': 78.24}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'latitude', 'description': '', 'unit': ''}), id_path="GS1_Group1.latitude"
        )
    
    @property
    def Var_longitude(self) -> SdkVariable:
        """."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': {'min': -180.0, 'max': 180.0, 'defaultValue': 15.41}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'longitude', 'description': '', 'unit': ''}), id_path="GS1_Group1.longitude"
        )
    