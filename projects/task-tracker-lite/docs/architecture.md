# Architecture Design — Task Tracker Lite

Status: Draft for human review
SRS baseline: 1241fab715aa8833b08349246ce6b75784c14ac80ae833ccaee23fb1c1d9ce93
SRS commit: `6f9ff4732c1f31853bcffb7ce1b5b2c7ccd8005b` (PR #9, recorded in PR #10)
TOR baseline: TOR-001 (frozen), sha256 `beb37f537522d1a1b1407e0928158556b639e476a8cc4805ef7bb348d5ff1be5`

# Introduction

This document describes the architecture for Task Tracker Lite. It elaborates the approved SRS and does not replace the frozen TOR or the SRS. Where they differ, the TOR wins, then the SRS and its approved elaborations (EL-001, EL-002, EL-003, EL-005, EL-006), then this document.

Per EL-006 this is a prototype whose purpose is to validate the Software Factory end to end. It is not a production system. Every choice below is the simplest one that satisfies the SRS. The product is a single web application with one server process, one data store, and one team that, for now, has one pre-created account (A-002). The data model is still team-based, so a second member can be added without changing existing tasks (FR-015).

# Constraints

- Internal team use only. No task information is reachable without signing in as a team member (TOR 5.1, NFR-001).
- Browser-based interface only. No native or mobile application (TOR 5.1, NFR-002).
- No third-party project-management integrations, payment processing, or advanced analytics (TOR 3.2).
- No public or self-service registration. Accounts are created only by an operator (FR-013, EL-005).
- One team only (FR-014). One role only: every member has the same permissions over every task (FR-012).
- No task deletion and no task fields beyond title, description, status, and assignee (SRS 2.3).
- No capacity, performance, or availability targets (A-003). None are added here.
- No vendor, framework, language, or host is prescribed. These are deferred (see Decisions and deferrals).

# Components

The application is deployed as one unit. The components below are logical parts of that unit, not separate services.

### C-001

**Web UI.** Server-rendered or browser-rendered pages, usable in a standard web browser, for: sign-in, sign-out, task list, task detail, create task, edit title and description, set or clear assignee, change status. The status control offers exactly the three defined statuses. The assignee control offers "unassigned" or exactly one team member. No registration page exists.

Source: FR-017, NFR-002, FR-008, FR-009

### C-002

**Authentication and session.** Verifies a team member's credentials against the account store, issues a session, records the signed-in member's identity on the session, and ends it on sign-out. Every request other than the sign-in page and sign-in submission is rejected or redirected to sign-in when there is no valid session. Credentials are stored only as salted password hashes.

Source: FR-010, FR-011, NFR-001

### C-003

**Task service.** Application logic for creating, listing, viewing, editing, assigning, and changing the status of tasks. It enforces:
- new tasks start as `To Do` (FR-002);
- status is one of `To Do`, `In Progress`, `Done`, and any status can move to either other one (FR-003, FR-004);
- the assignee is empty or exactly one member of the same team (FR-005, FR-006);
- every authenticated member may perform every operation on every task; there are no role or per-task checks (FR-012).

Source: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-012

### C-004

**Team and member directory.** Read-only access, inside the application, to the single team and its members. It supplies the list of assignable members (all members of the team) and resolves the signed-in member's team.

Source: FR-014, FR-005

### C-005

**Account provisioning (operator tool).** A command-line or seed step, run by an operator outside the web interface, that creates the team (once) and adds a member account to it. For the prototype it creates the one pre-created account. Running it again adds another member without touching existing tasks. It is not reachable through the web interface, so there is no registration path.

Source: FR-013, FR-015

### C-006

**Persistent store.** One durable data store holding teams, members, and tasks. Data survives sign-out, new sessions, and application restarts.

Source: FR-016

# Interfaces

All web interfaces are served by the one application process. Every route except `GET /login` and `POST /login` requires a valid session (C-002).

| Interface | Purpose | Components | SRS |
|---|---|---|---|
| `GET /login`, `POST /login` | Show sign-in form; verify credentials; start session | C-001, C-002 | FR-010, FR-011 |
| `POST /logout` | End session | C-001, C-002 | FR-011 |
| `GET /tasks` | List all tasks with title, status, assignee or "unassigned" | C-001, C-003 | FR-008 |
| `GET /tasks/new`, `POST /tasks` | Create a task with title and description; status `To Do`; no assignee | C-001, C-003 | FR-001, FR-002, FR-005 |
| `GET /tasks/{id}` | Show one task's title, description, status, assignee | C-001, C-003 | FR-009 |
| `POST /tasks/{id}` (edit) | Change title and description | C-001, C-003 | FR-007 |
| `POST /tasks/{id}/status` | Set status to one of the three values | C-001, C-003 | FR-003, FR-004 |
| `POST /tasks/{id}/assignee` | Set assignee to a team member, or clear it | C-001, C-003, C-004 | FR-005, FR-006 |
| Operator command `add-member` | Create the team if absent; add a member account | C-005, C-006 | FR-013, FR-015 |
| Store access | Read and write teams, members, tasks | C-003, C-004, C-002 → C-006 | FR-016 |

The route paths are illustrative. The implementation may rename them as long as each interface's behavior is kept. Requests that change data validate input on the server: title is required, status must be one of the three values, and an assignee must be a member of the team. Invalid input is rejected and nothing is changed.

# Data

Three entities. The team entity exists even though there is only one team, so that the model stays team-based (FR-014, FR-015).

**Team**
- `id` — identifier
- `name` — text

**Member**
- `id` — identifier
- `team_id` — references Team; required
- `username` — unique; used to sign in
- `display_name` — text shown as assignee
- `password_hash` — salted hash; the plain password is never stored

**Task**
- `id` — identifier
- `team_id` — references Team; required
- `title` — text; required
- `description` — text; may be empty
- `status` — one of `To Do`, `In Progress`, `Done`; default `To Do`
- `assignee_id` — references Member; nullable; when set, the member's `team_id` equals the task's `team_id`

Rules:
- No fields beyond these on Task (SRS 2.3). No delete operation.
- Adding a Member inserts one row and changes no Task row (FR-015).
- Sessions hold only the signed-in member's `id`. Whether they are kept in the store or in memory is an implementation choice; losing sessions on restart is acceptable, losing task data is not (FR-016).

Initial data for the prototype: one Team and one Member (the requester), created by C-005 (A-002).

# Decisions and deferrals

Decisions in this design (model suggestions for the reviewer to accept or change):

- D-001: One deployable web application with one data store. No separate services, queues, or caches. Reason: EL-006 simplest option.
- D-002: Accounts are provisioned by an operator command (C-005), not through the web interface. Reason: FR-013 forbids registration; A-002 leaves the mechanism to design.
- D-003: Username and password sign-in with salted password hashes and a session cookie. Reason: simplest way to meet FR-010 and FR-011 without external identity providers.
- D-004: Team is a stored entity referenced by Member and Task, even with one team. Reason: user request and FR-014, FR-015.
- D-005: No authorization rules beyond "signed in as a member of the team". Reason: FR-012.

Deferred to implementation (not chosen here, per the guidelines and SRS 1.3):

- Programming language, web framework, and UI rendering approach.
- Data store product (any durable store that survives restarts satisfies FR-016; an embedded file-based database is sufficient for the prototype).
- Hosting environment and deployment method (A-001).
- Password hashing algorithm and session storage, within D-003.
- Transport security configuration for the chosen host.

Not included, by exclusion in the TOR or SRS: access for anyone outside the team, payment processing, third-party project-management integrations, advanced analytics, mobile-native applications, self-service registration, multiple teams, administrator roles, task deletion, multiple assignees, and extra task fields.

# Traceability

| SRS item | Components | Interfaces | Acceptance |
|---|---|---|---|
| FR-001 | C-001, C-003 | `POST /tasks` | AC-001 |
| FR-002 | C-003 | `POST /tasks` | AC-001 |
| FR-003 | C-003, C-001 | `POST /tasks/{id}/status` | AC-002 |
| FR-004 | C-003 | `POST /tasks/{id}/status` | AC-002 |
| FR-005 | C-003, C-004 | `POST /tasks`, `POST /tasks/{id}/assignee` | AC-001, AC-003 |
| FR-006 | C-003, C-004 | `POST /tasks/{id}/assignee` | AC-003 |
| FR-007 | C-001, C-003 | `POST /tasks/{id}` | AC-004 |
| FR-008 | C-001, C-003 | `GET /tasks` | AC-001 |
| FR-009 | C-001, C-003 | `GET /tasks/{id}` | AC-004 |
| FR-010 | C-002 | all routes except sign-in | AC-005 |
| FR-011 | C-002 | `POST /login`, `POST /logout` | AC-006 |
| FR-012 | C-003 | all task routes | AC-006 |
| FR-013 | C-005, C-001 | operator `add-member`; no registration route | AC-005 |
| FR-014 | C-004, C-006 | `POST /tasks/{id}/assignee` | AC-003, AC-009 |
| FR-015 | C-005, C-006 | operator `add-member` | AC-006, AC-009 |
| FR-016 | C-006 | store access | AC-007 |
| FR-017 | C-001 | all web routes | AC-008 |
| NFR-001 | C-002 | all routes except sign-in | AC-005 |
| NFR-002 | C-001 | all web routes | AC-008 |
