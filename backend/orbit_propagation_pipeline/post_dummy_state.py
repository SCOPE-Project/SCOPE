from datetime import datetime, timezone

from api_connect.satio_session import SatIOSession
from api_connect.telemetry import post_telemetry_data
from pydantic_models.definitions import VersionModel
from pydantic_models.telemetry_variables import TelemetryVariableModel
from pydantic_models.value_field import ValueFieldModel


# Both vectors must refer to exactly the same state epoch.
epoch = datetime.now(tz=timezone.utc)

# Replace this with the version you released in SAT.edit.
model_version = VersionModel(
    major=0,
    minor=1,
    patch=1,
)

telemetry = [
    TelemetryVariableModel(
        id="Sat1_Group1.navigation.position_vector",
        timestamp=epoch,
        value=ValueFieldModel(
            matrixValue=[
                [4_215_783.2, 3_864_211.7, 3_521_987.4]
            ]
        ),
        validity=True,
        version=model_version,
    ),
    TelemetryVariableModel(
        id="Sat1_Group1.navigation.velocity_vector",
        timestamp=epoch,
        value=ValueFieldModel(
            matrixValue=[
                [-5_214.3, 3_842.6, 4_211.8]
            ]
        ),
        validity=True,
        version=model_version,
    ),
]

with SatIOSession():
    post_telemetry_data(
        session=SatIOSession.get_session(),
        telemetry_data=telemetry,
    )

print(f"Dummy state posted with epoch {epoch.isoformat()}")