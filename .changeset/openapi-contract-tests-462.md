---
"ornn-api": patch
---

OpenAPI contract test pass against `buildSpec()` (#462). New `tests/contract/openapi.test.ts` pins 12 structural properties of the generated spec so it can't silently regress:

- Spec is OpenAPI 3.1 with title/version/description/servers.
- `BearerAuth` security scheme declared.
- Every declared path has at least one HTTP method.
- Every operation declares `tags`, a `summary` or `operationId`, at least one response, and at least one `2xx` response.
- Every `4xx`/`5xx` response uses `application/problem+json` (or JSON-compatible) per RFC 7807 / #456.
- Every operation outside a small `publicPaths` allowlist declares `BearerAuth` security per CONVENTIONS.md §5.
- A foundational route-coverage list (`/skills`, `/skill-search`, `/skill-format/*`, `/skill-manifest-schema.json`) MUST stay in the spec.

What's NOT in scope (tracked as follow-ups on #462):

- **Reflection over the live Hono app** to assert every registered route has a spec entry. The current spec covers ~12 of ~50 routes; closing that gap is a separate PR that needs each missing route documented with its own per-route Zod schema.
- **Cross-checking declared error codes against handler `throw` statements** — needs a static code-walker.

The infrastructure for those follow-ups is now in place. Adding a new route without spec metadata, or shipping a half-documented route, fails CI today.
