---
---

Codecov integration + coverage badge (#471). CI now runs `bun test --coverage` (per-workspace lcov) and `pytest --cov` (sdk/python coverage.xml) and uploads both via `codecov/codecov-action@v4` — separate `bun` / `python` flags so a regression in one language is obvious. New `codecov.yml` commits to a realistic 70% project / 80% patch target and excludes the four god-files awaiting decomposition (SkillDetailPage, DocsPage, PlaygroundPage, bootstrap.ts) so the headline number reflects code that's reasonably testable today. README gains the Codecov badge.
