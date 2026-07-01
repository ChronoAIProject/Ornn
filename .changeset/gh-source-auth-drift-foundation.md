---
"ornn-api": minor
---

Add the efficient-read foundation for automatic GitHub source sync (#1175): GitHub source reads can now authenticate with a service-account token (settings section `sourceSync` or `ORNN_SOURCE_SYNC_GITHUB_TOKEN`) and use ETag-conditional requests, a cheap `git/ref` HEAD-SHA drift probe, and a read-only `checkSourceDrift` that records drift state on the skill. No behavior change to existing flows — the manual refresh path simply sends an `Authorization` header when a token is configured.
