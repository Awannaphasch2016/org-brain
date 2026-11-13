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

- Team has a `name` column. The issue says only "a Team". The TOR, SRS, and architecture were not available in the implementation workspace, so this field could not be checked against SRS 2.3.
- `description` is stored as an empty string when it is not provided, not as NULL.
- Password hashing is not part of this issue. The store saves the hash string it is given. Salted hashing is part of ISS-002.

### Out of scope

Excluded items were not implemented: registration, roles, task deletion, extra task fields, multiple assignees, and the other TOR exclusions.

## ISS-002 — Operator `add-member` command for account provisioning

Source: C-005. GitHub issue #15. Depends on ISS-001 (implementation PR #26, merge `2e07ef2e048c327a8f65bdbb96e0a637588b7544`, baseline recorded in PR #27, merge `f16a7b0d71b9deee901c39bb741e8d25a7e5ecb7`).

### Decisions

- The password is read from stdin. On a terminal it is read at a prompt that does not echo it. When stdin is piped, the first line is used. There is no `--password` flag, so the password stays out of shell history and the process list. The approver chose this in the Slack thread.
- Hashing uses Node's built-in `crypto.scrypt` with N=16384, r=8, p=1, a random 16-byte salt, and a 64-byte key. It is stored as `scrypt$N$r$p$salt$hash`.

### Usage

```
node src/add-member.js --db <path> --username <name> --display-name <name> [--team-name <name>] < password
```

- On an empty store, `--team-name` is required. The run creates the single Team and the first Member.
- On later runs, the Member is added to the existing Team. `--team-name` can be left out. If it is given, it must match the existing Team, so a second team can never be created.
- Every input is checked before anything is written. The command rejects a duplicate username, an empty password, a missing team name on an empty store, a different team name, and unknown flags. A rejected run writes nothing.
- Exit codes: `0` success, `2` usage or validation error, `1` other error.

### Files

- `src/password.js`: `hashPassword` and `verifyPassword`. `verifyPassword` exists so the tests can prove the stored value is a salted hash of the given password. ISS-004 can reuse it.
- `src/add-member.js`: `addMember(store, …)` and the command-line entry point.
- `tests/add-member.test.js`: the acceptance tests. They run the real command in a child process.
- `src/store.js` is unchanged.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| On an empty store, the command creates exactly one Team and one Member, and the password is stored only as a salted hash | `first run on an empty store creates exactly one team and one member with a salted hash`: also checks that the plain password does not appear in the store file. Also `hashPassword salts each hash` |
| A second run adds a second Member to the same Team and leaves every existing Task unchanged | `second run adds a member to the same team and leaves every task unchanged` |
| No web route can create a member (FR-013) | `no module other than the add-member command creates members`: a guard that fails if any other `src` module calls `createMember` or loads `add-member`. The command does not use `http`, `https`, `http2`, or `net` |
| Rejected input stores nothing | `rejected runs change nothing`: missing team name, empty password, duplicate username, a second team name, and a `--password` flag |

### Test run

`node --test`: 15 tests (ISS-001 and ISS-002), 15 pass, 0 fail.

### Notes for review

- There is no web server yet, so FR-013 is enforced by the guard test. ISS-004, ISS-009, and later issues must keep that test passing.
- The command does not enforce any password length or complexity, because the issue does not ask for it. It rejects only an empty password.
