---
---

Python SDK only: `SkillSummary`/`SkillDetail` now key the skill identifier on the real wire field `guid` (with a legacy `id` fallback) instead of a nonexistent `id` field, which made `search()`/`get()`/`publish()`/`update()` raise `KeyError: 'id'` on every real API response. No npm package version bump — the Python SDK has a separate release cadence. (#1012)
