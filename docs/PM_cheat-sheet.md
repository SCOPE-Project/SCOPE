# Reference Guide: Low-Effort GitHub Projects & Development Workflow

This reference document outlines a lightweight, zero-overhead project management (PM) workflow tailored for university software engineering projects. By mapping PM concepts directly onto native Git and GitHub features, this system maintains absolute traceability (Requirements $\rightarrow$ Code $\rightarrow$ Testing) entirely within your repository infrastructure.

---

## 1. Core Architecture & Tool Mapping

To eliminate administrative overhead, traditional project management entities are translated directly into native GitHub objects.

```
                  ┌─────────────────────────────────────────┐
                  │          GitHub Organization /          │
                  │             Project Board               │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │             Milestones                  │
                  │       (High-level Project Phases)       │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │               Issues                    │
                  │     (Atomic Requirements / Tasks)       │
                  └────────────────────┬────────────────────┘
                                       │
                  ┌────────────────────┴────────────────────┐
                  ▼                                         ▼
      ┌───────────────────────┐                 ┌───────────────────────┐
      │     Code Artifact     │                 │   User Verification   │
      │   (Feature Branch)    │                 │   (PR Test Checklist) │
      └───────────────────────┘                 └───────────────────────┘

```

### Tool Mapping Table

| PM Concept | GitHub Equivalent | Implementation & Purpose |
| --- | --- | --- |
| **Requirement / Epic** | **Milestone** | Groups individual tasks into distinct project phases or deadlines (e.g., `v0.1-Core-Backend`). |
| **Task / User Story** | **Issue** | Represents an atomic unit of work or a single functional requirement. |
| **Progress Tracking** | **Project View (Board)** | A Kanban board displaying active status via columns (`Backlog` $\rightarrow$ `Done`). |
| **Priority / Triage** | **Project View (Priority)** | Alternative table/board view sorted by importance or system impact. |
| **Resource Allocation** | **Project View (Team / My)** | Views filtered by `Assignee` to track individual workloads and tasks. |
| **Timeline / Schedule** | **Project View (Roadmap)** | Gantt-style timeline mapping tasks across time based on target dates. |
| **User Test Case** | **PR Description Template** | Markdown checklists embedded directly into Pull Requests for verification. |

---

## 2. Integrated Development Lifecycle & Board Statuses

The workflow links project management actions directly with Git command-line operations using built-in automation triggers.

### The Project Board View

Your GitHub project uses five specific columns to visualize the current state of development at a single glance:

* **Backlog:** The raw pool of requirements, user stories, or unrefined tasks. Items here haven't been started.
* **Ready:** Prioritized tasks that are fully defined, scoped, and ready for a team member to pick up.
* **In progress:** Active development. Work is being written on a local feature branch.
* **In review:** Code is complete. Pull Request is open, awaiting peer review and manual user test validation.
* **Done:** Merged code that meets all definition-of-done criteria.

### The Standard Issue Lifecycle Flow

```
 [ PROJECT MANAGEMENT ]          [ LOCAL DEVELOPMENT ]           [ CODE REVIEW & QA ]
   GitHub Project Board             Developer Machine               GitHub Pull Request
┌──────────────────────┐         ┌──────────────────────┐        ┌──────────────────────┐
│  Card: "Ready"       │         │                      │        │                      │
└──────────┬───────────┘         └──────────────────────┘        └──────────────────────┘
           │ (Developer assigns  
           │  the card to self)
           ▼
┌──────────────────────┐         ┌──────────────────────┐        ┌──────────────────────┐
│  Card: "In Progress" │ ──────► │ git checkout -b feat │        │                      │
└──────────────────────┘         │ git commit -m "..."  │        │                      │
                                 │ git push origin feat │        │                      │
                                 └──────────┬───────────┘        └──────────────────────┘
                                            │ (Developer opens Pull Request
                                            │  with "Closes #IssueNumber")
                                            ▼
┌──────────────────────┐         ┌──────────────────────┐        ┌──────────────────────┐
│  Card: "In Review"   │ ◄───────────────────────────────────────┤ Run Automated Tests  │
└──────────────────────┘  (Auto-tracked via PR state)            │ Run Manual User Test │
                                                                 └──────────┬───────────┘
                                                                            │ (Maintainer merges PR)
                                                                            ▼
┌──────────────────────┐         ┌──────────────────────┐        ┌──────────────────────┐
│  Card: "Done"        │ ◄───────────────────────────────────────┘ (Issue auto-closes)   │
└──────────────────────┘

```

### Step-by-Step Execution Protocol

#### Phase A: Planning & Setup

1. **Define Milestones:** Create 3–4 Milestones based on your academic delivery schedule.
2. **Populate the Backlog:** Input functional requirements as separate GitHub Issues and link them to the appropriate Milestone.
3. **Connect to Project:** Link issues from your repositories to the Project board by typing `#` and selecting the repository.

#### Phase B: Implementation (The Local Loop)

1. **Pick a Task:** Move an issue from the `Ready` column to `In progress` and assign it to yourself.
2. **Branch Creation:** Open your terminal and create a dedicated feature branch named after the issue identifier:
```bash
git checkout -b feature/issue-<ID>

```


3. **Commit & Push:** Implement changes, commit following clear messages, and push to the remote repository:
```bash
git add .
git commit -m "feat: implement baseline constellation tracking core"
git push origin feature/issue-<ID>

```



#### Phase C: Verification & Closure

1. **Open a Pull Request (PR):** Create a PR to merge your feature branch into `main`.
2. **Automate Tracking:** In the PR description, include the magic keyword:
```markdown
Closes #<Issue-Number>

```


*Action: GitHub automation will instantly transition the project card from `In progress` to `In review`.*
3. **Code Review & User Testing:** Fill out the verification log inside the PR (see Section 5). Once approved and merged, GitHub automatically closes the issue and advances the project card to `Done`.

---

## 3. GitHub Native Automation Workflows

By leveraging the built-in automation rules engine (accessed via the **Workflows** button on your board), you eliminate manual card shifting:

1. **Item Added to Project:** Automatically sets the status of any newly linked repository issue to `Backlog`.
2. **Pull Request Opened:** When a developer submits a PR linked to an issue, the issue's project card automatically bypasses manual adjustment and jumps directly to `In review`.
3. **Pull Request Merged:** When the PR is merged into `main`, GitHub automatically changes the card status to `Done` and marks the underlying issue as closed.

---

## 4. Documentation Architecture (Docs-as-Code)

To comply with academic documentation requirements without creating external paperwork overhead, all documentation must live within the repository.

### Repository Layout

```text
repo-root/
│
├── .github/
│   ├── ISSUE_TEMPLATE/       # Standard templates for bug reports/features
│   └── PULL_REQUEST_TEMPLATE.md # Automated template containing user test logs
│
├── docs/                     # Technical & Architecture Documentation
│   ├── architecture.md       # System design diagrams and math models
│   ├── installation.md       # Environment setup and dependencies
│   └── user_guide.md         # Deployment and usage instructions
│
├── src/                      # Source Code with inline docstrings
│
└── README.md                 # Project executive summary and entry point

```

### Documentation Layers

* **System Specs & Architecture (`/docs`):** Written in Markdown. Technical changes and their corresponding documentation updates should occur within the exact same PR.
* **Inline Documentation:** Source files utilize strict language-standard docstrings to describe function behaviors, inputs, and outputs.
* **Requirements & Audit Trail:** The GitHub Issue description defines the requirement. The merged Pull Request forms an immutable, chronological log proving the requirement was built, reviewed, and verified.

---

## 5. User Testing & Verification Protocol

A Pull Request cannot be merged into `main` until a manual user test verification log is appended to the PR description. This replaces detached test reporting documents.

### Pull Request Description Markdown Template

```markdown
## Associated Work
Closes #<Issue-Number>

## Description of Changes
- Implemented specific mathematical transformations or functional components.
- Updated documentation inside the `/docs` directory.

## User Test Verification Log
- [ ] **Test Case ID:** UT-<Issue-Number>.<Sub-ID>
- [ ] **Tester:** [Name of team member or external validator]
- [ ] **Environment:** Local build, Python 3.13 / [Specify OS]
- [ ] **Preconditions:** System state initialization details.
- [ ] **Execution Steps:**
  1. Initialize component X.
  2. Provide dataset input Y.
  3. Execute processing loop.
- [ ] **Expected Result:** Output precisely matches specification Z.
- [ ] **Actual Result:** PASS / FAIL (Include relevant terminal log or screenshot if FAIL)

```

---

## 6. Team Governance & Operation Rules

1. **The Board is Truth:** If a task is not registered as an Issue, it does not exist. If progress changes, the card must be moved instantly.
2. **Asynchronous Sign-off:** Code reviews serve as the project management checkpoint. Approving a PR means you validate the code quality, verify that documentation is updated, and confirm that the user test passed.
3. **No Stale Branches:** Delete feature branches immediately after merging to maintain repository hygiene.