---
description: Load approved reusable guidelines before analysis, elicitation, or SRS drafting. Use at the start of every substantive specification turn.
---

# Load knowledge

The approved corpus is at `/workspace/knowledge`.

1. Read `/workspace/knowledge/manifest.json`.
2. If `status` is not `approved`, stop and tell the operator the corpus is not approved.
3. Ignore sources whose status is `superseded`.
4. Read the guideline files for the task. For an SRS, read structure, quality, traceability, and precedence.
5. Read a source snapshot only when a guideline is ambiguous. Do not load every source by default.
6. When reusable sources share a priority and conflict, report the conflict. Do not merge them.
7. Numeric priority applies only among reusable guidelines. It does not outrank the project TOR.

Do not treat Slack attachments as knowledge. Do not modify anything under `/workspace/knowledge`.

If the person asks for provenance, give the human-readable source title and origin from the manifest.
