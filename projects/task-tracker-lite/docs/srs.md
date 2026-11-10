# Software Requirements Specification — Task Tracker Lite

- Project: task-tracker-lite
- TOR baseline: TOR-001 (frozen), sha256 `beb37f537522d1a1b1407e0928158556b639e476a8cc4805ef7bb348d5ff1be5`, commit `33df89bb531e635f8fea2f751d9559c15c3a4065`
- Approved elaborations: EL-001 to EL-004 (see `docs/elicitation-log.md`)
- Status: Draft for human review

## Introduction

### 1.1 Purpose

This SRS specifies the requirements for Task Tracker Lite, a simple internal web application for recording and tracking team tasks (TOR 2.2). It is the basis for the detailed acceptance criteria referenced in TOR 4.3 and for subsequent design work.

### 1.2 Intent and boundaries

The product lets team members record work items, see team tasks, assign them, and update their progress so the team has one consistent view of task status (TOR 2.3). It is limited to internal team use (TOR 3.1, 5.1).

### 1.3 Background

A small team currently tracks work through informal conversations and manually maintained notes, which makes it hard to keep a consistent view of assigned tasks and their progress (TOR 2.1).

## Scope

### 2.1 Terminology

- **Team member** — an internal user of the product. All team members have the same role (EL-001).
- **Task** — a work item with a title, a description, a status, a creator, and at most one assignee.
- **Creator** — the team member who created a task.
- **Assignee** — the team member a task is currently assigned to, if any (EL-004).
- **Status** — one of `To Do`, `In Progress`, `Done` (EL-003).
- **Session** — a period of use of the web application by a team member.

### 2.2 In scope

- Creating tasks with a title and description (TOR 3.1).
- Assigning tasks to team members (TOR 3.1).
- Viewing tasks and their current status (TOR 3.1).
- Updating task status (TOR 3.1).
- Persisting task information between sessions (TOR 3.1).
- Internal team use through a browser (TOR 3.1, 5.1).

### 2.3 Out of scope

From TOR 3.2 and 5.1, unchanged:

- External customer access.
- Payment processing.
- Third-party or external project-management integrations.
- Advanced analytics.
- Mobile-native applications.

### 2.4 Assumptions and external dependencies

- The project depends on access to a suitable development and hosting environment (TOR 5.3).
- A designated human reviewer approves requirements and final deliverables (TOR 5.3).
- **Open (G-006, nonblocking):** How team members are identified (sign-in mechanism) and how team member accounts are provisioned is not specified. Per TOR 5.1 this is deferred to design. The SRS requires only that users are distinguished (FR-007) and that only team members have access (FR-010).

### 2.5 Actors

- **Team member** — the only user role. Any team member may create, assign, and view tasks; status changes are limited to a task's assignee or creator (EL-001, EL-002).

### 2.6 Use cases

- **UC-1 Create task** — A team member enters a title and description; the task is saved with status `To Do`, the team member as creator, and optionally an assignee.
- **UC-2 Assign / reassign task** — A team member sets, changes, or clears a task's assignee.
- **UC-3 View tasks** — A team member views all team tasks with their current status and assignee.
- **UC-4 Update status** — The assignee or creator of a task changes its status to another allowed value.

## Functional Requirements

### 3.1 Task Management

### FR-001

The product shall allow a team member to create a task by providing a title and a description.

Source: TOR 3.1

### FR-002

The product shall record the creating team member as the creator of each new task and shall set the status of each new task to `To Do`.

Source: EL-003

### FR-003

The product shall restrict task status to exactly one of the values `To Do`, `In Progress`, or `Done`.

Source: EL-003

### FR-004

The product shall allow a team member to assign a task to one team member. A task shall have at most one assignee and may have no assignee.

Source: EL-004

### FR-005

The product shall allow a team member to change a task's assignee to a different team member or to remove the assignee.

Source: EL-004

### FR-006

The product shall allow a permitted team member (see FR-009) to change a task's status from its current value to any other allowed status value.

Source: TOR 3.1

### 3.2 User Access

### FR-007

The product shall distinguish individual users so that each action is attributed to an identified team member.

Source: TOR 3.3

### FR-008

The product shall allow any team member to create tasks and to assign or reassign any task.

Source: EL-001

### FR-009

The product shall allow a task's status to be changed only by that task's current assignee or its creator, and shall refuse a status change attempted by any other team member.

Source: EL-001

### FR-010

The product shall restrict access to team members and shall refuse access to anyone who is not an identified team member.

Source: TOR 5.1

### FR-011

The product shall allow every team member to view all team tasks, showing for each task its title, description, current status, and assignee (or that it is unassigned).

Source: EL-002

### 3.3 Data

### FR-012

The product shall persist each task's title, description, status, creator, and assignee so that they are unchanged and available in later sessions.

Source: TOR 3.3

### 3.4 Usability

### FR-013

The product shall provide a web interface through which team members perform all task viewing and updating functions in FR-001 to FR-011.

Source: TOR 3.3

## Nonfunctional Requirements

Only categories justified by the TOR are included. No numerical thresholds are set; none are given in the TOR (G-007).

### NFR-001

The product shall be usable through a web browser without installing a native or mobile-native application.

Source: TOR 5.1

### NFR-002

The product shall present a consistent view of task status: after a status or assignee change is saved, any team member who subsequently views the task shall see the updated value.

Source: TOR 2.3

## Acceptance Criteria

### AC-001

A team member creates a task with a title and description. The task appears in the task list with that title and description, status `To Do`, and that team member recorded as creator.

Verifies: FR-001, FR-002, FR-013

### AC-002

Attempting to set a task's status to a value other than `To Do`, `In Progress`, or `Done` is not possible or is rejected, and the stored status is unchanged.

Verifies: FR-003

### AC-003

A team member assigns an unassigned task to team member A; the task shows A as assignee. A team member then reassigns it to B; the task shows only B. A team member then removes the assignee; the task shows as unassigned.

Verifies: FR-004, FR-005, FR-008

### AC-004

The assignee of a task changes its status from `To Do` to `In Progress` and then to `Done`, and then from `Done` back to `To Do`; each change is saved. The creator of the task, who is not the assignee, also successfully changes its status.

Verifies: FR-006, FR-009

### AC-005

A team member who is neither the assignee nor the creator of a task attempts to change its status. The change is refused and the stored status is unchanged.

Verifies: FR-009, FR-007

### AC-006

A person who is not an identified team member attempts to access the application and is refused access to task information.

Verifies: FR-010, FR-007

### AC-007

A team member who did not create and is not assigned to a task can see it in the task list with its title, description, current status, and assignee.

Verifies: FR-011

### AC-008

Tasks are created, assigned, and given status changes; the user ends the session and starts a new session (and the application is restarted). All tasks show the same title, description, status, creator, and assignee as before.

Verifies: FR-012

### AC-009

Team member A changes a task's status; team member B then views the task in a separate browser session and sees the new status.

Verifies: NFR-002

### AC-010

All acceptance demonstrations AC-001 to AC-009 are performed in a standard web browser, with no native or mobile-native application installed.

Verifies: NFR-001, FR-013

## Constraints and References

### 6.1 Technical and organizational constraints

- Intended for internal use (TOR 5.1).
- Browser-based interface (TOR 5.1).
- No external project-management integrations (TOR 5.1, 3.2).
- Technical implementation details are established during subsequent design work; this SRS does not prescribe architecture, technology, or deployment (TOR 5.1).
- No delivery dates are specified (TOR 5.2).
- A designated human reviewer approves requirements and final deliverables (TOR 5.3).

### 6.2 Open items (nonblocking)

- **G-005** — Editing or deleting a task's title and description is not in the TOR scope and has not been approved, so it is not specified here.
- **G-006** — The user identification and account provisioning mechanism is deferred to design (TOR 5.1).
- **G-007** — Supported browsers and performance or availability targets are not specified. No thresholds have been invented.

### 6.3 References

- Terms of Reference, Task Tracker Lite, TOR-001 (frozen) — `docs/tor.md`
- Elicitation log, EL-001 to EL-004 — `docs/elicitation-log.md`
- TOR analysis and gap register — `docs/_analysis.md`
- No additional project-specific reference documents are approved (TOR 1.2).
