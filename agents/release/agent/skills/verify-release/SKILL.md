---
description: Check verification evidence and prepare a release record that does not deploy the application.
---

# Verify a release

Confirm tests passed and the implementation baseline is named. The unchanged-TOR check compares `docs/tor.md` at the approved baseline with `tor.baseline.sha256`. Do not pass your own opinion of whether the TOR changed. Write `docs/release-verification.md` with `Deployment: not executed`.

Do not call a hosting API. `deploy_application` records that deployment is disabled. A person must approve that tool call, and the call still sends no request. Do not open a project pull request from a fixture.
