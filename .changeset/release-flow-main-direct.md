---
---

Release flow refactor: version bump now happens on `develop` (via `bun run release:prep`) before a `develop → main` PR. The changeset-release workflow on `main` only tags + creates GitHub Releases — it no longer tries to open a Version Packages PR, which sidesteps the org-level "Allow GitHub Actions to create and approve pull requests" restriction. No runtime code changes; tooling + CLAUDE.md only.
