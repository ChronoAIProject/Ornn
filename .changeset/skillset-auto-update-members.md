---
"ornn-api": minor
"ornn-web": minor
---

Add a per-skillset "always keep skills in this skillset up to date" toggle (#1191). When enabled, every member — pinned or not — resolves to its skill's latest version everywhere the set is delivered (closure, plugin export, snapshot, derived visibility), so a member's new version flows into the skillset (and its exported Claude Code plugin) automatically with no per-member ref changes. The override is resolution-time only — the authored member refs are never rewritten, so turning it off restores the pinned behavior. Enabling immediately re-cuts the revision when a member was behind. Exposed API-first as `PUT /api/v1/skillsets/:id/auto-update` and `autoUpdateMembers` on the skillset resource, with an owner-only toggle card on the skillset detail page.
