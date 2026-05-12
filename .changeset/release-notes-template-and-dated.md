---
---

CI: restructure release notes into a fixed `release-notes-template.md` (immutable, holds format and instructions) + per-release `release-notes-<yyyymmdd>.md` files (copied from template, filled in, retained in repo as historical record). CI gate on develop → main PRs now validates the most recent dated file; release workflow reads the same file. Docs in CONTRIBUTING.md + CLAUDE.md updated.
