"""Module of cfdp."""

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





class Cfdp(Component):
    """CFDP Service component for sending and receiving files."""

    

    def __init__(self):
        """Component creation of testsat_0.gnd.cfdp."""
        super().__init__(description='CFDP Service component for sending and receiving files', id_path='testsat_0.gnd.cfdp')


    
    class Cmd_put(SdkCommand):
        """Command created from definition put."""
        
        
        
        class TRANSMISSION_MODE(int, Enum):
            """Transmission mode of this request."""
            ACKNOWLEDGED = 0
            UNACKNOWLEDGED = 1
            
        
        class CLOSURE_REQUESTED(int, Enum):
            """Whether closure is requested."""
            NO = 0
            YES = 1
            
        
        def __init__(
        self,
        source_file: str = '',
        dest_file: str = '',
        transmission_mode: TRANSMISSION_MODE = 0,
        destination_id: int = 1,
        closure_requested: CLOSURE_REQUESTED = 1,
        
        change_callback: Callable | None = None,
        absolute_release_time: AwareDatetime | None = None,
        relative_release_info: RelativeInfoModel | None = None,
        absolute_execution_time: AwareDatetime | None = None,
        relative_execution_info: RelativeInfoModel | None = None):

            """Put request for a CFDP Entity.
                 
                :param destination_id: Entity ID of the destination Node
                :param source_file: Path to the source file
                :param dest_file: Path to the destination file
                :param transmission_mode: Transmission mode of this request
                :param closure_requested: Whether closure is requested
                :param change_callback: Callable, the callback function to call when the command changes
                :param absolute_release_time: AwareDatetime, the absolute time when the command should be released
                :param relative_release_info: relative release info to be used
                :param absolute_execution_time: AwareDatetime, the absolute time when the command should be executed
                :param relative_execution_info: relative execution info to be used

                :return: Command, the created command object
            """

            # int limit check for {'min': 0, 'max': 9007199254740991, 'defaultValue': 1}
            if not (0 <= destination_id <= 9007199254740991):
                raise ValueError(f"destination_id out of bounds. Should be between 0 and 9007199254740991 was { destination_id }")
            # enum check for {'values': {0: 'ACKNOWLEDGED', 1: 'UNACKNOWLEDGED'}, 'defaultValue': 0}
            if transmission_mode not in self.TRANSMISSION_MODE.__members__.values():
                raise ValueError(f"transmission_mode is not in TRANSMISSION_MODE. Was { transmission_mode }")
            # enum check for {'values': {0: 'No', 1: 'Yes'}, 'defaultValue': 1}
            if closure_requested not in self.CLOSURE_REQUESTED.__members__.values():
                raise ValueError(f"closure_requested is not in CLOSURE_REQUESTED. Was { closure_requested }")
            

            cmd_def = CommandDefModel.model_validate({'description': 'Put request for a CFDP Entity', 'name': 'put', 'parameters': [{'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 9007199254740991, 'defaultValue': 1}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'destination_id', 'description': 'Entity ID of the destination Node', 'unit': ''}, {'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'source_file', 'description': 'Path to the source file', 'unit': ''}, {'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'dest_file', 'description': 'Path to the destination file', 'unit': ''}, {'enumDefinition': {'values': {0: 'ACKNOWLEDGED', 1: 'UNACKNOWLEDGED'}, 'defaultValue': 0}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'transmission_mode', 'description': 'Transmission mode of this request', 'unit': ''}, {'enumDefinition': {'values': {0: 'No', 1: 'Yes'}, 'defaultValue': 1}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'closure_requested', 'description': 'Whether closure is requested', 'unit': ''}]})
            super().__init__(command_model=
                _command_factory(
                    cmd_def=cmd_def,
                    id_path="testsat_0.gnd.cfdp.put",
                    params=[
                        destination_id,
                        source_file,
                        dest_file,
                        transmission_mode,
                        closure_requested,],
                    
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
    def Var_dl_transaction_id(self) -> SdkVariable:
        """Transaction ID for DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 9007199254740991, 'defaultValue': 0}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'dl_transaction_id', 'description': 'Transaction ID for DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_transaction_id"
        )
    
    @property
    def Var_dl_condition_code(self) -> SdkVariable:
        """Condition code of the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'NO_ERROR', -1: 'NO_CONDITION_FIELD', 1: 'POSITIVE_ACK_LIMIT_REACHED', 2: 'KEEP_ALIVE_LIMIT_REACHED', 3: 'INVALID_TRANSMISSION_MODE', 4: 'FILESTORE_REJECTION', 5: 'FILE_CHECKSUM_FAILURE', 6: 'FILE_SIZE_ERROR', 7: 'NAK_LIMIT_REACHED', 8: 'INACTIVITY_DETECTED', 10: 'CHECK_LIMIT_REACHED', 11: 'UNSUPPORTED_CHECKSUM_TYPE', 14: 'SUSPEND_REQUEST_RECEIVED', 15: 'CANCEL_REQUEST_RECEIVED'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'dl_condition_code', 'description': 'Condition code of the corresponding transaction id the DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_condition_code"
        )
    
    @property
    def Var_dl_delivery_code(self) -> SdkVariable:
        """Delivery code of the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'DATA_COMPLETE', 1: 'DATA_INCOMPLETE'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'dl_delivery_code', 'description': 'Delivery code of the corresponding transaction id the DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_delivery_code"
        )
    
    @property
    def Var_dl_file_status(self) -> SdkVariable:
        """File status of the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'DISCARDED_DELIBERATELY', 1: 'DISCARDED_FILESTORE_REJECTION', 2: 'FILE_RETAINED', 3: 'FILE_STATUS_UNREPORTED'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'dl_file_status', 'description': 'File status of the corresponding transaction id the DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_file_status"
        )
    
    @property
    def Var_dl_file_size(self) -> SdkVariable:
        """Size of the file for the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 9007199254740991, 'defaultValue': 0}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'dl_file_size', 'description': 'Size of the file for the corresponding transaction id the DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_file_size"
        )
    
    @property
    def Var_dl_src_file_name(self) -> SdkVariable:
        """Name of the source file for the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'dl_src_file_name', 'description': 'Name of the source file for the corresponding transaction id the DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_src_file_name"
        )
    
    @property
    def Var_dl_dst_file_name(self) -> SdkVariable:
        """Name of the destination file for the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'dl_dst_file_name', 'description': 'Name of the destination file for the corresponding transaction id the DOWNLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_dst_file_name"
        )
    
    @property
    def Var_dl_message_to_user(self) -> SdkVariable:
        """Message to user for the corresponding transaction id the DOWNLINK link, if the S/C delivers them.."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'dl_message_to_user', 'description': 'Message to user for the corresponding transaction id the DOWNLINK link, if the S/C delivers them.', 'unit': ''}), id_path="testsat_0.gnd.cfdp.dl_message_to_user"
        )
    
    @property
    def Var_dl_file_progress(self) -> SdkVariable:
        """File progress of the corresponding transaction id the DOWNLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': {'min': 0.0, 'max': 100.0, 'defaultValue': 0.0}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'dl_file_progress', 'description': 'File progress of the corresponding transaction id the DOWNLINK link', 'unit': '%'}), id_path="testsat_0.gnd.cfdp.dl_file_progress"
        )
    
    @property
    def Var_up_transaction_id(self) -> SdkVariable:
        """Transaction ID for UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 9007199254740991, 'defaultValue': 0}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'up_transaction_id', 'description': 'Transaction ID for UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_transaction_id"
        )
    
    @property
    def Var_up_condition_code(self) -> SdkVariable:
        """Condition code of the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'NO_ERROR', -1: 'NO_CONDITION_FIELD', 1: 'POSITIVE_ACK_LIMIT_REACHED', 2: 'KEEP_ALIVE_LIMIT_REACHED', 3: 'INVALID_TRANSMISSION_MODE', 4: 'FILESTORE_REJECTION', 5: 'FILE_CHECKSUM_FAILURE', 6: 'FILE_SIZE_ERROR', 7: 'NAK_LIMIT_REACHED', 8: 'INACTIVITY_DETECTED', 10: 'CHECK_LIMIT_REACHED', 11: 'UNSUPPORTED_CHECKSUM_TYPE', 14: 'SUSPEND_REQUEST_RECEIVED', 15: 'CANCEL_REQUEST_RECEIVED'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'up_condition_code', 'description': 'Condition code of the corresponding transaction id the UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_condition_code"
        )
    
    @property
    def Var_up_delivery_code(self) -> SdkVariable:
        """Delivery code of the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'DATA_COMPLETE', 1: 'DATA_INCOMPLETE'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'up_delivery_code', 'description': 'Delivery code of the corresponding transaction id the UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_delivery_code"
        )
    
    @property
    def Var_up_file_status(self) -> SdkVariable:
        """File status of the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': {'values': {0: 'DISCARDED_DELIBERATELY', 1: 'DISCARDED_FILESTORE_REJECTION', 2: 'FILE_RETAINED', 3: 'FILE_STATUS_UNREPORTED'}, 'defaultValue': None}, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'up_file_status', 'description': 'File status of the corresponding transaction id the UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_file_status"
        )
    
    @property
    def Var_up_file_size(self) -> SdkVariable:
        """Size of the file for the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': {'min': 0, 'max': 9007199254740991, 'defaultValue': 0}, 'stringDefinition': None, 'timeDefinition': None, 'name': 'up_file_size', 'description': 'Size of the file for the corresponding transaction id the UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_file_size"
        )
    
    @property
    def Var_up_src_file_name(self) -> SdkVariable:
        """Name of the source file for the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'up_src_file_name', 'description': 'Name of the source file for the corresponding transaction id the UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_src_file_name"
        )
    
    @property
    def Var_up_dst_file_name(self) -> SdkVariable:
        """Name of the destination file for the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'up_dst_file_name', 'description': 'Name of the destination file for the corresponding transaction id the UPLINK link', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_dst_file_name"
        )
    
    @property
    def Var_up_message_to_user(self) -> SdkVariable:
        """Message to user for the corresponding transaction id the UPLINK link, if the S/C delivers them.."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': None, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': {'defaultValue': ''}, 'timeDefinition': None, 'name': 'up_message_to_user', 'description': 'Message to user for the corresponding transaction id the UPLINK link, if the S/C delivers them.', 'unit': ''}), id_path="testsat_0.gnd.cfdp.up_message_to_user"
        )
    
    @property
    def Var_up_file_progress(self) -> SdkVariable:
        """File progress of the corresponding transaction id the UPLINK link."""
        return SdkVariable(ParameterDefModel.model_validate({'enumDefinition': None, 'floatDefinition': {'min': 0.0, 'max': 100.0, 'defaultValue': 0.0}, 'matrixDefinition': None, 'octetDefinition': None, 'sintDefinition': None, 'stringDefinition': None, 'timeDefinition': None, 'name': 'up_file_progress', 'description': 'File progress of the corresponding transaction id the UPLINK link', 'unit': '%'}), id_path="testsat_0.gnd.cfdp.up_file_progress"
        )
    