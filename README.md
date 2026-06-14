# Development Setup
venv setup for python backend development.
Follow these steps in the terminal (Windows)
```bash
cd backend
py -3.13 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
VSCode needs to know about this venv, as it usually scans for .venv on project root level
- Open VSCode Command Palette: Press `Ctrl + Shift + P`
- Type and select: `Python: Select Interpreter`
- Click: `Enter interpreter path`
- Click: `Find...`
- Navigate to `\backend\.venv\Scripts\python.exe`


# Decision-Making for VLEO Constellation-to-Ground Communication Scheduling for Data Downlink

Decision-Making for VLEO Constellation-to-Ground Communication Scheduling Software for Data Downlink Software

## Problem Definition
In a VLEO Constellation-to-Ground Data Downlink application, the operator faces the problem of assigning mutually exclusive communication links between N single-receiver satellites and M ground stations under the constraints of highly compressed Very Low Earth Orbit (VLEO) overpasses. Because successful transmissions require a strict minimum data payload threshold, the operator must optimize the communications schedule by arbitrating simultaneous connection requests based on expected data yield, temporal starvation, cumulative throughput, and commercial priority.

In a VLEO Constellation-to-Ground (…) application, the operator faces the problem of assigning mutually exclusive communication links between N single-receiver satellites and M ground stations under the constraints of highly compressed Very Low Earth Orbit (VLEO) overpasses. Because successful transmissions require a strict minimum data payload threshold, the operator must optimize the communications schedule by arbitrating simultaneous connection requests based on expected data yield, temporal starvation, cumulative throughput, and commercial priority.


