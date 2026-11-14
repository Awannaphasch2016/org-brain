# wewebplus-software-factory

Six Eve agents, one per Software Factory stage. Each opens a GitHub pull request. The model tools never merge. A merge happens only in the Slack gate, and only when a recorded human approval matches that pull request and commit.

| Prototype | Agent | Role |
| --- | --- | --- |
| 1 | Specification | Turns a frozen Terms of Reference into an elicited, validated Software Requirements Specification. |
| 2 | Architecture | Drafts an architecture from an approved SRS baseline. |
| 3 | Planning | Turns that architecture into a feature-issue plan. GitHub issues are created only after a person merges the plan. |
| 4 | Implementation | Implements one feature issue and opens a pull request after the allowlisted tests pass. |
| 5 | Change control | Reviews implementation feedback against the frozen TOR and the approved SRS. A contradiction is rejected and the TOR is not edited. |
| 6 | Release | Records release verification in a pull request. It does not deploy the application. |

The workspace layout is one Eve agent per stage under `agents/`. `agents/factory/` is reserved and is not implemented. Routes, permissions, and stage notes are in `docs/prototypes/README.md`.

## Slack

The installed Slack app is the Specification Agent. Its public routes are under `/eve/specification/v1/*`.

- Events and interactivity: `https://wewebplus-software-factory.vercel.app/eve/specification/v1/slack`
- Health: `https://wewebplus-software-factory.vercel.app/eve/specification/v1/health`

The app manifest is `docs/slack-app-manifest.yaml`. Direct messages are disabled in code. The only allowlisted channel is `C0CG6SG8PNW` and the only allowlisted user is `U0CFRUV378D`. An empty allowlist denies everyone. The channel never uses `{ auth: null }`.

The other agents serve `/eve/architecture/v1/slack`, `/eve/planning/v1/slack`, `/eve/implementation/v1/slack`, `/eve/change-control/v1/slack`, and `/eve/release/v1/slack`. One Slack app has one event URL and one interactivity URL. This repository does not add a shared Slack router. Every agent's channel imports the same gate handler (`lib/slack-gate.ts`), so a click is handled by whichever of those URLs the Slack app currently points at. A single router in front of all six agents is the direction for later work.

Gate buttons are Approve, Reject, and Request revision. Plain code renders only the actions that are valid for the stage. The default approver is Slack user `U0CFRUV378D`. That id is a starting value only: the owner must verify it is Anak's current Slack user id before relying on it. Override it with `FACTORY_GATE_APPROVER_IDS`. An empty approver list allows nobody. A bot or assistant click does not count. Phase 1 TOR uploads, when that flow lands, are text only (`.md` or `.txt`) up to 1 MB. That default is overridable later; this change does not accept PDF or DOCX.

## Environment

Secrets stay in the host environment. None are required to install, typecheck, verify knowledge, or run `pnpm build` (that command skips sandbox snapshot preparation). A deployable snapshot is `pnpm build:release`, which Vercel runs with its own credentials.

| Variable | Purpose |
| --- | --- |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Portable Slack credentials. Do not set these together with `SLACK_CONNECTOR`. |
| `SLACK_CONNECTOR` | Vercel Connect Slack connector UID. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | Preferred GitHub identity. Our GitHub App. The private key is a PEM and stays in the host environment. All three are required together. |
| `GITHUB_CONNECTOR` | Optional GitHub App via Vercel Connect (`principalType: "app"`). Used when the app env above is not set. |
| `GITHUB_TOKEN` | Personal-token fallback for the authored GitHub tools. It remains until the GitHub App is verified. |
| `FACTORY_REQUIRE_APP` | Set to `1` to refuse the personal-token fallback. |
| `FACTORY_GATE_APPROVER_IDS` | Comma-separated human Slack user ids (`U…`) allowed to approve. Unset uses `U0CFRUV378D`, which the owner must verify. An empty or invalid list allows nobody. |
| `FACTORY_GATE_DENY_SLACK_IDS` | Slack user ids that never count, even if they are also listed as approvers. |
| `FACTORY_REQUIRED_CHECK` | Exact GitHub check name that must be green before a merge. Unset pins `check`. Every check run on that commit must be completed and successful. |
| `GITHUB_REPOSITORY` | Required `owner/repo`. The tools refuse to guess. This repository is `Awannaphasch2016/org-brain`. |
| `SPECIFICATION_AGENT_MODEL` | Model override for the Specification Agent. Default `anthropic/claude-opus-5.5`. Architecture, planning, implementation, change control, and release fall back to this value unless `ARCHITECTURE_AGENT_MODEL`, `PLANNING_AGENT_MODEL`, `IMPLEMENTATION_AGENT_MODEL`, `CHANGE_CONTROL_AGENT_MODEL`, or `RELEASE_AGENT_MODEL` is set. |
| `VERCEL_OIDC_TOKEN`, team id, project id | Sandbox and AI Gateway. Supplied on Vercel. |

## Commands

```bash
pnpm install
pnpm verify:knowledge
pnpm prepare:knowledge
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

`pnpm verify:source-immutability -- origin/main` rejects modifications of an existing knowledge snapshot.

In eve `1.0.0-rc.7`, `glob` and `grep` are opt-in, so this agent exports them. `no_reply` is included so a followed Slack thread can stay silent when a message is not for the agent.

## Knowledge approval

The reusable corpus is approved. `knowledge/manifest.json` records `approvedBy` as `Coding Agent on behalf of Anak Wannaphaschaiyong (U0CFRUV378D)` and states the delegation in `approval.delegation`. Reference PDFs are stored as extracted text plus `provenance.json` only.

## Sample project

`projects/task-tracker-lite/docs/tor.md` is frozen baseline TOR-001, copied verbatim from the owner's brief. `project.yaml` stores its SHA-256. `tor.gitCommit` is `33df89bb531e635f8fea2f751d9559c15c3a4065`, the commit that introduced those TOR bytes.

## Still outside this change

Linking the Vercel project, installing Slack and GitHub credentials, deploying, the live Slack and sandbox smoke, and the manual Task Tracker Lite end-to-end test remain for the deployment tasks. `project.yaml` records the TOR SHA-256 and `tor.gitCommit`.
