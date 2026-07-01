"""Descriptions of the activity attributes."""

auto_scheduled = "This parameter is used to indicate if the activity was scheduled automatically, \
    which can affect the way the activity is handled or displays."

description = "The description field can be used to communicate the purpose of the activity."

uuid = "A unique identifier of the activity instance."

initiator = "The initiator is a reference to the entity that creates the activity. \
    This can be the username or the name of a registered agent that created the activity."

priority = "This value indicates the priority of the activity. \
    The higher the value, the more the activity will be prioritized in case of a conflict."

schedule_name = "The name of the schedule where the activity is stored. \
    The schedule name is equal to the name of the scheduled asset: e.g. testsat_0"

commands = "The list of commands that will be executed during the activity."

status = "The status indicates whether the activity is currently being processed. \
    New activities should be suspended (status=2), and resumed after approval (status=1)."

stage = "The stage indicates how much the activity has been processed. \
    It starts at REQUESTED (stage=1) and ends at VERIFIED (stage=7)"

executor = "This field currently is not used. A reference to the executing entity."

start_event = "The relation to the startEvent marker is used to set the start time of the activity."

end_event = "The relation to the endEvent marker is used to set the end time of the activity."

parent_activity_uuid = "A reference to the parent of this activity."

child_activities = "A list of child activities this activity contains."

name = "The name of the activity, which is used when the activity is displayed."

start_event_uuid = "A reference to the marker that determines the start of this activity"

end_event_uuid = "A reference to the marker that determines the end of this activity"

start_event_timedelta = "The time offset between the start marker and the begin of this activity"

end_event_timedelta = "The time offset between the end of this activity and the end marker"
