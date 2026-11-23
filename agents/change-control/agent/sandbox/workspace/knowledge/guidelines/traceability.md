<!-- sources: srs-reference -->
<!-- priority: 100 -->

# Traceability

## Identifiers

Use these identifiers unless the project already has an approved scheme:

- Functional requirements: `FR-001`, `FR-002`, …
- Nonfunctional requirements: `NFR-001`, `NFR-002`, …
- Acceptance criteria: `AC-001`, `AC-002`, …

Three digits, unique within the document. Do not reuse a retired identifier for a different statement.

## Required links

Each functional or nonfunctional requirement has a `Source` line. Source = `IS-nnn`, with an optional `TEL-nnn` elicitation reference.

Each acceptance criterion has a `Verifies` line naming one or more existing `FR-nnn` or `NFR-nnn` identifiers.

`docs/traceability.md` is a separate table. One row per FR or NFR, plus one `N/A` row for each uncovered `IS-nnn`.

| Requirement | Source IS | Status | Reason |
| --- | --- | --- | --- |
| FR-001 | IS-001 | covered | |
| IS-002 | IS-002 | N/A | out of this release |

Status is `covered` or `N/A`. An `N/A` row needs a reason.

## Statement shape

```markdown
### FR-001

The product shall …

Source: IS-001
```

```markdown
### AC-001

…

Verifies: FR-001
```

## Revisions

Keep the identifier when the wording is clarified and the obligation stays the same. Assign a new identifier when the obligation changes. Say which identifier was superseded.
