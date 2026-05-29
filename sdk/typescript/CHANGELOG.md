# @chronoai/ornn-sdk

## 0.3.0

### Minor Changes

- [#645](https://github.com/ChronoAIProject/Ornn/pull/645) [`17cd5d2`](https://github.com/ChronoAIProject/Ornn/commit/17cd5d22a0f6b65a5714e2708b05cfadf2b321c2) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Cursor pagination on `/skill-search` per CONVENTIONS.md §4.3 + SDK auto-pagination iterator ([#457](https://github.com/ChronoAIProject/Ornn/issues/457) + [#465](https://github.com/ChronoAIProject/Ornn/issues/465)).

  **API (`/api/v1/skill-search`)**

  - Accepts `?cursor=<opaque-base64>` (alongside the existing `?page=N`). When both are sent, `cursor` wins.
  - Accepts `?limit=N` as an alias for the existing `?pageSize=N`.
  - Response now carries a `meta` envelope: `{ data: { items, total, page, pageSize, totalPages, meta: { limit, hasMore, nextCursor? } }, error }`. The legacy fields stay until they're sunset — clients can migrate at their own pace.
  - A malformed cursor returns `400 invalid_cursor` (RFC 7807 problem+json) instead of silently falling back to page 1.
  - Cursor payload is server-internal (`{ page: number }` today, `lastSort` keyset in a future PR) — clients MUST treat it as opaque.

  **SDK (`@chronoai/ornn-sdk`)**

  - `client.search()` now accepts `cursor` + `limit` params (additive).
  - New `client.searchAll({ q })` returns an `AsyncIterableIterator<SkillSummary>`. Threads `meta.nextCursor` automatically; terminates on `hasMore === false` or no more cursor. 10k-page safety cap.

  ```ts
  for await (const skill of client.searchAll({ q: "pdf" })) {
    console.log(skill.name);
  }
  ```

  **Out of scope (follow-up)**

  - Real lastSort keyset cursor under the hood — current cursor encodes `{ page }` so the wire contract conforms to §4.3 while the underlying query stays offset-based. Switching the payload is invisible to clients.
  - Cursor support on other list endpoints (categories, tags, users) — those keep their existing offset shape for now.
  - Python SDK `search_all()` — follow-up.
  - `Sunset:` header on the legacy `page`/`pageSize` shape — once cursor adoption is high enough.

- [#623](https://github.com/ChronoAIProject/Ornn/pull/623) [`d39ac3a`](https://github.com/ChronoAIProject/Ornn/commit/d39ac3aa7e73674c232eab7b1bfa6a9e4eff3773) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - **BREAKING:** drop the legacy `ownerId` field from skill responses ([#581](https://github.com/ChronoAIProject/Ornn/issues/581)). The field was a no-op back-compat mirror of `createdBy` for an old "org-as-owner" design that visibility logic no longer consults — `createdBy` + `sharedWithUsers` + `sharedWithOrgs` is the authoritative ownership model.

  Removed from:

  - `ornn-api` — `SkillDocument`, `SkillDetailResponse`, `SkillSearchItem`, repository write path, search service mapping, routes response shape. No DB migration ships; old documents keep the field in storage, code just stops reading it.
  - `@chronoai/ornn-sdk` (TypeScript) — `SkillDetail.ownerId` dropped.
  - `ornn-sdk` (Python) — `SkillDetail.owner_id` dropped; `from_dict` tolerates the field appearing on stale responses by ignoring it.
  - `ornn-web` — `SkillSearchResult.ownerId` dropped.

  Also clears three more dead exports flagged in the same issue:

  - `clients/nyxid/auth.ts` + its colocated test (the `AuthClient` was never mounted — its consumer middleware was deleted earlier).
  - `INTERNAL_AUTH_HEADER` constant + `ApiKeyInfo` interface (both only referenced by the now-deleted `AuthClient`).
  - `createErrorHandler` factory (live error handler is `app.onError` in bootstrap; the factory had no callers).

- [#625](https://github.com/ChronoAIProject/Ornn/pull/625) [`cfedcec`](https://github.com/ChronoAIProject/Ornn/commit/cfedcec05c9726d8c3f1fe8b681672ab8a78cc6b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - **BREAKING:** error responses now ship as RFC 7807 `application/problem+json` per CONVENTIONS.md §1.3 ([#456](https://github.com/ChronoAIProject/Ornn/issues/456)). The legacy `{ data: null, error: { code, message } }` envelope is gone on error paths; the fields live at the body root now:

  ```http
  HTTP/1.1 404 Not Found
  Content-Type: application/problem+json

  {
    "type": "https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#skill_not_found",
    "title": "Resource not found",
    "status": 404,
    "detail": "Skill 'foo' not found",
    "instance": "/v1/skills/foo",
    "code": "skill_not_found",
    "requestId": "req_01HXYZ..."
  }
  ```

  Success responses keep the `{ data, error: null }` envelope — only errors change.

  `buildProblemJsonBody` helper added to `shared/types/index.ts`; bootstrap and every per-domain test stub use it so wire shape can never drift between dev and CI. Both SDKs (TS + Python) and `ornn-web`'s `apiClient` parse the new shape; error tests across all three pin the new fixture.

### Patch Changes

- [#658](https://github.com/ChronoAIProject/Ornn/pull/658) [`3eeb787`](https://github.com/ChronoAIProject/Ornn/commit/3eeb7875775ca37faa823c627e6570dbead757cc) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Enable stricter TS flags across all three packages ([#450](https://github.com/ChronoAIProject/Ornn/issues/450)).

  [#450](https://github.com/ChronoAIProject/Ornn/issues/450) part 1 (`noImplicitOverride`) landed in [#638](https://github.com/ChronoAIProject/Ornn/issues/638). This PR closes the bulk of parts 2 + 3:

  - **All 3 packages now have `noUncheckedIndexedAccess: true`.** Array/object bracket access now widens to `T | undefined`, forcing explicit handling. Fix patterns by category:

    - **Length-guarded accesses** — `if (xs.length > 0)` followed by `xs[len-1]`, `findIndex` followed by `arr[idx]`. Marked `!` with a comment naming the guard. Most cases.
    - **Regex capture groups** — every `match[1]` / `match[2]` followed by a `match` check. Marked `!` with the regex-shape note.
    - **Defensive `if (!entry)` skips** — `zip.files[path]` where `path` came from `Object.keys(zip.files)`. Switched from `if (entry.dir)` to `if (!entry || entry.dir)` so a future zip-lib refactor that breaks the round-trip drops the file rather than crashes.
    - **Two non-mechanical fixes**: GenerateSkillModal.STEP_MESSAGES switched from `Record<string, string>` to `as const` (compile-time keys now return `string`, not `string | undefined`); SkillDetailPage.latestVersion now passed as `latestVersion ?? ""`.

  - **SDK only: `exactOptionalPropertyTypes: true`.** The SDK had 4 errors total; all 4 were `{ requestId: undefined }`-style fields that violated the stricter `{ requestId?: string }` contract. Fixed with conditional spread (only set the key when the upstream actually has the value).

  ### Deferred

  `exactOptionalPropertyTypes` on ornn-api (~77 errors) and ornn-web (~134 errors) — tracked as [#657](https://github.com/ChronoAIProject/Ornn/issues/657). These need per-site decisions (conditional spread vs widened field type vs constructor refactor), not mechanical fixes, so they don't fit a single-session PR.

  ### Net

  - 3 tsconfig.json files updated.
  - ornn-api: 26 files touched (68 fix sites + 1 tsconfig).
  - ornn-web: 22 files touched (57 fix sites + 1 tsconfig).
  - sdk/typescript: 3 files touched (4 fix sites + 1 tsconfig).
  - 798 backend + 110 web + 17 sdk tests all still pass.

- [#638](https://github.com/ChronoAIProject/Ornn/pull/638) [`999cea2`](https://github.com/ChronoAIProject/Ornn/commit/999cea2dd5c45ba2a9c5ba1083a65f60a9a3c89f) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Enable `noImplicitOverride` in `ornn-api`, `ornn-web`, and `sdk/typescript` tsconfigs ([#450](https://github.com/ChronoAIProject/Ornn/issues/450) part 1). Catches accidental method-signature drift during class-inheritance refactors. Only one site needed the explicit `override` keyword (`ErrorBoundary` in `ornn-web`) — zero behavior change.

  The other two flags from [#450](https://github.com/ChronoAIProject/Ornn/issues/450) (`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`) surface 68 and 75 type errors respectively across `ornn-api` alone. Per the issue's "Land in stages" guidance, those ride in their own follow-up PRs to keep the diff reviewable. Tracked as sub-tasks on [#450](https://github.com/ChronoAIProject/Ornn/issues/450).

- [#622](https://github.com/ChronoAIProject/Ornn/pull/622) [`096a103`](https://github.com/ChronoAIProject/Ornn/commit/096a103d4e5efdfb42ec490287566a9f1985bddc) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - **BREAKING** for two of the three changes — bring URL + header surface in line with CONVENTIONS.md §2/§4/§7 ([#586](https://github.com/ChronoAIProject/Ornn/issues/586)):

  1. **`PATCH /skills/:id/versions/:version` + `DELETE /skills/:id/versions/:version`** — write operations now accept the stable GUID only, not `:idOrName`. Callers passing a name should resolve it via `GET /skills/lookup?name=…` first. (§2.2)
  2. **`?q=` is the canonical search param** (§4.1). The legacy `?query=` keeps working as a fallback during the alpha grace window — `q` wins when both are present. Both SDKs and ornn-web migrated to send `q`.
  3. **Deprecation signal is RFC 8594 (`Deprecation: true` + `Link: rel="deprecation"`)** — replaces `X-Skill-Deprecated` / `X-Skill-Deprecation-Note` custom headers (§7).

  The fourth violation flagged in the issue — `/skills/:id/json` → content negotiation via `Accept` header (§3.3) — is **deferred** to a focused follow-up PR. That one rewires the playground and several SDK paths and deserves its own review.

## 0.2.1

### Patch Changes

- [#327](https://github.com/ChronoAIProject/Ornn/pull/327) [`73d624f`](https://github.com/ChronoAIProject/Ornn/commit/73d624fe0b230742277b86b4573fca7ada7ac46b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Reposition Ornn consistently as **the end-to-end skill life-cycle manager for AI agents** across every public-facing surface — landing footer tagline (EN + ZH), OpenAPI top-level description, repo README, TS + Python SDK package descriptions and READMEs.

  Also drops the Product / Developers link columns from the landing footer — every entry was already reachable from the top nav (Registry / Build / Docs / GitHub icon). Footer now carries logo + tagline + (copyright · legal links · brand string).

  Closes [#326](https://github.com/ChronoAIProject/Ornn/issues/326).
