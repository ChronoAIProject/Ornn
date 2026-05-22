---
"ornn-web": patch
---

Frontmatter pre-validator surfaces actionable error copy for non-string YAML values (#649).

PR #672 landed the actionable `invalid_type` callbacks on the backend Zod schema at `ornn-api/src/shared/schemas/skillFrontmatter.ts`, but the SPA carries a separate pre-upload validator at `ornn-web/src/utils/skillFrontmatterSchema.ts` that still used bare `z.string()`. The frontend gate fires first on the client, so users who uploaded a SKILL.md with `version: 0.1` (unquoted, YAML → number) still saw the unhelpful default `version: Invalid input` — the backend's friendly message never reached the page.

Mirrors the backend pattern on the frontend for the six affected fields (`version`, `tag`, `runtime-env-var`, `tool-list`, `runtime`, `runtime-dependency`). Each schema now carries an `error: (issue) => issue.code === "invalid_type" ? issueMessage({ key: "errors.frontmatter.…InvalidType" }) : undefined` callback. Six new i18n keys land in both `en.json` and `zh.json` so Chinese users see localized copy too.

Author-visible result: uploading a ZIP with `version: 0.1` now shows "version must be a quoted string — write `version: \"0.1\"` in SKILL.md, not `version: 0.1` (YAML parses the unquoted form as a number…)". Existing `versionFormat` / `tagFormat` / `envVarFormat` messages still fire for wrong-shape strings — only the wrong-type path was missing actionable copy.

Coverage: new `skillFrontmatterSchema.test.ts` pins all six `invalid_type` branches plus three regression-guard cases (string-shape errors still route through the original keys; happy path still parses).
