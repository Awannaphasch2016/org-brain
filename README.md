# wewebplus-software-factory

Prototype 1 of the Software Factory: one Eve Specification Agent. It turns a frozen Terms of Reference into an elicited, validated Software Requirements Specification and opens a GitHub pull request for a person to review. The agent does not merge.

The workspace layout is `agents/specification/` so a later Factory Agent can be added beside it. There is no root `agent/` directory.

## Slack

The agent is a workspace member, so its public routes are under `/eve/specification/v1/*`.

- Events and interactivity: `https://wewebplus-software-factory.vercel.app/eve/specification/v1/slack`
- Health: `https://wewebplus-software-factory.vercel.app/eve/specification/v1/health`

The app manifest is `docs/slack-app-manifest.yaml`. Direct messages are disabled in code. The only allowlisted channel is `C0CG6SG8PNW` and the only allowlisted user is `U0CFRUV378D`. An empty allowlist denies everyone. The channel never uses `{ auth: null }`.

## Environment

Secrets stay in the host environment. None are required to install, typecheck, verify knowledge, or run `pnpm build` (that command skips sandbox snapshot preparation). A deployable snapshot is `pnpm build:release`, which Vercel runs with its own credentials.

| Variable | Purpose |
| --- | --- |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Portable Slack credentials. Do not set these together with `SLACK_CONNECTOR`. |
| `SLACK_CONNECTOR` | Vercel Connect Slack connector UID. |
| `GITHUB_TOKEN` | Fine-grained PAT for the authored GitHub tools. |
| `GITHUB_CONNECTOR` | Optional GitHub App via Vercel Connect (`principalType: "app"`). Used instead of the PAT when set. |
| `GITHUB_REPOSITORY` | `owner/repo`. Defaults to `Awannaphasch2016/wewebplus-software-factory`. |
| `SPECIFICATION_AGENT_MODEL` | Model override. Default `anthropic/claude-opus-5.5`. |
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

`projects/task-tracker-lite/docs/tor.md` is frozen baseline TOR-001. `project.yaml` stores its SHA-256. The attached plan requires that text verbatim from brief section 11, and that section was not in the plan or the other source documents. This file follows the plan's TOR skeleton and the facts the plan states the sample contains: baseline TOR-001, external customer access out of scope, implementation deferred, and no decision on permissions, statuses, cross-user edits, reassignment, or persistence acceptance.

## Still outside this change

Linking the Vercel project, installing Slack and GitHub credentials, deploying, the live Slack and sandbox smoke, and the manual Task Tracker Lite end-to-end test remain for the deployment tasks. `project.yaml` records the TOR SHA-256. Its `tor.gitCommit` stays null until the introducing commit is on `main`.
