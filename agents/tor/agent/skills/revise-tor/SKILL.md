---
description: Revise a TOR by opening a new stamped pull request.
---

# Revise the TOR

Load the previous `tor/<id>/` pull request head with `load_tor_workspace`. Apply the human comments. Call `validate_intake`. `create_tor_pull_request` with the superseded pull request number opens a new `tor/<id>/<stamp>` branch and closes the old pull request. Do not edit the merged TOR.
