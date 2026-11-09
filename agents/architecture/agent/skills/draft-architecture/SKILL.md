---
description: Draft an architecture from an approved SRS, with component ids, SRS sources, and a baseline hash. Use after the SRS baseline is loaded.
---

# Draft architecture

Write `docs/architecture.md` with these level-1 sections: Introduction, Constraints, Components, Interfaces, Data, Decisions and deferrals, Traceability.

Each component is `### C-001` and has a `Source` line citing an `FR-nnn` or `NFR-nnn` from the approved SRS. Include `SRS baseline: <sha256>`.

Do not add capabilities the TOR or SRS exclude. Leave implementation choices in Decisions and deferrals unless an approved decision already made them.

Then call `validate_architecture`. Do not open a pull request when validation fails or when the input was a fixture.
