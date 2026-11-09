# Prototypes

Each stage is its own Eve workspace agent. `agents/factory/` is reserved and is not implemented.

| Prototype | Agent | Slack route |
| --- | --- | --- |
| 1 | `specification` | `/eve/specification/v1/slack` |
| 2 | `architecture` | `/eve/architecture/v1/slack` |
| 3 | `planning` | `/eve/planning/v1/slack` |

Eve gives every workspace member its own route. One Slack app has one event URL, so the installed app stays on the specification route until a separate app, or a future router, points at another agent. Signing secrets and the allowlist can be reused. No new bot scopes are required for Prototype 2.
