from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel, VersionModel
from requests import Response

from api_connect.satio_session import SatIOSession

prefix = "satellite"


def get_satellite_list(session: SatIOSession) -> list[SatelliteInfoModel]:
    """
    Get list of satellites from the API

    :param session: SatIOSession

    :return: list[SatelliteInfoModel] list of satellites
    """
    sat_resp = session.get(endpoint=f"{prefix}/list")
    sat_resp.raise_for_status()

    return [SatelliteInfoModel.model_validate(resp) for resp in sat_resp.json()]


def get_satellite(session: SatIOSession, satellite_name: str, version: VersionModel | None = None) -> SatelliteModel:
    """
    Get satellite from the API

    :param session: SatIOSession
    :param satellite_name: Name of the satellite to fetch
    :param version: VersionModel, optional, version of the satellite to fetch

    :return: SatelliteModel
    """

    params = {"satellite_name": satellite_name}

    if version is not None:
        params["version"] = version.to_string()

    sat_resp = session.get(endpoint=prefix, params=params)
    sat_resp.raise_for_status()

    return SatelliteModel.model_validate(sat_resp.json()[0])


def post_satellite(session: SatIOSession, satellite: SatelliteModel) -> Response:
    """
    Post satellite to the API

    :param session: SatIOSession
    :param satellite: SatelliteModel, satellite to post
    """
    return session.post(endpoint=prefix, data=satellite.model_dump(mode="json"))


def delete_satellite(session: SatIOSession, satellite_name: str) -> Response:
    """
    Delete satellite

    :param session: SatIOSession
    :param satellite_name: Name of the satellite to delete
    :return: Response of delete
    """

    return session.delete(endpoint=prefix, params={"satellite_name": satellite_name})
