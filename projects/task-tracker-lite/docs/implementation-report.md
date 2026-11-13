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

## ISS-003 — Team and member directory

Source: C-004. GitHub issue #16. Depends on ISS-001. ISS-002 was merged in PR #28 (merge `456a39fdb1ef7a798576b14bb0f8ab4a9d164d54`), and its baseline record is PR #29.

### Design

- `src/directory.js`: `createDirectory(store)` returns a frozen object with exactly one operation, `forMember(memberId)`.
- `forMember` returns `{ team: { id, name }, members: [{ id, username, display_name }, …] }` for the member's team. `members` lists every member of that team, ordered by id. This list is the assignable set for FR-005, and ISS-008 will use it.
- `forMember` returns `null` when the id is not a known member or is not an integer.
- `password_hash` is never included in the result.
- The result and its nested objects are frozen. The module calls only the store's read methods.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| Given a signed-in member id, the directory returns that member's team and the full list of that team's members | `returns the signed-in member's team and every member of that team` |
| The directory exposes no write operation | `the directory exposes no write operation`: one operation only, frozen results, and the source makes no create calls and contains no SQL writes |
| (Safety) The directory does not expose credentials | `never exposes password hashes` |
| (Safety) Unknown ids are handled | `unknown or invalid member ids return null` |

### Test run

`node --test`: 19 tests, 19 pass, 0 fail.

### Housekeeping

- PR #28 accidentally dropped one sentence from the ISS-001 assumptions in this report. This PR restores it: "The approver chose to keep it in the Slack thread."

## ISS-004 — Authentication and session handling

Source: C-002. Depends on ISS-001 and ISS-002. ISS-003 was merged in PR #30 (merge `c65ae58db2239b8323e28daaba3f996e6aeb3356`), and its baseline record is PR #31.

### Decisions

- HTTP uses Node's built-in `node:http`, with no framework. The architecture left the framework to implementation.
- Sessions are kept in server memory, as the approver chose in the Slack thread. Each session is identified by a random 256-bit token sent in the `sid` cookie with `HttpOnly`, `SameSite=Lax`, and `Path=/`. The `Secure` flag is available through `createApp({ secureCookies: true })` for HTTPS hosting.
- Because sessions are in memory, restarting the server signs everyone out. Sessions have no expiry.

### Files

- `src/auth.js`: `createAuth(store)` provides `signIn(username, password)`, which returns a token or `null`, plus `sessionFor(token)` and `signOut(token)`.
  - A session is a frozen `{ memberId }` and holds nothing else.
  - Every sign-in creates a new token, so an old token cannot be reused for a new sign-in.
  - An unknown username is checked against a dummy hash, so it takes about as long to reject as a wrong password.
  - If a session's member no longer exists, the session is invalid.
- `src/app.js`: `createApp({ store, routes, loginPage, secureCookies })` returns a request handler.
  - `GET /login` and `POST /login` (an `application/x-www-form-urlencoded` form with `username` and `password`) are the only public routes.
  - A successful sign-in sets the cookie and redirects (303) to `/`. A failed sign-in returns 401 and sets no cookie.
  - `POST /logout` ends the session, clears the cookie, and redirects (303) to `/login`.
  - Any other request without a valid session is redirected to `/login` (303) for GET and HEAD, and gets 401 for other methods.
  - Later issues add pages and task routes through `routes` and `loginPage`. Every route added that way sits behind the session gate.
  - Forms are limited to 8 KiB.
- `tests/auth.test.js`: the acceptance tests. They provision members with the real `add-member` command and send real HTTP requests to a loopback server.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| A member created by `add-member` can sign in and gets a session holding only their member id | `a member created by add-member signs in and the session holds only their member id` |
| Wrong credentials are rejected | `wrong credentials are rejected and grant no session`: wrong password, another member's password, unknown user, empty password, and an empty form |
| After sign-out, the session no longer grants access | `after sign-out the session no longer grants access` |
| Every request other than `GET /login` and `POST /login` without a valid session is rejected or redirected to sign-in | `every request except GET and POST /login needs a valid session`: no cookie, a forged token, an empty token, and a cookie with a different name, across several GET paths and several non-GET methods. It also checks that no protected handler ran |
| (Safety) Every sign-in gets a new random token | `each sign-in issues a new random token` |

### Test run

`node --test`: 24 tests, 24 pass, 0 fail.

### Notes for review

- `GET /login` currently returns a plain-text placeholder. ISS-009 replaces it with the real sign-in page through `loginPage`.
- Sign-out is `POST` only. Combined with `SameSite=Lax`, a link on another site cannot sign a member out.
- The FR-013 guard from ISS-002 still passes. No HTTP route can create a member.
- There is no rate limiting on sign-in attempts, because the issue does not ask for it.

## ISS-005 — Task service: create, list, and view tasks

Source: C-003. Depends on ISS-001. ISS-004 was merged in PR #32 (merge `2fa9759cbc6d2eab1cd0b4cd5d79fc4f91831eb3`), and its baseline record is PR #33.

### Design

- `src/tasks.js`: `createTaskService(store)` returns a frozen service with `create`, `list`, and `view`. Each operation takes the caller's member id, which comes from the session.
  - `create(memberId, { title, description })` stores the task in the caller's team. Status and assignee come from the schema defaults (`To Do`, no assignee). A missing, blank, or non-text title throws `TaskValidationError`, and so does a non-text description. In both cases the check runs before anything is written. The method returns the created task in the same form as `view`.
  - `list(memberId)` returns every task in the caller's team, ordered by id, as `{ id, title, status, assignee, assigneeLabel }`. `assignee` is `{ id, display_name }` or `null`. `assigneeLabel` is the display name or `"unassigned"`.
  - `view(memberId, taskId)` returns `{ id, title, description, status, assignee, assigneeLabel }`. It returns `null` when the task does not exist or is in another team.
  - An unknown caller id throws `UnknownMemberError`. In the app, the ISS-004 session gate means this does not happen for normal requests.
- There are no role checks or per-task ownership checks. Any member of the team can perform all three operations on any of the team's tasks (FR-012).
- The service has no delete operation.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| Creating with a title (and optional description) stores the task in the caller's team with status `To Do` and no assignee | `create stores the task in the caller's team as To Do and unassigned` |
| Creating without a title is rejected and stores nothing | `create without a title is rejected and stores nothing` |
| Listing returns every task with title, status, and assignee or "unassigned" | `list returns every task with title, status, and assignee or "unassigned"`. ISS-008 has not added the assignee operation yet, so this test sets an assignee directly in the database |
| Viewing returns one task's title, description, status, and assignee | `view returns one task's title, description, status, and assignee` |
| Any authenticated member can perform all three, with no role or per-task check | `any member can create, list, and view with no role or per-task check` |
| (Safety) Unknown callers are refused, and there is no delete operation | `unknown callers are refused`, `the service has no delete operation` |

### Test run

`node --test`: 31 tests, 31 pass, 0 fail.

### Notes for review

- No HTTP routes are added. ISS-010 connects this service to pages behind the ISS-004 session gate.
- The `assignee` and `assigneeLabel` result shape is my own choice. It keeps a member whose display name is literally "unassigned" separate from a task with no assignee.

## ISS-006 — Task service: edit title and description

Source: C-003. Depends on ISS-005. ISS-005 was merged in PR #34 (merge `f75173a0c51b67b725fabe706db12b0746c9c8af`), and its baseline record is PR #35.

### Design

- `src/store.js` gains one write operation, `updateTaskText(id, { title, description })`. It rewrites only `title` and `description`, and returns the updated row, or `null` for an unknown id. It checks its inputs, and the schema `CHECK` constraints still apply.
- `src/tasks.js` gains `edit(memberId, taskId, { title, description })`.
  - The caller must be a known member, and the task must be in the caller's team. Otherwise `edit` returns `null`, the same way `view` does.
  - An empty, blank, or non-text title throws `TaskValidationError` before anything is written, so the task stays unchanged. A non-text description is rejected the same way.
  - If `description` is left out, the current description is kept. An empty string clears it.
  - Any member may edit any task in the team. There is no role or ownership check (FR-012).
  - It returns the updated task in the `view` form.
- Status and assignee are not touched. ISS-007 and ISS-008 handle them.

### Changes to earlier tests

- `tests/store.test.js`: `the store exposes no delete operation for tasks` lists the exact store operations, so `updateTaskText` was added to that list. The check that no operation name contains delete, remove, destroy, drop, or purge is unchanged.
- `tests/tasks.test.js`: `the service has no delete operation` now expects `edit` as well.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| Any authenticated member can change an existing task's title and description, and the change is persisted | `any member can change a task's title and description, and the change is persisted`: a member who did not create the task edits it, and a separate store connection reads the change back |
| An edit with an empty title is rejected and leaves the task unchanged | `an edit with an empty title is rejected and leaves the task unchanged` |
| (Detail) Description handling | `the description can be cleared, or kept by leaving it out` |
| (Safety) Missing tasks and unknown callers | `editing a missing task returns null, and unknown callers are refused` |

### Test run

`node --test`: 35 tests, 35 pass, 0 fail.

### Notes for review

- Keeping the current description when `description` is left out is my own choice. The issue does not say what happens in that case. ISS-011's edit form will always send both fields.

## ISS-007 — Task service: change status

Source: C-003. Depends on ISS-005. ISS-006 was merged in PR #36 (merge `04345ccc9abb6c9a0fc966372f390cdf24630d32`), and its baseline record is PR #37.

### Design

- `src/store.js` gains `updateTaskStatus(id, status)`. It rewrites only `status` and returns the updated row, or `null` for an unknown id. It refuses any value other than `To Do`, `In Progress`, or `Done`, and the schema `CHECK` constraint also still applies.
- `src/tasks.js` gains `setStatus(memberId, taskId, status)`.
  - The caller must be a known member, and the task must be in the caller's team. Otherwise `setStatus` returns `null`.
  - The value must exactly match one of `To Do`, `In Progress`, or `Done`, including case and spacing. Any other value throws `TaskValidationError` before anything is written, so the task stays unchanged.
  - Any member may change any task's status. There is no role or ownership check (FR-012).
  - It returns the updated task in the `view` form.
- Any status can move to either of the other two, so there is no workflow order to enforce.

### Changes to earlier tests

- `tests/store.test.js`: `updateTaskStatus` was added to the exact list of store operations. The check that nothing can delete is unchanged.
- `tests/tasks.test.js`: the list of service operations now includes `setStatus`.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| Status can move from each of `To Do`, `In Progress`, and `Done` to either of the other two, and the change is persisted | `status moves from each value to either of the other two, and each change is persisted`: all six transitions are made by a member who did not create the task, and each is read back through a separate store connection. Title, description, and assignee are checked to be unchanged |
| Any other status value is rejected and leaves the task unchanged | `any other status value is rejected and leaves the task unchanged`: unknown words, wrong case, extra spaces, an empty value, null, and non-text values |
| (Safety) The store refuses unknown statuses on its own | `the store also refuses an unknown status` |
| (Safety) Missing tasks and unknown callers | `missing tasks return null and unknown callers are refused` |

### Test run

`node --test`: 39 tests, 39 pass, 0 fail.

### Notes for review

- Setting a task to the status it already has is allowed and changes nothing. The issue does not cover this case.

## ISS-008 — Task service: set or clear assignee

Source: C-003. Depends on ISS-005 and ISS-003. ISS-007 was merged in PR #38 (merge `8471f7dea5265337a94e84121659742900fe65a8`), and its baseline record is PR #39.

### Design

- `src/store.js` gains `updateTaskAssignee(id, assigneeId)`. It rewrites only `assignee_id`, either to one member id or to `null`, and returns the updated row, or `null` for an unknown task. Anything that is not an integer or `null` is refused, and the foreign key refuses unknown members.
- `src/tasks.js` gains `setAssignee(memberId, taskId, assigneeId)`.
  - The caller must be a known member, and the task must be in the caller's team. Otherwise `setAssignee` returns `null`. A member of another team therefore cannot see or change the task.
  - `assigneeId === null` clears the assignee, so the task shows as unassigned.
  - Any other value must be the id of a member in the assignable set returned by the ISS-003 directory (`forMember(callerId).members`). That set is the caller's team, which is also the task's team. Anything else throws `TaskValidationError` before anything is written, so the task stays unchanged. This covers members of other teams, unknown ids, ids written as text, arrays, and objects.
  - A task has exactly one assignee or none. A list of several ids is rejected (multiple assignees are excluded).
  - Any member may assign or clear any task, including assigning it to themselves. There is no role or ownership check (FR-012).
  - It returns the updated task in the `view` form.

### Changes to earlier tests

- `tests/store.test.js`: `updateTaskAssignee` was added to the exact list of store operations. The check that nothing can delete is unchanged.
- `tests/tasks.test.js`: the list of service operations now includes `setAssignee`.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| A task's assignee can be set to exactly one member of the same team, and the change is persisted | `the assignee can be set to exactly one team member, and the change is persisted`: different callers set different assignees, including themselves, and each change is read back through a separate store connection. Title, description, and status are checked to be unchanged |
| A task's assignee can be cleared to unassigned, and the change is persisted | `the assignee can be cleared to unassigned, and the change is persisted` |
| An assignee id that is not a member of the task's team is rejected and leaves the task unchanged | `an assignee that is not a member of the task's team is rejected and leaves the task unchanged`: a member of another team, unknown ids, non-integer values, and arrays with one or two ids |
| (Safety) The store refuses bad values on its own | `the store refuses non-id assignees and unknown members` |
| (Safety) Missing tasks, other teams' tasks, and unknown callers | `missing tasks return null and unknown callers are refused` |

### Test run

`node --test`: 44 tests, 44 pass, 0 fail.

### Notes for review

- To test a member who is outside the task's team, the test creates a second team directly in the store. `add-member` still never creates a second team, and the FR-013 guard still passes.
- The ISS-005 list test still sets its assignee directly in the database. I left it as it was so that this PR does not change an earlier issue's test.

## ISS-009 — Web UI: sign-in and sign-out pages

Source: C-001. Depends on ISS-004. ISS-008 was merged in PR #40 (merge `53ffd53211f8fe7c5b6555b354fc2741cce38007`), and its baseline record is PR #41.

### Design

- The pages are plain server-rendered HTML forms with no client-side JavaScript, so they work in any standard browser (FR-017, NFR-002).
- `src/html.js` holds the shared helpers:
  - `escapeHtml` escapes all user text before it is shown.
  - `page` is the common layout. Every signed-in page shows "Signed in as <name>" and a visible **Sign out** button, which is a `POST /logout` form.
  - `sendHtml` sends a page with security headers: a Content-Security-Policy with `default-src 'none'`, `form-action 'self'`, and `frame-ancestors 'none'`, plus `nosniff`, `Referrer-Policy: same-origin`, and `no-store`.
- `src/web.js`: `createWebApp({ store, secureCookies, routes })` connects the real `loginPage` and the signed-in pages to the ISS-004 `createApp`, so every page except sign-in sits behind the session gate.
  - `GET /login` shows a username and password form that posts to `/login`.
  - A failed sign-in shows the same form again with "Incorrect username or password." and status 401.
  - A successful sign-in redirects to `/`. For now `/` is a simple signed-in home page. ISS-010 adds the task pages.
- There is no registration route, page, or link. Accounts can only be created with `add-member` (FR-013). A signed-out request for `/register` or `/signup` goes to sign-in like any other page. A signed-in request gets 404.
- `src/server.js` lets a person run the app locally in a browser: `node src/server.js --db <path> [--port 3000] [--host 127.0.0.1] [--secure-cookies]`. It is a local entry point only. Nothing is deployed.

### Acceptance mapping

| Acceptance clause | Test |
|---|---|
| A member can open the sign-in page in a standard browser | `the sign-in page is an HTML form a standard browser can submit, with no registration link`: an HTML document with a POST form, a username field, a password field, and a submit button, and no script |
| A member can sign in, and sign out with a visible control | `a member signs in, sees a visible sign-out control, and signs out` |
| No registration page or link exists | `the sign-in page is an HTML form…` (no registration wording on the page) and `no registration page exists, even when signed in` (404 for `/register`, `/signup`, `/sign-up`, and `/members/new`, and no member is created) |
| Requesting any task page while signed out leads to the sign-in page | `requesting any task page while signed out leads to the sign-in page`: `/`, `/tasks`, `/tasks/new`, `/tasks/1`, and `/tasks/1/edit` redirect to `/login`, and POST requests get 401 |
| (Safety) A failed sign-in gives no session | `wrong credentials show the sign-in page again with an error and no session` |
| (Safety) User text is escaped | `member names are HTML-escaped` |
| (Runnable) The server command works | `the server command starts and serves the sign-in page` |

### Test run

`node --test`: 51 tests, 51 pass, 0 fail.

### Notes for review

- The tests check the HTTP responses and the HTML a browser would receive. They do not drive a real browser, because the sandbox has no browser and no network. A person should open the pages once in a real browser before release.
- The failed sign-in page does not fill the username back in. The ISS-004 `loginPage` hook only reports whether sign-in failed.
