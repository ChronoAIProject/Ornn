---
---

New workspace package `@chronoai/ornn-sdk` — TypeScript client for the Ornn platform. Wraps `/api/v1/*` with auth injection (static token or async `getToken` resolver), response-envelope unwrapping, and typed `OrnnError` propagation. Covers search / get / listVersions / downloadPackage / publish / update / delete. Wired into the monorepo `typecheck` / `test` / `lint` scripts. Part of #31.
