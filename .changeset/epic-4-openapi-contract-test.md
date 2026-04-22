---
"ornn-api": patch
---

Epic 4: OpenAPI contract test (part of #72).

New `ornn-api/src/openapi/specBuilder.test.ts` asserts structural invariants on the generated spec:

- `paths` is a non-empty record.
- `openapi` declares a version ≥ 3.x.
- `info` block has `title` and `version`.
- Every path item has ≥1 HTTP method.
- Every defined operation (get/post/put/patch/delete) has a populated `responses` map.
- Every operation declares at least one 2xx success code.

50 generated tests, one per path × method. New endpoints added without a spec entry — or spec entries missing `responses` / success codes — fail CI immediately.

Not a deep conformance check against handler behavior. Run-time route ↔ spec verification needs the integration-test layer (still tracked in #72, separate follow-up).
