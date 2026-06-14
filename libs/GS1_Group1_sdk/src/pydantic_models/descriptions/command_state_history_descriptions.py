"""Descriptions of the command state history attributes."""

uuid = "A unique identifier of the command state history object"

state = "The state of the command. The command state indicates the progress of the command \
    see: CommandState model!"

timestamp = "A timestamp telling when the specified state was reached"

failed = "A flag indicating if the command has failed"

command_uuid = "A unique identifier of the command this state is in reference to."

parameter_1 = "Parameter 1, can be user defined."

parameter_2 = "Parameter 2, can be user defined."

reason = "A description of the reason of a potential command failure"
