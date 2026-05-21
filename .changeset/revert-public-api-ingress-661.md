---
---

Revert the direct ornn-api Ingress shipped in #661.

The Ingress added a second public surface for `ornn-api` that bypassed the NyxID proxy. That contradicts the deployment rule that **every public request to ornn-api must be proxied by NyxID** — there is no separate public ingress for the Ornn backend, by design.

The anonymous-browse gap that motivated #467 belongs on the NyxID side, not here. Tracked as **NyxID#610 — "feat: Anonymous endpoints for admin services"**, which is the proper architectural fix: NyxID's proxy gains per-(method, path) opt-in anonymous access for admin services (ornn-api is the motivating case in that issue's body), with per-endpoint daily quota and admin API + UI + MCP transport + CLI surfaces.

Removing the manifest and its changeset from this repo so prod never picks it up.
