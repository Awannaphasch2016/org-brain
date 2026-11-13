# Feature Issues — Task Tracker Lite

Status: Draft for human review
Architecture baseline: `docs/architecture.md`, approved in PR #11, baseline recorded in PR #12, merge commit `7c83443` (per the approver)
SRS commit: `6f9ff4732c1f31853bcffb7ce1b5b2c7ccd8005b` (PR #9)
TOR baseline: TOR-001 (frozen), sha256 `beb37f537522d1a1b1407e0928158556b639e476a8cc4805ef7bb348d5ff1be5`

This plan splits the approved architecture into reviewable feature issues. It adds no scope beyond the TOR, SRS, and architecture. Excluded by the TOR, SRS, and architecture, and not planned here: registration, multiple teams, roles, task deletion, extra task fields, multiple assignees, integrations, payments, analytics, and native or mobile apps. Language, framework, data store product, and hosting are still deferred to implementation (architecture "Decisions and deferrals").

Dependency order: ISS-001 → (ISS-002, ISS-003, ISS-005) → ISS-004 → ISS-009; ISS-005 → (ISS-006, ISS-007, ISS-008) → ISS-010 → ISS-011.

## ISS-001
Title: Persistent store with Team, Member, and Task schema
Source: C-006
Depends: none
Acceptance: A Team, a Member (with `team_id`, unique `username`, `display_name`, `password_hash`), and a Task (with `team_id`, required `title`, `description`, `status` default `To Do`, nullable `assignee_id`) can be written and are read back unchanged after the application process restarts; Task has no other fields and the store has no delete operation for tasks (FR-016, SRS 2.3).

## ISS-002
Title: Operator `add-member` command for account provisioning
Source: C-005
Depends: ISS-001
Acceptance: Running `add-member` from the command line on an empty store creates exactly one Team and one Member whose password is stored only as a salted hash; running it again adds a second Member to the same Team and leaves every existing Task row unchanged; no web route can create a member (FR-013, FR-015, A-002).

## ISS-003
Title: Team and member directory
Source: C-004
Depends: ISS-001
Acceptance: Given a signed-in member id, the directory returns that member's team and the full list of that team's members as the assignable set; it exposes no write operation (FR-014, FR-005).

## ISS-004
Title: Authentication and session handling
Source: C-002
Depends: ISS-001, ISS-002
Acceptance: A member created by `add-member` can sign in with correct credentials and receives a session holding only their member id; wrong credentials are rejected; after sign-out the session no longer grants access; every request other than `GET /login` and `POST /login` without a valid session is rejected or redirected to sign-in (FR-010, FR-011, NFR-001).

## ISS-005
Title: Task service — create, list, and view tasks
Source: C-003
Depends: ISS-001
Acceptance: Creating a task with a title (and optional description) stores it in the caller's team with status `To Do` and no assignee; creating without a title is rejected and stores nothing; listing returns every task with title, status, and assignee or "unassigned"; viewing returns one task's title, description, status, and assignee; any authenticated member can perform all three with no role or per-task check (FR-001, FR-002, FR-005, FR-008, FR-009, FR-012).

## ISS-006
Title: Task service — edit title and description
Source: C-003
Depends: ISS-005
Acceptance: Any authenticated member can change an existing task's title and description and the change is persisted; an edit with an empty title is rejected and leaves the task unchanged (FR-007, FR-012).

## ISS-007
Title: Task service — change status
Source: C-003
Depends: ISS-005
Acceptance: A task's status can move from each of `To Do`, `In Progress`, and `Done` to either of the other two, and the change is persisted; any other status value is rejected and leaves the task unchanged (FR-003, FR-004, FR-012).

## ISS-008
Title: Task service — set or clear assignee
Source: C-003
Depends: ISS-005, ISS-003
Acceptance: A task's assignee can be set to exactly one member of the same team or cleared to unassigned, and the change is persisted; an assignee id that is not a member of the task's team is rejected and leaves the task unchanged (FR-005, FR-006, FR-012, FR-014).

## ISS-009
Title: Web UI — sign-in and sign-out pages
Source: C-001
Depends: ISS-004
Acceptance: In a standard web browser a member can open the sign-in page, sign in, and sign out via a visible control; no registration page or link exists, and requesting any task page while signed out leads to the sign-in page (FR-010, FR-011, FR-013, FR-017, NFR-002).

## ISS-010
Title: Web UI — task list, task detail, and create-task pages
Source: C-001
Depends: ISS-005, ISS-009
Acceptance: In a standard web browser a signed-in member sees the task list (title, status, assignee or "unassigned"), opens a task's detail page (title, description, status, assignee), and creates a task from a form that then appears in the list with status `To Do` and unassigned (FR-001, FR-002, FR-008, FR-009, FR-017, NFR-002).

## ISS-011
Title: Web UI — edit, status, and assignee controls on task detail
Source: C-001
Depends: ISS-006, ISS-007, ISS-008, ISS-010
Acceptance: From the task detail page in a standard web browser a signed-in member can edit title and description, choose a status from a control offering exactly `To Do`, `In Progress`, and `Done`, and choose an assignee from a control offering "unassigned" or exactly one team member; each change is shown on reload (FR-003, FR-005, FR-006, FR-007, FR-017, NFR-002).
