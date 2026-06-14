## Architectural Statement: SatOS Communications Scheduling Integration Prototype (Localized Decoupled Milestone)

**Scope:** Local Python Backend AND Local React Web-Server Frontend 

### **1. System Overview**

The Communications Scheduling application operates as a <u>standalone, decoupled Client-Server desktop application</u> prototyping environment interfacing with the broader SatOS ecosystem. The architecture follows a synchronous REST pattern. The application consists of a local web-based React User Interface (UI) and a distinct backend service that interfaces with the central SatOS HTTPS API for telemetry retrieval and VLEO communication schedule activity injection, operating completely independent of the existing SatOS frontend shell.

### **2. Component Architecture & Integration**

The system is partitioned into two distinct execution environments executing on the operator's local workstation:

- **Frontend (UI):** A decoupled React-based web client. It executes entirely client-side within the operator's browser (e.g., `http://localhost:5173`) and acts purely as an <u>unauthenticated visualization and interaction layer</u>.
- **Backend (Processing Logic):** A stateless Python 3.13 REST API. This service runs locally (e.g., on `http://localhost:8000` via VSCode) and utilizes the `api_connect.satio_session.SatIOSession` SDK to autonomously proxy communications to the SatOS API.

### **3. Data Flow & Synchronization Strategy**

The system utilizes explicit, synchronous HTTP requests locally, while relying on the SatOS Python SDK for remote synchronization.

- **Trigger:** The operator initiates an action via the local React frontend.
- **Pull:** The frontend issues an unauthenticated HTTP `GET` request to the Python backend. The backend utilizes the `SatIOSession` SDK to synchronously query the SatOS HTTPS API, retrieving current orbital telemetry and the existing activity schedule.
- **Process & Visualize:** The Python backend computes the required communication scheduling parameters, constructs data objects, and returns the payload to the local frontend for timeline visualization.
- **Push:** Upon operator confirmation, the frontend issues an HTTP `POST` request to the Python backend. The backend formats the activity data objects and pushes the scheduled commands to the SatOS API via the SDK. The final operational schedule is viewable within the central `SAT.plan` web application.

### **4. Authentication & Security (Localized Operator Context)**

The milestone relies on personal operator credentials executing locally, bypassing React frontend Keycloak integration entirely.

- **Credential Management:** The Python backend requires the operator's personal Keycloak credentials (`API_CONNECT_USERNAME`, `API_CONNECT_PASSWORD`). These are strictly loaded from an unversioned `.env` file located on the local machine. Alternatively, a json Configuration File can be utilized. [SatOS Documentation](https://usermanual.satos-test.irs.uni-stuttgart.de/How-Tos/Scripting/#creating-a-session)
- **Token Acquisition:** The `SatIOSession` SDK automatically transmits the local credentials to the SatOS Keycloak IdP, acquiring a short-lived Bearer Token.
- **Authorization Chain:** The local React frontend holds no tokens and bypasses all SatOS security perimeters. The Python SDK transparently attaches the active Bearer Token to all outbound requests to the SatOS API, auditing all actions under the individual operator's identity.

### **5. Network Topology & Development Environment**

The prototype operates locally while interfacing securely with the restricted internal SatOS network.

- **Transport:** A VPN tunnel provides the local development machine direct routing to the internal SatOS HTTPS API and Keycloak subnets.
- **DNS Resolution:** Local configurations (via DNS routing or static hosts file mapping) must resolve the internal SatOS domain names over the VPN.
- **CORS Configuration:** Because the React UI executes on `http://localhost:5173` and requests data from the local Python development server at `http://localhost:8000`, the Python backend must implement Cross-Origin Resource Sharing (CORS) middleware. It must explicitly permit the `localhost:5173` origin and requisite HTTP methods (`GET`, `POST`, `OPTIONS`).


### 6. Alternative Architecture Options and Rejection Rationale

Prior to locking in the localized topology, alternative architectural patterns were evaluated. They were rejected due to strict conflicts with security policies, SDK mechanics, or scope constraints.

| **Architecture Option**          | **Proposed Mechanism**                                                                                            | **System Implications**                                                                                              | **Primary Rejection Rationale**                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Injected UI (Micro-Frontend)** | Embed React UI directly into the SatOS frontend shell (e.g., via `iframe`).                                       | Requires parent-child session synchronization and complex CORS/Frame-Ancestor header modifications by SatOS.         | **SDK Conflict:** The Python SDK requires raw credentials. An injected UI only possesses a Bearer Token, breaking the authentication chain unless the SDK is rewritten or bot accounts are used. |
| **Service Account (M2M)**        | Python backend authenticates autonomously using generic "bot" credentials.                                        | Eliminates the need for frontend token handling. All scheduled activities are audited under a single system account. | **Policy Conflict:** System utilization requires personal Operator Keycloak accounts for execution. Generic bot accounts are not authorized for this scope.                                      |
| **Centralized Token Forwarding** | Centralized web deployment. React UI handles OAuth redirect, acquires JWT, and forwards it to the Python backend. | Ensures user-level auditing without storing local credentials. Requires complex OAuth integration in React.          | **SDK Constraint:** The `SatIOSession` SDK explicitly requires raw environment variables (`USERNAME`/`PASSWORD`). Initializing the SDK with a pre-existing forwarded JWT is unsupported.         |
