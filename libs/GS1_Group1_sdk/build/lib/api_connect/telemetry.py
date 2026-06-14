from datetime import datetime

from pydantic_models.telemetry_variables import TelemetryResponseModel, TelemetryVariableModel
from requests import Response

from api_connect.satio_session import SatIOSession

prefix = "telemetry"


def get_telemetry_data(
    session: SatIOSession,
    param_address: str,
    start_time: datetime,
    end_time: datetime,
) -> TelemetryResponseModel:
    """
    Get telemetry data from the API

    :param end_time: End datetime to fetch data until
    :param start_time: Start to fetch data from
    :param session: SatIOSession
    :param param_address: parameter address to fetch data for. e.g. Satellite1.ComponentA.Parameter1
    :return: list of TelemetryDataModel
    """

    response = session.get(
        endpoint=f"{prefix}",
        params={"param_address": param_address, "start_time": start_time, "end_time": end_time},
    )
    response.raise_for_status()

    return TelemetryResponseModel.model_validate(response.json())


def post_telemetry_data(session: SatIOSession, telemetry_data: list[TelemetryVariableModel]) -> Response:
    """
    Post telemetry data to the API

    :param session: SatIOSession
    :param telemetry_data: list of TelemetryVariableModel to post
    """

    return session.post(endpoint=prefix, data=[tm.model_dump(mode="json") for tm in telemetry_data])
