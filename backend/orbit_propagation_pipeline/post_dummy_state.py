from datetime import datetime, timezone
from pathlib import Path

from api_connect.satio_session import SatIOSession
from api_connect.telemetry import post_telemetry_data
from dotenv import load_dotenv
from pydantic_models.definitions import VersionModel
from pydantic_models.telemetry_variables import TelemetryVariableModel
from pydantic_models.value_field import MatrixModel, ValueFieldModel


credentials_path = Path(__file__).resolve().parents[2] / "SatOS_credentials" / "credentials.env"
if not load_dotenv(credentials_path):
    raise Exception(f"No .env file found or empty at {credentials_path}")

# Both vectors must refer to exactly the same state epoch.
epoch = datetime.now(tz=timezone.utc)

# Sat1_Group1 version released in SAT.edit.
model_version = VersionModel(
    major=0,
    minor=2,
    patch=0,
)

telemetry = [
    TelemetryVariableModel(
        id="Sat1_Group1.navigation.position_vector",
        timestamp=epoch,
        value=ValueFieldModel(
            matrixValue=MatrixModel(
                rows=1,
                columns=3,
                values=[2_222_222.2, 2_222_222.2, 2_222_222.2],
            )
        ),
        validity=True,
        version=model_version,
    ),
    TelemetryVariableModel(
        id="Sat1_Group1.navigation.velocity_vector",
        timestamp=epoch,
        value=ValueFieldModel(
            matrixValue=MatrixModel(
                rows=1,
                columns=3,
                values=[5_555.5, 5_555.5, 5_555.5],
            )
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
