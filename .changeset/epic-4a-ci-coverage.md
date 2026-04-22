---
"ornn-api": patch
---

Epic 4a: CI coverage + backend typecheck gate (part of #72).

### CI changes

- **Root `typecheck` now covers both packages.** Split into `typecheck:api` and `typecheck:web`; the top-level `typecheck` script runs both sequentially. CI's existing `typecheck` job now also typechecks `ornn-api` — previously backend type errors could ship silently.
- **New `docker-build` CI job.** Builds both `ornn-api` and `ornn-web` Docker images on every PR with placeholder build args. Dockerfile breakage surfaces immediately instead of at deploy time.

### Backend type errors cleared (was 13 pre-existing → 0)

Enabling backend typecheck in CI meant every pre-existing error had to be fixed first:

- `clients/nyxid/auth.test.ts` — cast `mockFetch.mock.calls[0]` through `unknown`.
- `domains/admin/activityRepository.ts` — generic `Collection<ActivityDocument>` so `_id: string` is accepted by `insertOne`.
- `domains/admin/routes.ts` — `String(d._id)` instead of the unsafe `as string` cast.
- `domains/skills/crud/repositories/skillRepository.test.ts` — broaden mock `findOne` return type so tests can override with skill docs via `mockResolvedValue`.
- `domains/skills/crud/utils/skillPackageBuilder.ts` — re-wrap `tarBuffer` as `new Uint8Array(tarBuffer)` so TS 6's tightened `Bun.gzipSync` signature accepts the ArrayBuffer-backed buffer.

### Dead code removal

- Deleted `ornn-api/src/domains/skills/search/middleware/apiKeyMiddleware.ts` and its `.test.ts`. The middleware was never mounted anywhere (four grep hits: the file itself, its test, the auth client it imported, and the shared type `ApiKeyInfo`). The `ApiKeyInfo` type stays — still used by `clients/nyxid/auth.ts`.

### CLAUDE.md

Updated the Docker policy note: the policy is now CI-enforced (was tagged as not enforced).
