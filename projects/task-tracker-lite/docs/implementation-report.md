# Implementation Report — Task Tracker Lite

## ISS-001 — Persistent store with Team, Member, and Task schema

Source: C-006. GitHub issue #14. Planning baseline: PR #13, merge commit `45250b5f09f5b3eedf16c8794d9c0dba73f218bf`.

### Decision

- Data store: Node's built-in `node:sqlite` (SQLite 3.53, Node 24). The architecture left the store product to implementation. The approver chose it in the Slack thread for this stage. There are no third-party dependencies.

### Files

- `src/store.js`: `openStore(filePath)` creates the schema if it is missing and returns a frozen store object.
- `tests/store.test.js`: the acceptance tests.

### Schema

| Table | Columns |
|---|---|
| `teams` | `id`, `name` (NOT NULL) |
| `members` | `id`, `team_id` (FK teams, NOT NULL), `username` (NOT NULL, UNIQUE), `display_name` (NOT NULL), `password_hash` (NOT NULL) |
| `tasks` | `id`, `team_id` (FK teams, NOT NULL), `title` (NOT NULL, non-blank CHECK), `description` (NOT NULL, default `''`), `status` (NOT NULL, default `To Do`, CHECK in `To Do`/`In Progress`/`Done`), `assignee_id` (nullable, FK members) |

Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

### Store operations

`createTeam`, `getTeam`, `listTeams`, `createMember`, `getMember`, `getMemberByUsername`, `listMembers`, `createTask`, `getTask`, `listTasks`, `close`.

The store has no delete operation for tasks (FR-016), and it has no delete operation for any other table. It also has no update operations, because edit, status, and assignee changes belong to ISS-006, ISS-007, and ISS-008.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| Team, Member, and Task are written and read back unchanged after the process restarts | `team, member, and task are read back unchanged after the process restarts`: writes in one child Node process and reads in a second one |
| Member has `team_id`, unique `username`, `display_name`, `password_hash` | `task has exactly the specified fields…`, `username is unique across members`, `a member must belong to an existing team` |
| Task has `team_id`, required `title`, `description`, `status` default `To Do`, nullable `assignee_id`, and no other fields | `task has exactly the specified fields and nothing else`, `task title is required…`, `schema rejects empty titles, unknown statuses, and dangling references` |
| No delete operation for tasks | `the store exposes no delete operation for tasks` |

### Test run

`node --test`: 7 tests, 7 pass, 0 fail.

### Assumptions to confirm in review

- Team has a `name` column. The issue says only "a Team". The TOR, SRS, and architecture were not available in the implementation workspace, so this field could not be checked against SRS 2.3. The approver chose to keep it in the Slack thread.
- `description` is stored as an empty string when it is not provided, not as NULL.
- Password hashing is not part of this issue. The store saves the hash string it is given. Salted hashing is part of ISS-002.

### Out of scope

Excluded items were not implemented: registration, roles, task deletion, extra task fields, multiple assignees, and the other TOR exclusions.
