---
"ornn-api": minor
---

Exported skillsets now reflect member-skill changes on the mirror immediately instead of waiting up to 24h for the nightly reconcile. When a member skill publishes a new version, refreshes from GitHub, or moves a dist-tag, the mirror re-exports only the skillsets that reference that skill — rebuilding their bundled member files and bumping the plugin version fingerprint in a single commit. The same applies to a moving `@latest`/`@tag` member: Claude Code picks up the update right away. The re-export is targeted (only affected skillsets, never a full sweep) and deterministic (no commit when nothing actually changed), and a content change can never leak a non-public skillset to the mirror. Skillset transfer-ownership now also triggers a mirror reconcile, matching the skill path. The nightly cron stays as the safety net.
