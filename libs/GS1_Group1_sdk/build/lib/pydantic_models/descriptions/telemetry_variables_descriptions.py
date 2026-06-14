"""Descriptions of the TM variable attributes."""

tm_id = "ID of the TM variable. This is also the readable path to the variable \
    definition in the asset tree."

timestamp = "The timestamp of this TM data point."

value = "The current value."

validity = "A flag indicating the validity of this value."

version = "The asset version this data is in reference to. See: VersionModel definition"

parent_uuid = "The base-64 encoded unique ID of the parent object of this TM"

name = "The name of the TM variable."

unit = "The unit of this variable. E.g. Ah"

tm_type = "The type of this variable. Consider looking at ParameterType definition"

values = "A list of values in this message. \
    Containing data tuple of [timestamp, value, validity flag]"

header = "A header with strings referring to the entries in the data list."
