---
"ornn-api": minor
---

The public skill mirror repo now doubles as a Claude Code plugin marketplace. Each sync publishes a root `.claude-plugin/marketplace.json` catalogue plus a per-skill `.claude-plugin/plugin.json`, kept in lockstep with every public skill — add, remove, privatise, or version-bump a skill and the marketplace follows. Claude Code users can now `/plugin marketplace add <owner>/<repo>` and install Ornn skills directly, with no change to Ornn's model-agnostic registry, API, or permissions.
