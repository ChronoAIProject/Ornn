---
"ornn-api": minor
"ornn-web": minor
---

Skillset owners can now opt in to exporting a skillset as ONE curated multi-skill Claude Code plugin in the public mirror repo. When a skillset is all-public (every member skill public) and the owner toggles "Export as a Claude Code plugin", the next mirror sync publishes it under `skillsets/<name>/` — a `.claude-plugin/plugin.json`, each member under `skills/<member>/`, and a README carrying the master prompt, member list, and install snippet — and adds it to the same root marketplace.json alongside the per-skill plugins. Users can then `/plugin install <skillset>@ornn-skills`. The plugin's version is fingerprinted from the resolved member set, so a member skill's new version (including via a moving `@latest` ref) changes the version string and Claude Code picks up the update — without spurious churn for pinned or unchanged sets. The skillset detail page shows the install commands once exported. This is the second export layer on top of the per-skill plugins; Ornn stays the model-agnostic registry of record.
