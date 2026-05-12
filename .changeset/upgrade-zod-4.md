---
"ornn-api": patch
---

Upgrade `zod` 3 → 4 across the workspace. Three mechanical breaking-change fixes: `z.record(X)` → `z.record(z.string(), X)`, `invalid_type_error` constructor option → `error` callback, and a one-line type bridge for `zod-to-json-schema` while the upstream package catches up to v4. No runtime behaviour change.
