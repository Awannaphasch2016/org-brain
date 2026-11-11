# Software Requirements Specification — Task Tracker Lite

Status: Draft for human review
TOR baseline: TOR-001 (frozen), sha256 `beb37f537522d1a1b1407e0928158556b639e476a8cc4805ef7bb348d5ff1be5`, commit `33df89bb531e635f8fea2f751d9559c15c3a4065`
Approved elaborations: EL-001, EL-002, EL-003, EL-005, EL-006 (see `docs/elicitation-log.md`). EL-004 was a conflict with the TOR. It was rejected and is not used.

## Introduction

### 1.1 Purpose

This document specifies the requirements for Task Tracker Lite. It is a simple internal web application for recording and tracking team tasks (TOR 2.2). It is the basis for design, implementation, and acceptance. The designated human reviewer approves it (TOR 5.3).

### 1.2 Intent

The product gives a small team a consistent view of tasks, who they are assigned to, and their status. Today that information is kept in informal conversations and manual notes (TOR 2.1, 2.3). This release is a prototype whose goal is to validate the Software Factory end to end, not to deliver a production system. Where the TOR allows a choice, the simplest option that satisfies the TOR is taken (EL-006).

### 1.3 Boundaries

This document states what the product must do. It does not choose architecture, technology, hosting, or deployment. Those are left to later design work (TOR 5.1).

### 1.4 Background

See TOR 2.1. No additional project-specific reference documents have been approved (TOR 1.2).

## Scope

### 2.1 Terminology

- **Task** — a work item with a title, a description, a status, and at most one assignee.
- **Status** — exactly one of `To Do`, `In Progress`, `Done` (EL-002).
- **Team** — the single group of internal users the product serves (EL-005).
- **Team member** — a person who holds an account in the product. Every team member is an authenticated user and can be assigned tasks (EL-005).
- **Assignee** — the team member a task is assigned to, if any (EL-003).

### 2.2 In scope

- Creating tasks with a title and description (TOR 3.1).
- Editing a task's title and description (EL-001, TOR 3.3).
- Assigning, reassigning, and unassigning tasks to and from team members (TOR 3.1, EL-003).
- Viewing tasks and their current status (TOR 3.1).
- Updating task status (TOR 3.1, EL-002).
- Distinguishing users through authentication (TOR 3.3, EL-001).
- Persisting task information between sessions (TOR 3.1, 3.3).
- Internal team use through a browser-based interface (TOR 3.1, 5.1).

### 2.3 Out of scope

From the TOR (TOR 3.2, 5.1):

- External customer access.
- Payment processing.
- Third-party project-management integrations.
- Advanced analytics.
- Mobile-native applications.

Not requested in the TOR or in approved elaborations, so not included:

- Public or self-service registration (EL-004 rejected, EL-005).
- More than one team (EL-005).
- Administrator roles or per-task permission restrictions (EL-001).
- Deleting tasks.
- Task fields other than title, description, status, and assignee.
- Multiple assignees per task (EL-003).

### 2.4 Assumptions and external dependencies

- A-001: A suitable development and hosting environment is available (TOR 5.3).
- A-002: For this prototype the team has one member, the requester. Minimal account setup, such as one pre-created account, is acceptable (EL-005). Design chooses the provisioning mechanism (TOR 5.1).
- A-003: The prototype is not intended for production use (EL-006). No capacity, performance, or availability targets are set. None are stated in the TOR, and none are invented here.

### 2.5 Actors

- **Team member (authenticated user)** — the only user role. Every team member has the same permissions over every task (EL-001).
- **Designated human reviewer** — a project role, not a system user. Approves requirements and final deliverables (TOR 5.3).

### 2.6 Use cases

- UC-1 Sign in: a team member authenticates before using the product.
- UC-2 Create task: a team member enters a title and description. The task is created with status `To Do` and may be left unassigned.
- UC-3 View tasks: a team member sees all tasks with their status and assignee, and can open one task to see its details.
- UC-4 Edit task: a team member changes the title or description of any task.
- UC-5 Assign task: a team member sets, changes, or clears the assignee of any task.
- UC-6 Update status: a team member moves any task to any of the three statuses.

## Functional Requirements

### 3.1 Task Management

### FR-001

The product shall allow an authenticated user to create a task by entering a title and a description.

Source: TOR 3.1

### FR-002

The product shall give every newly created task the status `To Do`.

Source: EL-002

### FR-003

The product shall allow a task to have only one of these statuses at any time: `To Do`, `In Progress`, `Done`.

Source: EL-002

### FR-004

The product shall allow an authenticated user to change the status of any task from its current status to either of the other two statuses. This includes moving a task back to an earlier status.

Source: TOR 3.1, EL-002

### FR-005

The product shall allow a task to have no assignee or exactly one assignee, who is a team member. A task may be created without an assignee.

Source: TOR 3.1, EL-003, EL-005

### FR-006

The product shall allow an authenticated user to assign any task to a team member, reassign it to another team member, or remove its assignee.

Source: TOR 3.1, EL-001, EL-003

### FR-007

The product shall allow an authenticated user to edit the title and description of any task.

Source: TOR 3.3, EL-001

### FR-008

The product shall show an authenticated user a list of all tasks, with each task's title, current status, and assignee (or an indication that it is unassigned).

Source: TOR 3.1, TOR 2.3, EL-001

### FR-009

The product shall allow an authenticated user to view a single task's title, description, current status, and assignee.

Source: TOR 3.1

### 3.2 User Access

### FR-010

The product shall require a user to authenticate as a team member before viewing or changing any task information.

Source: TOR 3.3, TOR 5.1, EL-001

### FR-011

The product shall record which team member is signed in, so that different users are distinguished.

Source: TOR 3.3

### FR-012

The product shall give every authenticated user the same permissions: create, view, edit, assign, and update the status of any task. It shall have no administrator role and no per-task restrictions.

Source: EL-001

### FR-013

The product shall not offer public or self-service registration. Only members of the team shall have accounts.

Source: EL-005, TOR 3.2, TOR 5.1

### FR-014

The product shall serve a single team. Every account shall belong to that team, and every team member shall be available as an assignee.

Source: EL-005

### FR-015

The product shall work with a team of one member set up through minimal account setup. It shall not be limited to one member: adding another team member later shall not require changes to existing task information.

Source: EL-005

### 3.3 Data

### FR-016

The product shall persist each task's title, description, status, and assignee, so that they are unchanged after the user's session ends and a new session starts. This includes after the application is restarted.

Source: TOR 3.1, TOR 3.3

### 3.4 Usability

### FR-017

The product shall provide all of its user functions (FR-001 to FR-011) through a web interface.

Source: TOR 3.3

## Nonfunctional Requirements

Only the categories the TOR justifies are included (EL-006). No numerical thresholds are set.

### NFR-001

Access: no task information shall be reachable by anyone who is not an authenticated team member. This includes external customers.

Source: TOR 3.2, TOR 5.1

### NFR-002

Platform: the product shall be usable through a web browser, without installing a native or mobile application.

Source: TOR 5.1, TOR 3.2

## Acceptance Criteria

### AC-001

Signed in as a team member, the reviewer creates a task with a title and description. The task appears in the task list with that title, status `To Do`, and no assignee.

Verifies: FR-001, FR-002, FR-005, FR-008

### AC-002

For an existing task, the reviewer changes the status To Do → In Progress → Done, then Done → To Do. After each change, the task shows the new status, and no status other than the three defined ones can be selected.

Verifies: FR-003, FR-004

### AC-003

The reviewer assigns an unassigned task to a team member, and the assignee is shown. The reviewer then removes the assignee, and the task shows as unassigned. The product offers no way to give one task two assignees.

Verifies: FR-005, FR-006, FR-014

### AC-004

The reviewer edits a task's title and description. The task details then show the new values.

Verifies: FR-007, FR-009

### AC-005

Without signing in, the reviewer opens the product in a browser. No task information is shown, no task can be changed, and no registration option is offered.

Verifies: FR-010, FR-013, NFR-001

### AC-006

The reviewer signs in with the team's single pre-set account. The product identifies the signed-in member, and every task operation in AC-001 to AC-004 is available on every task without any role or per-task restriction.

Verifies: FR-011, FR-012, FR-015

### AC-007

After creating, assigning, editing, and changing the status of tasks, the reviewer signs out and signs back in, and the application is restarted. All tasks show the same title, description, status, and assignee as before.

Verifies: FR-016

### AC-008

All of AC-001 to AC-007 are carried out in a standard web browser, without installing any native or mobile application.

Verifies: FR-017, NFR-002

### AC-009

A second team member account is added by whatever means design provides. The new member is offered as an assignee, and all existing tasks remain unchanged.

Verifies: FR-014, FR-015

## Constraints and References

### 6.1 Technical and organizational constraints

- Internal use only (TOR 5.1).
- Browser-based interface (TOR 5.1).
- No external project-management integrations (TOR 3.2, 5.1).
- Technical implementation details are established during later design work (TOR 5.1). This SRS chooses no architecture, technology, or deployment.
- No delivery dates are specified (TOR 5.2).
- A designated human reviewer approves requirements and final deliverables (TOR 5.3).

### 6.2 Open items (nonblocking)

- None. All gaps from the analysis are resolved (see `docs/_analysis.md`). How accounts are provisioned is deliberately left to design (A-002).

### 6.3 References

- TOR-001, Task Tracker Lite Terms of Reference, `docs/tor.md`, frozen at commit `33df89bb531e635f8fea2f751d9559c15c3a4065`.
- Elicitation log, `docs/elicitation-log.md` (EL-001 to EL-006).
- TOR analysis and gap register, `docs/_analysis.md`.
