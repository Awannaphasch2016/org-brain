# TOR analysis — Task Tracker Lite

TOR baseline: TOR-001 (frozen), sha256 `beb37f537522d1a1b1407e0928158556b639e476a8cc4805ef7bb348d5ff1be5`, commit `33df89bb531e635f8fea2f751d9559c15c3a4065`.

Classification key: **explicit** (stated in the TOR), **inferred** (follows directly from TOR wording), **proposed** (agent suggestion, not approved), **unresolved** (needs a human answer).

## 1. Objectives, purpose, background

| Detail | Class | TOR |
|---|---|---|
| Small team tracks work informally; no consistent view of assigned tasks and progress | explicit | 2.1 |
| Simple internal web application for recording and tracking team tasks | explicit | 2.2 |
| Team members record work items | explicit | 2.3 |
| Team members view relevant tasks | explicit (meaning of "relevant" unresolved) | 2.3 |
| Authorized users update task progress | explicit (who is "authorized" unresolved) | 2.3 |
| Consistent view of task status | explicit | 2.3 |

## 2. Scope

| Detail | Class | TOR |
|---|---|---|
| Create tasks with a title and description | explicit | 3.1 |
| Assign tasks to team members | explicit (cardinality unresolved) | 3.1 |
| View tasks and their current status | explicit | 3.1 |
| Update task status | explicit (status values unresolved) | 3.1 |
| Persist task information between sessions | explicit | 3.1, 3.3 Data |
| Support internal team use | explicit | 3.1, 5.1 |
| Out of scope: external customer access, payment processing, third-party PM integrations, advanced analytics, mobile-native apps | explicit — must be preserved | 3.2, 5.1 |
| Actors: team members; "authorized users"; designated human reviewer (project role, not a system actor) | inferred | 2.3, 5.3 |
| Editing title/description after creation, deleting tasks | not stated — not added to scope | — |
| Additional task fields (due date, priority, comments) | not stated — not added to scope | — |

## 3. High-level requirement groups (from TOR 3.3)

- Task Management — creation, assignment, tracking (explicit)
- User Access — distinguish users; enforce appropriate task permissions (explicit; permission model unresolved)
- Data — persistence between sessions (explicit)
- Usability — view and update relevant task information through a web interface (explicit)

## 4. Deliverables and acceptance

| Detail | Class | TOR |
|---|---|---|
| Working internal web application covering scope | explicit | 4.1 |
| SRS and subsequent technical documentation | explicit | 4.2 |
| Demonstrate creation, assignment, viewing, status update with persisted data; detail set by SRS | explicit | 4.3 |

## 5. Constraints, milestones, responsibilities

| Detail | Class | TOR |
|---|---|---|
| Internal use; browser-based; no external PM integrations | explicit | 5.1 |
| Technical implementation deferred to design | explicit — SRS must not choose architecture | 5.1 |
| No delivery dates | explicit | 5.2 |
| Designated human reviewer approves requirements and deliverables | explicit | 5.3 |
| Depends on suitable development and hosting environment | explicit (external dependency) | 5.3 |

## SRS section mapping

| SRS section | Mapping |
|---|---|
| 1 Introduction | filled from TOR 2.1–2.3 |
| 2 Scope — in/out of scope, assumptions, dependencies | filled from TOR 3.1, 3.2, 5.3 |
| 2 Scope — actors | gap (G-001) |
| 3 FR Task Management | filled, with gaps G-002, G-003, G-004 |
| 3 FR User Access | gap (G-001, G-005) |
| 3 FR Data | filled from TOR 3.3 |
| 3 FR Usability | filled from TOR 3.3, depends on G-003 |
| 4 NFR | explicitly deferrable beyond TOR-stated constraints (G-006); no thresholds invented |
| 5 Acceptance Criteria | filled once G-001–G-004 are answered |
| 6 Constraints and References | filled from TOR 5.1–5.3 |

## Gap register

- G-001 | blocking | resolved | (EL-001) Roles and task permissions: which kinds of users exist and who may create, assign, and update the status of a task (TOR 2.3 "authorized users", 3.3 "appropriate task permissions"). Affects Scope actors, FR User Access, AC.
- G-002 | blocking | resolved | (EL-002) Task status values and allowed transitions, and the initial status of a new task (TOR 3.1 "update task status"). Affects FR Task Management, AC.
- G-003 | blocking | resolved | (EL-001: every authenticated user may view any task) Meaning of "relevant tasks": whether every user sees all team tasks or only some (TOR 2.3, 3.3 Usability). Affects FR Task Management, FR User Access, AC.
- G-004 | blocking | resolved | (EL-003) Assignment rules: one or several assignees per task, whether a task may be unassigned, and whether it may be reassigned (TOR 3.1). Affects FR Task Management, AC.
- G-005 | nonblocking | resolved | (EL-005; EL-004 rejected) How user accounts / the team-member list come to exist (in-app administration vs. provided externally). Affects Scope assumptions, FR User Access. Mechanism itself is deferred to design (TOR 5.1).
- G-006 | nonblocking | resolved | (EL-006: no NFRs beyond TOR-stated constraints; no thresholds) Nonfunctional expectations (team size, supported browsers, availability). TOR gives none; no thresholds will be invented. Affects NFR.
