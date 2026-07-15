# SDK for Sat1_Group1 in version 0.5.0

## Installation
The downloaded SDK is installable using the included pyproject.toml file. To install the SDK, navigate to the root of the SDK and run `pip install`.

```bash
pip install .
```

## Usage
To use the SDK follow the examples in the provided jupyter notebook `sat1_group1_example.ipynb`
Be aware that the included examples do not reflect actual satellite commands and needs to be adapted for your need to run.

### Connection configuration
The satio session can be instantiated in multiple ways. One can either set a config file in the format of:

```json
{
  "loglevel": "DEBUG",
  "keycloak": {
    "server_url": "https://localhost:8443",
    "realm_name": "test",
    "client_id": "library",
    "verify_ssl": true
  },
  "credentials": {
    "username": "<username>",
    "password": "<password>"
  },
  "api_url": "https://localhost:8081"
}
```

or use environment variables to set the configuration. The session will look for the following environment variables:
```bash
API_CONNECT_VERIFY_SOCKET_SSL=false
API_CONNECT_API_URL=https://localhost:8081
API_CONNECT_KEYCLOAK_CLIENT_ID=library
API_CONNECT_KEYCLOAK_REALM=<realm_name>
API_CONNECT_KEYCLOAK_URL=https://localhost:8443
API_CONNECT_API_VERIFY_SSL=false
API_CONNECT_USERNAME=<your_username>
API_CONNECT_PASSWORD=<your_password>
API_CONNECT_TIMEOUT=10
```
