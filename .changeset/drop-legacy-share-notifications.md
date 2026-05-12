---
"ornn-api": patch
---

Drop legacy `share.*` notifications on boot. PR #198 removed the share/audit-gate workflow but pre-#198 notification rows still surfaced via `GET /api/v1/notifications` with dead deep-links into the removed `/shares/*` route tree. A new idempotent boot migration deletes any notification whose category is not in the current allowed set.
