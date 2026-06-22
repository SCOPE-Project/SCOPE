# Reference Guide: Path-Filtered Continuous Integration for Monorepos

This document details the **Decoupled Monorepo CI Strategy** engineered for our VLEO Communication Scheduling prototype. It implements isolated change detection, build verification, and standard test automation runners structured directly to reflect our folder ecosystem.

---

## 1. Strategy Overview: The Multi-Runner Workflow

Because our repository houses both the Python FastAPI backend and the React Node.js frontend, this pipeline employs a **Decoupled Monorepo Workflow**. This eliminates pipeline fatigue: pushing a frontend stylesheet change will not trigger heavy backend virtual environment processing, and modifying an orbit calculation rule will not initiate a frontend TypeScript production build.

```
                          ┌── PULL REQUEST / MERGE ──┐
                          │                          │
              [ Modified inside /backend ]    [ Modified inside /frontend ]
                          │                          │
                          ▼                          ▼
                 ┌─────────────────┐        ┌──────────────────┐
                 │ Backend Runner  │        │ Frontend Runner  │
                 ├─────────────────┤        ├──────────────────┤
                 │ • Setup Python  │        │ • Setup Node.js  │
                 │ • Install .venv │        │ • npm ci install │
                 │ • Syntax Check  │        │ • Production compilation
                 │ • pytest runs   │        │ • vitest/jest    │
                 └─────────────────┘        └──────────────────┘

```

By separating concerns at the runner tier, external reviewers or prospective users can verify instantly that instructions remain functional on clean, isolated hardware.

---

## 2. GitHub Actions Structural YAML Blocks

Create individual workflow declaration manifests inside your workspace directory at `.github/workflows/`. These utilize precise path filtering alongside dynamic language layout file readers.

### Block A: Python Backend Pipeline (`.github/workflows/backend-ci.yml`)

```yaml
name: Backend Continuous Integration

on:
  pull_request:
    branches: [ main ]
    paths:
      - 'backend/**'
      - 'libs/**'
      - '.github/workflows/backend-ci.yml'

jobs:
  backend-verification:
    name: Build & Test Python Backend
    runs-on: ubuntu-latest

    steps:
    - name: Checkout Source Code
      uses: actions/checkout@v4

    - name: Set up Python Environment from Config
      uses: actions/setup-python@v5
      with:
        # Dynamically extracts your team's exact local runtime version anchor
        python-version-file: 'backend/.python-version'

    - name: Cache Virtual Environment Dependencies
      uses: actions/cache@v4
      with:
        path: ~/.cache/pip
        key: ${{ runner.os }}-pip-${{ hashFiles('backend/requirements.txt') }}
        restore-keys: |
          ${{ runner.os }}-pip-

    - name: Install Application Dependencies
      run: |
        python -m pip install --upgrade pip
        if [ -f backend/requirements.txt ]; then pip install -r backend/requirements.txt; fi

    - name: Environment & Syntax Verification (Smoke Test)
      run: |
        # Evaluates syntax correctness across Python files to intercept import/compilation bugs
        python -m compileall backend/

    - name: Execute Automated Unit Testing
      # Runs pytest once test files are seeded across rule validation or overpass parsing hooks
      run: |
        cd backend
        pytest

```

### Block B: Frontend React Pipeline (`.github/workflows/frontend-ci.yml`)

```yaml
name: Frontend Continuous Integration

on:
  pull_request:
    branches: [ main ]
    paths:
      - 'frontend/**'
      - 'libs/**'
      - '.github/workflows/frontend-ci.yml'

jobs:
  frontend-verification:
    name: Build & Test React UI
    runs-on: ubuntu-latest

    steps:
    - name: Checkout Source Code
      uses: actions/checkout@v4

    - name: Set up Node.js Environment from Config
      uses: actions/setup-node@v4
      with:
        # Dynamically extracts version matching your local engine definitions
        node-version-file: 'frontend/.node-version'
        cache: 'npm'
        cache-dependency-path: 'frontend/package-lock.json'

    - name: Deterministic Dependency Installation
      # npm ci acts as an immutable blueprint, failing if deviations occur from your lock graph
      run: |
        cd frontend
        npm ci

    - name: Build and Compile Production Assets
      # Validates full TypeScript type safety and bundler compilation constraints
      run: |
        cd frontend
        npm run build

    - name: Execute Automated Unit Testing
      # Connects UI element testing, dashboard timeline states, or data handlers
      run: |
        cd frontend
        npm run test:run # maps to vitest run or jest --watchAll=false

```

---

## 3. CI Operational Checklist

To protect development stability, ensure these stages function properly across your monorepo configuration:

1. 
**Path-Filtered Trigger Rules:** * **Backend Job:** Launches explicitly when code changes are introduced inside `/backend/` or shared asset matrices in `/libs/`.


* 
**Frontend Job:** Launches explicitly when code changes are introduced inside `/frontend/` or shared asset matrices in `/libs/`.


* 
**Global Skips:** Changes limited purely to global project management documentation files (like `/docs/` or root `.md` files) are configured to bypass asset-heavy code runners to maximize velocity.




2. 
**Build and Environment Cleanliness ("The Smoke Test"):** The system enforces strict isolation parameters on standard Ubuntu runners. By verifying code compilation status and virtual space mapping (`.venv` or `npm ci`) autonomously, it provides an engineering guarantee that initialization guides are correct and complete.


3. **Automated Verification Harness:** The frameworks tie directly into our testing blueprints as they scale up:
* 
**Backend (`pytest`):** Targets our core mathematical overpass extraction routines, conflict identification rules, and priority cascade score trees.


* 
**Frontend (`Vitest`/`Jest`):** Directs assertions to assess our reactive timeline states, panel views, and validation history logs.





---

## 4. Branch Governance & Status Gates

To keep repository interactions clean, configure the following setting layers natively inside GitHub Repository Settings:

* 
**Lock the `main` Branch:** Establish strict Branch Protection Rules. Push operations straight to `main` are restricted. Code increments must transition systematically through a feature branch loop via an open Pull Request.


* 
**Enforce Successful Status Checks:** Require status checks to pass before merging. The native GitHub `Merge` button remains explicitly grayed out until both the environment compilation smoke tests and testing suites output a clean status. This ensures that broken development increments can never degrade master code layer stability.