# Development Setup
## Python Backend Dev Setup
venv setup for python backend development.

**Prerequisite:** Ensure Python (v3.13.1) is installed natively on your Windows machine. You can verify your installation by running `py -0` in your terminal, check that Python 3.13 is included in the list.

Follow these steps in the terminal (Windows)
```bash
cd backend
py -3.13 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
With the inclusion of `.vscode\settings.json`, the python workspace folder and python interpreter should automatically be set in VSCode.

In case this does not work, manually:
- Open VSCode Command Palette: Press `Ctrl + Shift + P`
- Type and select: `Python: Select Interpreter`
- Click: `Enter interpreter path`
- Click: `Find...`
- Navigate to `\backend\.venv\Scripts\python.exe`

### SatOS SDK installation
From SatOS Sat.command, Python SDK's can be downloaded for each asset. This provides a direct asset object to interact with in python.

It is NOT necessary to download SDK's of all assets. Each asset carries information about the underlying SatOS mission. This includes all general SatOS API calls towards https://api.satos-test.irs.uni-stuttgart.de/.

It is only necessary to download and install ONE SDK in order to connect to the SatOS API.
This is reflected by having only one asset folder in `libs\`, which is the only one being installed through requirements.txt.

## React Frontend Dev Setup
npm setup for React/Vite frontend development.

**Prerequisite:** Ensure Node.js (v24.16.0) is installed natively on your Windows machine. You can verify your installation by running `node -v` in your terminal.

Follow these steps in the terminal (Windows):
```bash
cd frontend
npm install
npm run dev
```

The creation of the entire vite/react scaffolding inside `frontend\` was done with the command `npm create vite@latest frontend -- --template react`, creating the `package.json` from template.

# Decision-Making for VLEO Constellation-to-Ground Communication Scheduling for Data Downlink

Decision-Making for VLEO Constellation-to-Ground Communication Scheduling Software for Data Downlink Software

## Problem Definition
In a VLEO Constellation-to-Ground Data Downlink application, the operator faces the problem of assigning mutually exclusive communication links between N single-receiver satellites and M ground stations under the constraints of highly compressed Very Low Earth Orbit (VLEO) overpasses. Because successful transmissions require a strict minimum data payload threshold, the operator must optimize the communications schedule by arbitrating simultaneous connection requests based on expected data yield, temporal starvation, cumulative throughput, and commercial priority.

In a VLEO Constellation-to-Ground (…) application, the operator faces the problem of assigning mutually exclusive communication links between N single-receiver satellites and M ground stations under the constraints of highly compressed Very Low Earth Orbit (VLEO) overpasses. Because successful transmissions require a strict minimum data payload threshold, the operator must optimize the communications schedule by arbitrating simultaneous connection requests based on expected data yield, temporal starvation, cumulative throughput, and commercial priority.


