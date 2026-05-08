---
"ornn-api": patch
---

Settings export trims each LLM provider's `models` array to operator-state fields only. The synced catalog fields (`displayName`, `firstSeenAt`, `lastSyncedAt`) — which are derived data refilled by hitting the upstream gateway via `/admin/settings/llm-providers` Sync — are no longer in the export. Operator flags (`enabledForPlayground`, `enabledForSkillGen`, `defaultForPlayground`, `defaultForSkillGen`, `removed`) stay so the export still captures the choices an admin made about which models to expose.

Closes part of #330 — keeps the export portable without dragging stale upstream catalog snapshots along.
