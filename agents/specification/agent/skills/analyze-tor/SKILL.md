---
description: Extract a frozen TOR into objectives, scope, requirements, deliverables, acceptance, and constraints, then classify gaps. Use after knowledge is loaded and the project is hydrated.
---

# Analyze a TOR

Read `/workspace/projects/<id>/docs/tor.md` and the TOR-structure guideline. Do not hardcode gaps for any one project. Find them in the document.

Extract:

- objectives, purpose, and background
- in scope and out of scope
- high-level requirements
- deliverables and acceptance
- constraints, milestones, and responsibilities

Map each statement onto the SRS sections. Classify each detail as explicit, inferred, proposed, or unresolved.

Write `/workspace/projects/<id>/docs/_analysis.md` with a gap register in this exact shape:

```markdown
## Gap register

- G-001 | blocking | unresolved | What is missing and which SRS section it affects
```

Use `blocking` only when the SRS cannot be validated without an answer. Use `nonblocking` for a deferrable detail. Mark a gap `resolved` only after an approved elicitation item covers it.

Every SRS section needs a mapping: filled, gap, or explicitly deferrable. Do not invent implementation. Preserve exclusions.
