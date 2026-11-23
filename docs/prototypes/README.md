# Prototypes

23 Nov 2026: this file records the earlier per-agent Slack routes. Phase 1–3 routing now lives in the root README and `lib/orchestrator.mjs`. The live request URL is unchanged.

Each stage is its own Eve workspace agent. `agents/factory/` is reserved and is not implemented.

| Prototype | Agent | Slack route |
| --- | --- | --- |
| 1 | `specification` | `/eve/specification/v1/slack` |
| 2 | `architecture` | `/eve/architecture/v1/slack` |
| 3 | `planning` | `/eve/planning/v1/slack` |
| 4 | `implementation` | `/eve/implementation/v1/slack` |
| 5 | `change-control` | `/eve/change-control/v1/slack` |
| 6 | `release` | `/eve/release/v1/slack` |

Eve gives every workspace member its own route. Phase 1–3 messages arrive on the specification Slack URL, and the orchestrator starts the TOR, Project Planner, or Specification agent. Phase 4 and later routes remain on this page. Each agent's Slack channel imports the same gate handler. Signing secrets and the allowlist can be reused. No new bot scopes are required for Prototype 2.
