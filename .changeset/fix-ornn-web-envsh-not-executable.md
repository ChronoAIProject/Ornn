---
"ornn-web": patch
---

Fix ornn-web crash on first deploy after the URL consolidation in #295. `15-derive-nyxid-api-host.envsh` shipped without exec bit, so the nginx entrypoint silently skipped it (it sources `*.envsh` only when executable), `NYXID_API_HOST` never got exported, and nginx refused to start with `unknown "nyxid_api_host" variable`. Added the missing `chmod +x` in the Dockerfile.

Closes #296.
