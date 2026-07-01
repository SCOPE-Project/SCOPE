"""Descriptions of the command attributes."""

relative_time = "Time delta to an absolute timestamp the relative time is in reference to."

relative_uuid = "The unique id of the command object that holds the absolute time this \
    relative time is in reference to."

absolute_execution_time = "The absolute time when this command will be executed by the asset. \
    Use this field to create a time-tagged command."

absolute_release_time = "The absolute time when this command will be sent by SAT.os."

failed = "A boolean flag indicating if transmission or execution of this command failed."

uuid = "The base-64 encoded unique identifier of this command."

cmd_id = "The identifier of the command within the asset tree. The id can be read as the \
    path to the command. E.g.: Sat_0.payload.switchOn"

name = "The name of the command. E.g. switchOn"

parameters = "A list of the command parameters. \
    Consider the parameter model definition for more details."

relative_execution_info = "An object containing the uuid of another command and a time delta \
    to the execution time of that command. This field is needed to determine the execution \
        time relative to the specified command."

relative_release_info = "An object containing the uuid of another command and a time delta \
    to the release time of that command. This field is needed to determine the release \
        time relative to the specified command."

activity_uuid = "The unique identifier of the activity this command belongs to."

state = "The state of this command. See also the command state object for more details"

rank = "A lexorank string that is used to order the commands in the stack"

version = "The version number of the command definition that was used for command creation \
    The version contains three numbers: major, minor and patch version numbers"
