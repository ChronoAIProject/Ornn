---
"ornn-api": minor
"ornn-web": minor
---

Skillset plugin export is now a deliberate, configurable action on the skillset detail page instead of a checkbox buried in the create/edit form. A new "Claude Code plugin" card sits directly above the visibility card: the owner clicks "Export as a Claude Code plugin", and a confirm modal lets them customise how the plugin is listed — display name, description, and keywords — each prefilled from the skillset and overridable. Once exported, the same card shows the install snippet (visible to any viewer) plus "Edit fields" and "Stop exporting" actions. Export is owner-only and still requires every member skill to be public, enforced in both the UI and a new `PUT /skillsets/:id/plugin-export` endpoint. The generated `plugin.json` + marketplace entry reflect the overrides, falling back to the skillset's own fields when unset; the install name (the skillset name) and the auto-fingerprinted version are unchanged.
