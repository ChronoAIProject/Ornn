---
"ornn-web": minor
---

Surface automatic GitHub source-sync status in the UI (#1178): the skill detail page now shows a passive badge driven by the source's drift state — "Auto-synced", "Update in progress", "Upstream changed — version not bumped" (warning), or "Source unavailable" (error) — next to the existing "Synced from GitHub" chip and in the advanced GitHub-link panel, so owners see what auto-sync did without polling. The `skill.auto_synced` / `skill.auto_sync_failed` / `skill.source_broken` notifications render with proper labels, and opening a skill opportunistically refreshes a stale drift state once (no polling loop). The GET skill response now includes the drift fields that drive this (ornn-api).
