---
description: Classify implementation feedback as an elaboration or a TOR contradiction, then draft an SRS update only for accepted elaborations.
---

# Review a change

Write `docs/change-review.md` with `## CR-001` items. Each item has `Feedback`, `Class` (`elaboration` or `contradiction`), `Disposition` (`accept` or `reject`), and `SRS impact`.

A request for external customer access is a contradiction and must be rejected. Do not add it to the SRS. For an accepted elaboration, revise `docs/srs.md` without dropping existing `FR-nnn` or `NFR-nnn` ids and without editing `docs/tor.md`.

Call `validate_change_review` before any pull request.
