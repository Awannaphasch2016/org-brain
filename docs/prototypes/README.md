# Prototypes

Each stage is its own Eve workspace agent. `agents/factory/` is reserved and is not implemented.

| Prototype | Agent | Slack route |
| --- | --- | --- |
| 1 | `specification` | `/eve/specification/v1/slack` |
| 2 | `architecture` | `/eve/architecture/v1/slack` |
| 3 | `planning` | `/eve/planning/v1/slack` |
| 4 | `implementation` | `/eve/implementation/v1/slack` |
| 5 | `change-control` | `/eve/change-control/v1/slack` |
| 6 | `release` | `/eve/release/v1/slack` |

Eve gives every workspace member its own route. One Slack app has one event URL, so the installed app stays on the specification route until it is pointed at another agent. This repository does not add a shared Slack router. Each agent's Slack channel imports the same gate handler, and that handler serves whichever URL receives the signed click. Signing secrets and the allowlist can be reused. No new bot scopes are required for Prototype 2.
