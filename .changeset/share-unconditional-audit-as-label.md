---
"ornn-api": minor
"ornn-web": minor
---

refactor: share is unconditional, audit is a passive risk label (#197).

`PUT /api/v1/skills/:id/permissions` now applies the requested allow-list as-is — no `AUDIT_REQUIRED`, no waiver flow, no reviewer queue. The whole `shares/` domain (api) + share UI pages / hooks / services (web) are deleted.

Audit completion now fans out two notification categories:

- `audit.completed` — owner, every audit (different copy for `green` vs `yellow`/`red`).
- `audit.risky_for_consumer` — every consumer of a `yellow`/`red` audited skill (`sharedWithUsers` plus every org member resolved via NyxID).

`NotificationCategory` is trimmed to those two values and `NyxidOrgsClient.listOrgMembers` (SA token) is wired so the audit pipeline can expand org grants to their membership.

Deploy note: the `share_requests` collection should be dropped from MongoDB on the next deploy. No backwards-compat preserved.
