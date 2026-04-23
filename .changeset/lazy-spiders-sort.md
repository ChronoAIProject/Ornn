---
---

Release workflow redesign: `changeset-release.yml` becomes a state machine on `push: main` that (A) opens a release-bump PR when pending `.changeset/*.md` land on main, (B) tags + creates the GitHub Release + opens a sync PR back to develop when a bump was merged, or (C) no-ops. Removes the local `bun run release:prep` + `scripts/release-prep.sh` path. See CLAUDE.md §Versioning.
