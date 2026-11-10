---
description: Check verification evidence and prepare a release record that does not deploy the application.
---

# Verify a release

Confirm tests passed, the implementation baseline is named, and the frozen TOR is unchanged. Write `docs/release-verification.md` with `Deployment: not executed`.

Do not call a hosting API. `deploy_application` records that deployment is disabled. A person must approve that tool call, and the call still sends no request. Do not open a project pull request from a fixture.
