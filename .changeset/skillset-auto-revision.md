---
"ornn-api": minor
"ornn-web": minor
---

Skillsets now carry a single, auto-managed revision instead of an owner-typed version plus a `+sk` plugin fingerprint. Create starts at `1.0`; every owner edit bumps the minor, and a member skill resolving to a higher version auto-cuts the next revision (with a reproducible lockfile-like snapshot of the resolved member versions) and re-exports the plugin. The exported Claude Code plugin's version now equals the skillset revision — plugin.json and the marketplace entry always agree, with no fingerprint suffix. The create/publish form no longer asks for a version, and the detail page shows the revision read-only. Existing skillsets keep their current version as the starting revision and are backfilled with a snapshot on boot.
