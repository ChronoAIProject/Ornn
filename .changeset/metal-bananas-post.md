---
---

Sync PR now lands as a real merge commit instead of squashing. The auto-merge step calls the GitHub merge API directly with `merge_method: merge` rather than relying on `gh pr merge --merge` (which falls back to the repo default, often squash). A squash-merged sync creates an orphan commit on develop that doesn't reference main's bump commit — merge-base walks back past it and every later `develop → main` PR shows a phantom version-bump diff. Merge-commit strategy gives develop two parents so histories stay joined. Sync PR body also updated with a bright warning for manual-merge cases.
