---
description: Ask only material unresolved gaps in Slack, record provenance, and escalate answers that conflict with the frozen TOR.
---

# Elicit requirements

Ask only gaps that the TOR, the approved guidelines, and earlier approved answers do not already resolve. Do not ask a question whose answer is explicit in the TOR.

Use `ask_question`. Keep questions specific, grouped, and tied to the SRS decision they affect. Several rounds are allowed.

After an answer, append a section to `docs/elicitation-log.md`:

```markdown
## EL-001

- class: requires_human
- resolution: unresolved
- question: ...
- why: ...
- answer: ...
- responder: slack:<team>:<user>
- timestamp: 2026-11-09T00:00:00.000Z
- conflictWithTor: false
```

Use the responder identity from the session. Store the timestamp in UTC.

If the answer conflicts with the TOR:

- set `class: conflict` and `conflictWithTor: true`
- do not set `resolution` to an approval
- tell the person about the conflict
- do not rewrite the TOR
- do not add the conflicting statement as a requirement

A conflict passes validation only after `resolution` is `rejected` or `escalated`. Leaving it unresolved blocks the pull request.

Do not modify reusable knowledge.
