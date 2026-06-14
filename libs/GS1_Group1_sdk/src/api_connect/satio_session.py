import contextvars
import json
import logging
import os
from collections.abc import Callable
from pathlib import Path

import requests
import socketio
from keycloak import KeycloakOpenID
from pydantic import UUID4, UUID7
from libs.GS1_Group1_sdk.src.pydantic_models.command import CommandModel
from socketio import Client

current_session = contextvars.ContextVar("current_session")

_logger = logging.getLogger(__name__)


class SatIOSession:
    """Session object to connect to the SAT.IO API."""

    def __init__(self, settings_file: Path | None = None):  # noqa PLR0915
        """Session object to connect to the SAT.IO API.

        :param settings_file: Path object to configure the session.
           example:
           {
             "loglevel": "DEBUG",
             "keycloak": {
               "server_url": "https://localhost:8443",
               "realm_name": "test",
               "client_id": "library",
               "verify_ssl": true,
               "credentials": {
                    "username": "<username>",
                    "password": "<password>"
                }
             },
             "api":{
                "url": "https://localhost:8081"
             }
           }
        :param read_timeout: connection timeout in seconds
            to wait for response before raising requests.exceptions.ReadTimeout
        """

        # read config
        if settings_file is None:
            config = None
        else:
            with open(settings_file) as file:
                config = json.load(file)

        # Get API URL
        try:
            self._api_url = config["api"]["url"]
        except (KeyError, TypeError):
            self._api_url = os.environ["API_CONNECT_API_URL"]

        if not self._api_url.endswith("/"):
            self._api_url += "/"

        # Get Keycloak / User settings
        try:
            client_id = config["keycloak"]["client_id"]
        except (KeyError, TypeError):
            client_id = os.getenv("API_CONNECT_KEYCLOAK_CLIENT_ID", "library")

        try:
            realm_name = config["keycloak"]["realm_name"]
        except (KeyError, TypeError):
            realm_name = os.environ["API_CONNECT_KEYCLOAK_REALM"]

        try:
            server_url = config["keycloak"]["server_url"]
        except (KeyError, TypeError):
            server_url = os.getenv("API_CONNECT_KEYCLOAK_URL", f"https://keycloak.{realm_name}.satio.space")

        try:
            self.verify_ssl = config["keycloak"]["verify_ssl"] not in ["False", "false", False]
        except (KeyError, TypeError):
            self.verify_ssl = os.getenv("API_CONNECT_API_VERIFY_SSL", "True") not in ["False", "false"]

        try:
            self.username = config["keycloak"]["credentials"]["username"]
        except (KeyError, TypeError):
            self.username = os.environ["API_CONNECT_USERNAME"]

        try:
            password = config["keycloak"]["credentials"]["password"]
        except (KeyError, TypeError):
            password = os.environ["API_CONNECT_PASSWORD"]

        self._timeout = int(os.getenv("API_CONNECT_TIMEOUT", default="30"))

        self._keycloak_openid = KeycloakOpenID(
            server_url=server_url, client_id=client_id, realm_name=realm_name, verify=self.verify_ssl
        )

        self._token = self._keycloak_openid.token(self.username, password)

        if self._token.get("access_token") is None:
            raise ConnectionError("Cannot fetch token")

        self.__enter__()  # we need to call this here to make the session usable without 'with' context

        verify_socket_ssl = os.environ.get("API_CONNECT_VERIFY_SOCKET_SSL", "True") not in ["False", "false"]
        self.__callbacks: dict = {}

        self.__sio: Client = socketio.Client(ssl_verify=verify_socket_ssl)

        self.__sio.connect(
            url=self._api_url,
            auth={"token": self.token["access_token"]},
            wait_timeout=self._timeout,
            transports=["websocket"],
        )

        @self.__sio.on("*")
        def __catch_all(event: str, data: list | dict) -> None:
            if not isinstance(data, list):
                data = [data]

            if event == "Command":
                for d in data:
                    method = d["method"]
                    for command in d["commands"]:
                        cmd = CommandModel.model_validate(command)
                        function = self.__callbacks.get(cmd.uuid)
                        if function is not None:
                            remove_callback = function(cmd)
                            if remove_callback or method == "DELETE":
                                self.__callbacks.pop(cmd.uuid, None)

    def __enter__(self):
        """Enter the context manager."""
        self._session = current_session.set(self)
        return self

    def __exit__(self, *args: object, **kwargs: dict):
        """Exit the context manager."""
        if len(self.__callbacks) > 0:
            _logger.debug(f"Killing {len(self.__callbacks)} callbacks: {self.__callbacks.keys()}")
            self.__callbacks = {}
        self._keycloak_openid.logout(self._token["refresh_token"])
        self.__sio.disconnect()
        current_session.reset(self._session)

    def close(self) -> None:
        """Close the session."""
        self.__exit__()

    @staticmethod
    def get_session() -> "SatIOSession":
        """Get the current session."""
        try:
            return current_session.get()
        except LookupError as e:
            raise LookupError("No session found. Please create a session context first.") from e

    @property
    def api_url(self) -> str:
        """Get the API URL."""
        return self._api_url

    @property
    def token(self) -> dict:
        """Get the token."""
        return self._token

    def get_access_token(self) -> str:
        """Get the access token."""
        return self._token["access_token"]

    def get_username(self) -> str:
        """Get the username."""
        return self.username

    def get(self, endpoint: str, params: dict | None = None) -> requests.Response:
        """Send a GET request to the API.

        :param endpoint: The endpoint to send the request to.
        :param params: The parameters to send with the request.

        :returns: The response from the API.
        """
        return requests.get(
            url=f"{self._api_url}{endpoint}",
            params=params,
            headers={"Authorization": f"Bearer {self.get_access_token()}"},
            timeout=self._timeout,
            verify=self.verify_ssl,
        )

    def post(self, endpoint: str, data: dict | list[dict]) -> requests.Response:
        """Send a POST request to the API.

        :param endpoint: The endpoint to send the request to.
        :param data: The data to send with the request.

        :returns: The response from the API.
        """
        return requests.post(
            url=f"{self._api_url}{endpoint}",
            json=data,
            headers={"Authorization": f"Bearer {self.get_access_token()}"},
            timeout=self._timeout,
            verify=self.verify_ssl,
        )

    def put(self, endpoint: str, data: dict | list[dict]) -> requests.Response:
        """Send a PUT request to the API.

        :param endpoint: The endpoint to send the request to.
        :param data: The data to send with the request.

        :returns: The response from the API.
        """
        return requests.put(
            url=f"{self._api_url}{endpoint}",
            json=data,
            headers={"Authorization": f"Bearer {self.get_access_token()}"},
            timeout=self._timeout,
            verify=self.verify_ssl,
        )

    def delete(
        self, endpoint: str, params: dict | None = None, data: list[UUID4] | list[UUID7] | None = None
    ) -> requests.Response:
        """Send a DELETE request to the API.

        :param endpoint: The endpoint to send the request to.
        :param params: The parameters to send with the request.
        :param data: The data to send with the request. This is needed for UUID object deletes.
        :returns: The response from the API.
        """
        if params and data:
            raise ValueError("Either params or data can be provided, not both.")
        if params:
            return requests.delete(
                url=f"{self._api_url}{endpoint}",
                params=params,
                headers={"Authorization": f"Bearer {self.get_access_token()}"},
                timeout=self._timeout,
                verify=self.verify_ssl,
            )
        if data:
            return requests.delete(
                url=f"{self._api_url}{endpoint}",
                json=data,
                headers={"Authorization": f"Bearer {self.get_access_token()}"},
                timeout=self._timeout,
                verify=self.verify_ssl,
            )
        raise ValueError("Either params or data must be provided.")

    def attach_socket_callback(self, for_object: UUID4 | UUID7, callback_function: Callable) -> None:
        """
        Attach a callback function for an object by its UUID4

        :param for_object: The uuid4 of the object to attach a callback to
        :param callback_function: the function to execute when the uuid was received.
                Make sure the function returns true to de-subscribe it from the socket.
                Otherwise, it will listen forever for changes of this object.
                The function will be called with the object identified by the UUID.

                e.g.
                def callback(cmd: CommandModel) -> bool:
                    print(f"Callback triggered for command {cmd.uuid}")
                    return True

                attach_socket_callback(for_object=cmd.uuid, callback_function=callback)
        """
        self.__callbacks.update({for_object: callback_function})
