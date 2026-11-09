---
description: Draft feature issues and their dependencies from an approved architecture. Use after that baseline is loaded.
---

# Draft feature issues

Write `docs/feature-issues.md`. Each issue is `## ISS-001` with lines `Title`, `Source` (`C-nnn` from the architecture), `Depends` (`none` or other `ISS-nnn` ids), and `Acceptance`.

Dependencies must be acyclic. Do not add work the TOR or architecture excludes. Then call `validate_feature_issues`. Do not open a pull request or create GitHub issues from a fixture.
