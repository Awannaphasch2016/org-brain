---
description: Ask an approver for final person-day figures and record the answer as a PEL entry.
---

# Ask for estimates

Call `ask_question` for every final figure. Store the answer as `PEL-nnn` with `field`, `value`, `responder`, `timestamp`, and `resolution: approved` only when the responder is the pinned gate approver `U0CFRUV378D`. Otherwise use `resolution: input`.
