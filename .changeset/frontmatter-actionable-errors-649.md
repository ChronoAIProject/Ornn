---
"ornn-api": patch
---

Frontmatter validation errors now tell the user what to fix (#649).

The Free / ZIP upload page already shows clear actionable messages for most validation failures (`version` semver rule, tag-regex rule, env-var UPPER_SNAKE_CASE rule), but the `tag`, `runtime`, `tool-list`, `runtime-env-var`, and `runtime-dependency` *item* schemas surfaced as bare `Invalid input: expected string, received null` when an author hit common YAML mistakes:

- `tag: - ` (empty list-item dash) → YAML parses as `null`
- `version: 0.1` (unquoted) → YAML parses as a number — already addressed in an earlier pass; pinned with a test here so it can't regress.

Fix is additive: each item schema gains a Zod 4 `error` callback that handles `invalid_type` with a clear sentence including a concrete shape example (`tag: [my-tag]`, `runtime: [python]`, `runtime-env-var: [OPENAI_API_KEY]`, etc.). The existing `min`/`max`/`regex` messages still fire for non-null shape problems.

Pinned with a new `skillFrontmatter.test.ts` — 8 assertions covering version-quoting, null-tag, uppercase-tag (regex preservation), null-env-var, null-runtime, null-tool, null-dependency, and a happy-path round trip.
