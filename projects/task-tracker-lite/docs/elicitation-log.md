# Elicitation log

Append one section per question after a person answers. Each section heading is an `EL-` identifier with three digits. Under it, record `class`, `resolution`, `question`, `why`, `answer`, `responder`, `timestamp`, and `conflictWithTor`. A conflict with the frozen TOR is recorded as a conflict and is not an approved elaboration.

## EL-001

- class: requires_human
- resolution: approved
- question: Which permission model should the SRS specify for "authorized users" and "appropriate task permissions" (TOR 2.3, 3.3)? Options offered: member + admin roles; all members equal; creator/assignee only.
- why: Resolves G-001, and the visibility part of G-003. Needed for Scope actors, the User Access requirements, and acceptance criteria.
- answer: All members equal (option chosen at 2026-11-10T11:34:20.000Z), then clarified in the thread: "Keep it simple: a single role. Every authenticated user has the same permissions and can create, view, edit, assign, and update the status of any task. No admin or per-task restrictions."
- responder: slack:T0CFZ4ZT20Z:U0CFRUV378D
- timestamp: 2026-11-10T11:55:23.000Z
- conflictWithTor: false
- note: Consistent with TOR 2.3 and 3.3. Users are still distinguished by authentication, and "authorized" means an authenticated internal user. External access stays excluded (TOR 3.2, 5.1). "Edit" is read as changing a task's title and description, which TOR 3.3 Usability supports ("update relevant task information"). Delete was not mentioned and is not added. "Relevant tasks" (TOR 2.3) is read as all tasks, since every user may view any task.

## EL-002

- class: requires_human
- resolution: approved
- question: Which statuses should a task have, what is the initial status, and which status changes are allowed (TOR 3.1 "update task status")?
- why: Resolves G-002. Needed for the Task Management requirements and the status-update acceptance criteria.
- answer: "Three statuses: To Do, In Progress, and Done. New tasks start in To Do, and any transition between them is allowed, including moving a task back."
- responder: slack:T0CFZ4ZT20Z:U0CFRUV378D
- timestamp: 2026-11-10T12:03:52.000Z
- conflictWithTor: false

## EL-003

- class: requires_human
- resolution: approved
- question: How many assignees may a task have, and may a task be unassigned (TOR 3.1 "assign tasks to team members")?
- why: Resolves G-004. Needed for the Task Management assignment requirements and acceptance criteria.
- answer: "At most one assignee per task, and assignment is optional, so a task can be unassigned."
- responder: slack:T0CFZ4ZT20Z:U0CFRUV378D
- timestamp: 2026-11-10T12:22:16.000Z
- conflictWithTor: false
- note: Combined with EL-001 (any authenticated user may assign any task), any user may assign, reassign, or clear the assignee of any task.

## EL-004

- class: conflict
- resolution: rejected
- question: How do user accounts and the list of assignable team members come to exist (TOR 3.3 "distinguish users"; mechanism deferred to design by TOR 5.1)?
- why: Addresses G-005. Affects Scope assumptions and the User Access requirements.
- answer: "Self sign-up: anyone can register an account, and every registered user is an assignable team member."
- responder: slack:T0CFZ4ZT20Z:U0CFRUV378D
- timestamp: 2026-11-10T12:51:57.000Z
- conflictWithTor: true
- note: Conflicts with TOR 3.2 (external customer access is out of scope), TOR 5.1 ("Intended for internal use"), and TOR 3.1 ("Support internal team use"). Under EL-001 every registered user gets full permissions, so unrestricted registration would let people outside the team access, edit, and be assigned tasks. This is not recorded as an approved elaboration and will not become a requirement. The TOR is unchanged. Escalated to the person, who withdrew the open sign-up answer (Slack, 2026-11-10). Superseded by EL-005.

## EL-005

- class: requires_human
- resolution: approved
- question: How should EL-004's conflict be resolved, and how do user accounts and the assignable team-member list come to exist while staying internal-only (TOR 3.1, 3.2, 3.3, 5.1)?
- why: Resolves G-005 and the conflict in EL-004. Affects Scope assumptions and the User Access requirements.
- answer: "Withdraw the open sign-up answer. Resolve EL-004 this way: no public registration. The system has a single team, and only that team's members have accounts. For this prototype the team has exactly one member (me), so keep account setup minimal (e.g. one pre-created account), but keep the data model team-based so more members can be added later. Every team member is assignable. This keeps it internal-only per the TOR."
- responder: slack:T0CFZ4ZT20Z:U0CFRUV378D
- timestamp: 2026-11-10T13:08:15.000Z
- conflictWithTor: false
- note: Consistent with TOR 3.1, 3.2, and 5.1. "One pre-created account" is an example of minimal setup. The SRS states the capability, and design chooses the provisioning mechanism (TOR 5.1).

## EL-006

- class: requires_human
- resolution: approved
- question: (Context the person gave with EL-005) What overall intent should guide the remaining SRS choices?
- why: Guides the remaining optional choices and resolves G-006 (nonfunctional expectations).
- answer: "The goal of this prototype is to validate the Software Factory end to end, not to build a production system. Please prefer the simplest option that satisfies the TOR wherever there's a choice."
- responder: slack:T0CFZ4ZT20Z:U0CFRUV378D
- timestamp: 2026-11-10T13:08:15.000Z
- conflictWithTor: false
- note: Applied to the NFRs: only NFRs the TOR states (internal access, browser interface, persistence) are included. No production-grade thresholds are added.
