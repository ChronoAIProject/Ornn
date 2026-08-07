---
"ornn-api": minor
---

Make `GET /api/v1/openapi.json` a complete, usable contract (#1214).

Two defects made the published spec unusable for client generation:

- **Every schema was empty.** `toSchema` called `zod-to-json-schema@3`, which only understands zod 3 internals and returns `{}` for a zod 4 schema *without throwing*. The document stayed structurally valid while describing nothing: `GET /skill-search` advertised `parameters: []`, and every request and response body was `schema: {}`. `toSchema` now uses zod 4's built-in `z.toJSONSchema`, so property names, types, descriptions, enums, defaults, and numeric bounds all reach the spec. Request and response schemas are generated in opposite directions, so a `.default()` field is correctly optional on the way in and required on the way out. The dependency is removed.
- **Every error response was described wrong.** Errors were documented as `application/json` wrapping the legacy `{ data, error }` envelope, but the API has emitted RFC 7807 `application/problem+json` with fields at the body root since #456. Generated clients read `error.message` and got `undefined`. All error responses now declare the real problem+json body — `type`, `title`, `status`, `detail`, `instance`, `code`, `requestId`, plus per-field `errors[]` on validation failures.

Coverage goes from 13 documented operations to all 107, including previously undocumented domains: skillsets, versions, dist-tags, closures, diffs, audit, analytics, notifications, announcements, broadcasts, quota, redemption codes, admin settings, LLM providers, `/me/*`, `/users/*`, permissions, ownership transfer, the GitHub mirror, and the K8s probes. Every operation now carries a summary, an integrator-facing description, a unique `operationId`, tags, an explicit security declaration, described parameters with schemas and examples, and its full set of error responses.

The spec is now assembled from one module per domain under `src/openapi/paths/`, deriving schemas from the same Zod definitions the handlers validate against. Contract tests enforce both directions against the booted router — no documented endpoint the API does not serve, and no served endpoint the spec does not document — with no allowlist, so the coverage gap cannot silently reopen.
