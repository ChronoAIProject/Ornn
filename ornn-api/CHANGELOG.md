# ornn-api

## 0.4.0

### Minor Changes

- [#150](https://github.com/ChronoAIProject/Ornn/pull/150) [`f94c5c4`](https://github.com/ChronoAIProject/Ornn/commit/f94c5c450052f02d49206210ebdcd985f5e930d5) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - **Breaking (operator-facing):** rename NyxID env vars to distinguish service-account credentials (ornn-api, machine-to-machine) from OAuth credentials (ornn-web, user sign-in). Same underlying OAuth concepts, clearer names end-to-end — outer `.env.ornn`, ConfigMap/Secret keys, pod env, and code reads all aligned.

  ## Rename map

  | Old                   | New                         | Used by  |
  | --------------------- | --------------------------- | -------- |
  | `NYXID_TOKEN_URL`     | `NYXID_SA_TOKEN_URL`        | ornn-api |
  | `NYXID_CLIENT_ID`     | `NYXID_SA_CLIENT_ID`        | ornn-api |
  | `NYXID_CLIENT_SECRET` | `NYXID_SA_CLIENT_SECRET`    | ornn-api |
  | `NYXID_AUTHORIZE_URL` | `NYXID_OAUTH_AUTHORIZE_URL` | ornn-web |
  | `NYXID_WEB_TOKEN_URL` | `NYXID_OAUTH_TOKEN_URL`     | ornn-web |
  | `NYXID_WEB_CLIENT_ID` | `NYXID_OAUTH_CLIENT_ID`     | ornn-web |
  | `NYXID_REDIRECT_URI`  | `NYXID_OAUTH_REDIRECT_URI`  | ornn-web |

  Unchanged: `NYXID_BASE_URL`, `NYXID_LOGOUT_URL`, `NYXID_SETTINGS_URL`.

  ## Migration

  1. Update `deployment/.env.ornn` — rename the keys per the table.
  2. Re-envsubst + kubectl apply the ConfigMap + Secret manifests.
  3. Rolling-restart `ornn-api` + `ornn-web` deployments.

  ## Cleanup

  Also drops the dead `VITE_NYXID_*` + `VITE_API_BASE_URL` build args from the `docker-build` step in `ci.yml` — PR [#117](https://github.com/ChronoAIProject/Ornn/issues/117) made config runtime-driven; those build args haven't been read from the Dockerfile for a while.

## 0.3.3

## 0.3.2

### Patch Changes

- [#142](https://github.com/ChronoAIProject/Ornn/pull/142) [`bc5157c`](https://github.com/ChronoAIProject/Ornn/commit/bc5157c7d5f545e0cc1df1da819f319aad3532c2) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Smoke test for PR [#141](https://github.com/ChronoAIProject/Ornn/issues/141) — forces a v0.3.2 patch bump so the release state machine can exercise the new direct-API merge path. After this ships, `git show` on the sync commit should list two parents and `git merge-base origin/main origin/develop` should equal `origin/main`'s HEAD.

## 0.3.1

### Patch Changes

- [#131](https://github.com/ChronoAIProject/Ornn/pull/131) [`b8fc37a`](https://github.com/ChronoAIProject/Ornn/commit/b8fc37a39d9cc1e03b3cb5aa63978bf34661fcf7) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Smoke test for the new push-to-main release workflow (PR [#130](https://github.com/ChronoAIProject/Ornn/issues/130)). This changeset forces a v0.3.1 patch bump with no functional change; it exists so State A → State B can be exercised end-to-end on a live release cycle.

## 0.3.0

### Minor Changes

- [#126](https://github.com/ChronoAIProject/Ornn/pull/126) [`2013dae`](https://github.com/ChronoAIProject/Ornn/commit/2013dae248d0f61d06d0f5e6836c0a7c28f238a4) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Authors can include release notes per version via SKILL.md frontmatter (`release-notes:` or `releaseNotes:`, plain text, capped at 2000 chars). Persisted on `SkillVersionDocument.releaseNotes`, returned from `GET /api/v1/skills/:id/versions` and both `from`/`to` sides of the diff endpoint. Closes [#26](https://github.com/ChronoAIProject/Ornn/issues/26).

- [#99](https://github.com/ChronoAIProject/Ornn/pull/99) [`4f77e60`](https://github.com/ChronoAIProject/Ornn/commit/4f77e60449d118a831b977e4b8dce0027c9dc681) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Move docs (product guides + release notes) from backend to frontend static build. `/api/docs/tree`, `/api/docs/content/:lang/:slug`, `/api/docs/releases`, `/api/docs/releases/:version` are removed; `ornn-api` no longer serves docs traffic, no longer ships `ornn-api/docs/`, and `ornn-web/nginx.conf` drops the `/api/docs/` bypass. `ornn-web` loads markdown at build time via Vite `import.meta.glob`. Closes [#40](https://github.com/ChronoAIProject/Ornn/issues/40).

- [#101](https://github.com/ChronoAIProject/Ornn/pull/101) [`3602a50`](https://github.com/ChronoAIProject/Ornn/commit/3602a507086b7ff8a3fb4409093614af15ec20e8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - M1 sprint — `/api/v1/` prefix cut (closes [#68](https://github.com/ChronoAIProject/Ornn/issues/68)), route-level React.lazy code splitting (drops initial bundle from ~2 MB to ~335 kB), and integration test harness seed under `ornn-api/tests/integration/` (part of [#72](https://github.com/ChronoAIProject/Ornn/issues/72)).

- [#121](https://github.com/ChronoAIProject/Ornn/pull/121) [`fce1074`](https://github.com/ChronoAIProject/Ornn/commit/fce1074c9a12d674b60f9772703d1233f21fdfbe) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - LLM-based skill audit engine: new `skills/audit/` domain with 5-dimension scoring (security, code_quality, documentation, reliability, permission_scope), structured JSON findings, cache-by-hash persistence, and thresholds-based verdict (green / yellow / red). Endpoints: `GET /api/v1/skills/:idOrName/audit` (read-only, respects visibility) and `POST /api/v1/admin/skills/:idOrName/audit` (manual re-audit, admin only). Share-gated trigger is a separate follow-up ([#95](https://github.com/ChronoAIProject/Ornn/issues/95)). Part of [#32](https://github.com/ChronoAIProject/Ornn/issues/32).

- [#114](https://github.com/ChronoAIProject/Ornn/pull/114) [`bb32d50`](https://github.com/ChronoAIProject/Ornn/commit/bb32d50554fd6d0075f625d342ded9b6a3b683bb) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - New endpoint `POST /api/v1/skills/generate/from-source` — generates a skill by analyzing backend source code. Accepts either inline `code` or a public GitHub `repoUrl` (optional `path` subfolder). Backend fetches a small bundle of likely route files via the GitHub contents API, auto-detects the framework (Express / Hono / FastAPI / Flask / Spring Boot / Gin / …) and streams the generation via the same SSE event vocabulary as `from-openapi`. Closes [#42](https://github.com/ChronoAIProject/Ornn/issues/42).

- [#124](https://github.com/ChronoAIProject/Ornn/pull/124) [`c00dfcd`](https://github.com/ChronoAIProject/Ornn/commit/c00dfcda2d44e3d3624907b7f6b1a637b14e7fbd) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Audit-gated skill sharing. New `shares` domain with `ShareRequest` state machine (`pending-audit → green | needs-justification → pending-review → accepted | rejected | cancelled`). Endpoints: `POST /api/v1/skills/:idOrName/share` (initiate, runs cached audit), `GET /api/v1/shares/:id`, `POST /api/v1/shares/:id/justification` (owner), `POST /api/v1/shares/:id/review` (reviewer), `POST /api/v1/shares/:id/cancel`, `GET /api/v1/shares` (caller's own), `GET /api/v1/shares/review-queue` (routed by target: user recipient / org admin / platform admin). Green audit short-circuits and applies the share immediately via `setSkillPermissions`. Part of [#94](https://github.com/ChronoAIProject/Ornn/issues/94) / [#95](https://github.com/ChronoAIProject/Ornn/issues/95) / [#96](https://github.com/ChronoAIProject/Ornn/issues/96) / [#97](https://github.com/ChronoAIProject/Ornn/issues/97). Private skills remain un-audited by virtue of never going through the share path.

- [#127](https://github.com/ChronoAIProject/Ornn/pull/127) [`63695d6`](https://github.com/ChronoAIProject/Ornn/commit/63695d6c06ddc199adc7d7e1c4b774927d73bfc6) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill analytics: new `analytics` domain with append-only `skill_executions` event log + aggregation. `GET /api/v1/skills/:idOrName/analytics?window=7d|30d|all` returns execution count, success/failure/timeout breakdown, success rate, latency p50/p95/p99, unique users, top error codes. Visibility mirrors `GET /skills/:idOrName`. Emission hook points (playground / SDK / CLI) ship as a follow-up so this PR stays read-side-focused. Closes [#34](https://github.com/ChronoAIProject/Ornn/issues/34).

- [#118](https://github.com/ChronoAIProject/Ornn/pull/118) [`be186a4`](https://github.com/ChronoAIProject/Ornn/commit/be186a4cd7b13d70c853ead001fd6364126cf2ec) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - New endpoint `GET /api/v1/skills/:idOrName/versions/:fromVersion/diff/:toVersion` returns a structured diff between two published versions: per-file added / removed / modified with SHA-256 hashes, byte sizes, and — for text files — both sides' contents (truncated at 64 KiB/side) so the UI can render any line-level diff client-side. Visibility rules mirror the canonical skill read. Part of [#26](https://github.com/ChronoAIProject/Ornn/issues/26).

- [#125](https://github.com/ChronoAIProject/Ornn/pull/125) [`6157ff8`](https://github.com/ChronoAIProject/Ornn/commit/6157ff8faff0df9f8df6a35a0da13777d6ed4f0c) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - In-product notification center. New `notifications` domain: per-user `notifications` collection + `NotificationService` with typed emitters (`notifyAuditCompleted`, `notifyNeedsJustification`, `notifyReviewRequested`, `notifyShareDecision`, `notifyShareCancelled`). Endpoints: `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/mark-all-read`. `ShareService` now emits at every status transition it drives (audit completion, justification needed, user-recipient review request, decision, cancellation). Org / public review-request fan-out is deferred — reviewers for those targets pick up work via `GET /shares/review-queue` until we add a fan-out service. Closes [#98](https://github.com/ChronoAIProject/Ornn/issues/98).

- [#115](https://github.com/ChronoAIProject/Ornn/pull/115) [`ba2f0bc`](https://github.com/ChronoAIProject/Ornn/commit/ba2f0bcee1ea6039f6ba0d6832ecacf0f3183b2b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skills can now be pulled from public GitHub repos. `POST /api/v1/skills/pull` accepts `{ repo: "owner/name", ref?, path? }`, fetches the target directory via the GitHub contents API, builds a ZIP, validates, and publishes. `POST /api/v1/skills/:id/refresh` re-pulls the stored source and publishes as a new version. Skill docs carry an optional `source` field (type `github`, with repo/ref/path/lastSyncedAt/lastSyncedCommit) that's returned on `GET /api/v1/skills/:id` when present. Closes [#57](https://github.com/ChronoAIProject/Ornn/issues/57).

### Patch Changes

- [#108](https://github.com/ChronoAIProject/Ornn/pull/108) [`d57df25`](https://github.com/ChronoAIProject/Ornn/commit/d57df25d46bfb05b2b89b1a7a5dc45fa2c31a8f1) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Integration test layer: `mongodb-memory-server`-backed harness (`tests/integration/harness.ts`) boots real `bootstrap()` with an in-memory Mongo, and `tests/integration/domainSmoke.test.ts` exercises one smoke per domain (skills, skill-search, admin, me, users, playground, skill-format) plus `/livez`, `/readyz`, `/api/v1/openapi.json`. Establishes the pattern for future per-endpoint coverage. No runtime changes. Closes [#102](https://github.com/ChronoAIProject/Ornn/issues/102).

## 0.2.0

### Minor Changes

- [#48](https://github.com/ChronoAIProject/Ornn/pull/48) [`e71085c`](https://github.com/ChronoAIProject/Ornn/commit/e71085c382b93eaa1084aff0268460df9b08763c) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Backend now decodes the `X-NyxID-Identity-Token` JWT to populate roles and permissions on the request context.

- [#49](https://github.com/ChronoAIProject/Ornn/pull/49) [`4a16a3d`](https://github.com/ChronoAIProject/Ornn/commit/4a16a3d021877ba3c26f839359099845aa36e8b5) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill generation endpoint now accepts an OpenAPI spec and produces a skill covering all documented endpoints.

- [#62](https://github.com/ChronoAIProject/Ornn/pull/62) [`db79bb5`](https://github.com/ChronoAIProject/Ornn/commit/db79bb5b1d08ec074caeccc367fd1193e0d33275) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Organization-scoped skills ([#8](https://github.com/ChronoAIProject/Ornn/issues/8)). A skill (or topic) can now be owned by a person or an organization. Org members see and manage org-owned skills; non-members see only public. Ornn consumes NyxID's org model directly — zero org data is stored in Ornn itself.

  **Data model.** New `ownerId: string` field on `SkillDocument` and `TopicDocument` — either a person `user_id` (for personal ownership) or an org `user_id` (for org-owned). `createdBy` still records the actual person-author and never changes meaning. Ownership is immutable after create.

  **Visibility.** `!isPrivate` → visible to everyone. `isPrivate` + personal → author + platform admin. `isPrivate` + org-owned → author + admins/members of that org + platform admin. NyxID's `viewer` role is treated as non-member for MVP.

  **Creation.** `POST /api/skills?targetOrgId=<org>` and `POST /api/topics { targetOrgId }` verify the caller is an admin/member of that org (fail-closed 403 `NOT_ORG_MEMBER`) before setting `ownerId`. Updates cannot change ownership.

  **Write gate.** Mutations allowed when `actor === createdBy` (author), or actor is an admin of the owning org, or actor holds `ornn:admin:skill`. Otherwise 403.

  **NyxID integration.** New `NyxidOrgsClient` calls `GET /api/v1/orgs` with the caller's own bearer token. A request-scoped middleware attaches a memoized getter so every downstream route shares a single NyxID round-trip per request. Fail-soft on reads (empty org list), fail-closed on writes.

  **Migration (required).** Run `bun run migrate:ownership` to backfill `ownerId = createdBy` on existing `skills` and `topics` documents. Idempotent.

- [#63](https://github.com/ChronoAIProject/Ornn/pull/63) [`3b81a68`](https://github.com/ChronoAIProject/Ornn/commit/3b81a68dea4adb7c9969b07c74de23d266958dc8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill registry reorganized around access scope: new 3-tab layout (Public / My Skills / Shared with me) with per-tab counts and filter chips for grant orgs/users. System-skill classification is now derived per-caller from NyxID user-service tag matches rather than stored as a dedicated field. Permissions modal redesigned into three access tiers (Public / Limited / Private) with co-equal Org + User grant channels, focus-open email picker, and chip labels that resolve to real names via a new `/api/users/resolve` endpoint. Backend write paths now read user identity from the decoded NyxID identity token instead of the X-User-\* headers that the proxy strips, fixing stale empty `userEmail`/`userDisplayName` fields that caused raw GUIDs to render in UI bylines. Theme-aware Logo component with dark/light variants and reorganized profile dropdown.

- [#61](https://github.com/ChronoAIProject/Ornn/pull/61) [`b7adc99`](https://github.com/ChronoAIProject/Ornn/commit/b7adc99c059f07dac18063c172771200e1225ec1) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill Topics ([#56](https://github.com/ChronoAIProject/Ornn/issues/56)): a new primitive for grouping skills. A `Topic` is a named, owner-curated group with its own privacy flag; skills belong to many topics via a separate `topic_skills` edge collection so neither side carries back-pointing arrays.

  **Backend.** Endpoints: `POST /api/topics`, `GET /api/topics`, `GET /api/topics/:idOrName`, `PUT /api/topics/:id`, `DELETE /api/topics/:id`, `POST /api/topics/:id/skills`, `DELETE /api/topics/:id/skills/:skillGuid`. `GET /api/skill-search` also accepts an optional `?topic=<name>` filter. Topic names are globally-unique kebab-case and immutable; visibility rules mirror skills (private topic → owner + admin only; a private skill placed in a public topic stays hidden from non-authorized viewers). Skill hard-delete cascades membership. No migration required.

  **Frontend.** New Topics tab on Registry, `/topics/:idOrName` detail page, create / edit / delete modals, add-skills picker (multi-select search across public + user's private skills), per-card remove button on the topic detail page, and a topic-filter dropdown on the Public / My Skills tabs that narrows results to a topic's members.

- [#59](https://github.com/ChronoAIProject/Ornn/pull/59) [`16a32f5`](https://github.com/ChronoAIProject/Ornn/commit/16a32f5404f66a2b38dd66c2f3c8f53f867e8608) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill versioning ([#25](https://github.com/ChronoAIProject/Ornn/issues/25)): SKILL.md requires a 2-digit `version` field; each publish snapshots an immutable row in the new `skill_versions` collection with its own storage key. New endpoints `GET /api/skills/:idOrName?version=X.Y`, `GET /api/skills/:idOrName/versions`, and `PATCH /api/skills/:idOrName/versions/:version` (deprecation toggle). Package updates enforce a strictly-greater version and reject interface-breaking changes without a major bump (409 `BREAKING_CHANGE_WITHOUT_MAJOR_BUMP`). Skill detail page adds a version picker, history list, and deprecation banner with owner/admin deprecation controls. **Requires running `bun run migrate:versions` in `ornn-api` against any pre-existing database** — see `docs/migrations.md`.

- [#50](https://github.com/ChronoAIProject/Ornn/pull/50) [`eaf33de`](https://github.com/ChronoAIProject/Ornn/commit/eaf33de3b36f0612d41756397f820c1dffbed163) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add System Skills tab in Registry, sourced from the NyxID service catalog. Supports admin table view and user card view; generates skills from service OpenAPI specs via NyxID proxy (SSRF-safe, user-token forwarded).

- [#58](https://github.com/ChronoAIProject/Ornn/pull/58) [`ff33eff`](https://github.com/ChronoAIProject/Ornn/commit/ff33effad8371b85cfac78b984eea41855d33f3a) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add "Try with Nyx CLI" button on skill detail pages — copies a NyxID-CLI-based prompt (4 steps: prerequisites check, fetch, dependency verification, execute) so users can paste into any agent to run the skill. Also brings System Skills tab to feature parity with Public/My Skills (keyword search + pagination), backed by a new searchable `/api/system-skills` endpoint.

- [#46](https://github.com/ChronoAIProject/Ornn/pull/46) [`01b4f93`](https://github.com/ChronoAIProject/Ornn/commit/01b4f9397d72607b77cac3e60b1c39f50e1f781f) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Unify API routes under `/api` prefix. All traffic now flows through NyxID proxy; JWT self-verification and `jose` dependency removed. Frontend service paths updated from `/api/web/*` to `/api/*`.

### Patch Changes

- [#82](https://github.com/ChronoAIProject/Ornn/pull/82) [`8aee18a`](https://github.com/ChronoAIProject/Ornn/commit/8aee18af17371de68b5b668f29f55d1e98912023) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1 final: group NyxID clients + extract SA-token provider (closes [#66](https://github.com/ChronoAIProject/Ornn/issues/66)).

  **Clients layout — before → after**

  ```
  clients/authClient.ts            → clients/nyxid/auth.ts
  clients/authClient.test.ts       → clients/nyxid/auth.test.ts
  clients/nyxLlmClient.ts          → clients/nyxid/llm.ts
  clients/nyxidOrgsClient.ts       → clients/nyxid/orgs.ts
  clients/nyxidServiceClient.ts    → clients/nyxid/service.ts
  clients/nyxidUserServicesClient.ts → clients/nyxid/userServices.ts
  (new)                            → clients/nyxid/base.ts
  ```

  `sandboxClient.ts` and `storageClient.ts` stay at the top level — they talk to different external services, not NyxID.

  **NyxidSaTokenProvider**

  Extracted from the inline closure in `bootstrap.ts` into a first-class class in `clients/nyxid/base.ts`. Same behavior: 24h cache with 60s early-refresh margin, OAuth2 client-credentials grant against `NYXID_TOKEN_URL`. The `getSaAccessToken` callback passed to `StorageClient` / `SandboxClient` is now a one-line wrapper around `saTokenProvider.getAccessToken()`.

  Bootstrap shrank by ~30 lines; clients layer is now self-documenting (a `nyxid/` submodule holds everything NyxID-related).

  **Closes [#66](https://github.com/ChronoAIProject/Ornn/issues/66) — Epic 1 complete.** All Epic 1 items shipped across [#67](https://github.com/ChronoAIProject/Ornn/issues/67) (Topic teardown), [#75](https://github.com/ChronoAIProject/Ornn/issues/75) (Zod config + requestId + livez/readyz + frontend bug fixes), [#76](https://github.com/ChronoAIProject/Ornn/issues/76) (CORS hardening), [#77](https://github.com/ChronoAIProject/Ornn/issues/77) (unified AppError), [#78](https://github.com/ChronoAIProject/Ornn/issues/78) (validation middleware), [#81](https://github.com/ChronoAIProject/Ornn/issues/81) (domain merge + activity move), and this PR.

  Epic 2 (API v1 cut) is the next unlock.

- [#76](https://github.com/ChronoAIProject/Ornn/pull/76) [`1a4e446`](https://github.com/ChronoAIProject/Ornn/commit/1a4e446d1c08fd7621366e2ad477970634ad4f23) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1 CORS security hardening (part of [#66](https://github.com/ChronoAIProject/Ornn/issues/66)):

  - CORS origin is now validated against an env-driven allow-list (`ALLOWED_ORIGINS`, comma-separated). Empty list denies all cross-origin requests. The previous `origin: (origin) => origin` reflection combined with `credentials: true` was a CSRF-class risk — any cross-site page could issue credentialed requests.
  - Dropped stale allow-listed request headers `X-API-Key`, `X-User-Email`, `X-User-Display-Name` — nothing on the backend read them; identity is sourced from the NyxID proxy.
  - `deployment/ornn-api/configmap.yaml` and `deployment/.env.sample.ornn` updated to pass the new variable through.
  - `deployment/ornn-api/deployment.yaml` migrated to the new K8s probes: `readinessProbe` → `/readyz` (pings Mongo, adds `timeoutSeconds` + `failureThreshold`), `livenessProbe` → `/livez`.

  **Deploy requirement**: `ALLOWED_ORIGINS` must be set in `.env.ornn` before rolling out this image, or cross-origin requests from `ornn-web` will be blocked. Empty is deny-all by design.

- [#75](https://github.com/ChronoAIProject/Ornn/pull/75) [`61a5eac`](https://github.com/ChronoAIProject/Ornn/commit/61a5eac3c4279d666b1b91c01c82ae8f8da34b9b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1 foundations (part of [#66](https://github.com/ChronoAIProject/Ornn/issues/66)):

  - **Config**: `ornn-api/src/infra/config.ts` rewritten on top of Zod. Missing or invalid env vars throw `ConfigError` with a full summary of every violation; library code no longer calls `process.exit()` (the entry point owns that).
  - **Request correlation**: new `requestIdMiddleware` generates or echoes `X-Request-ID` per request, exposes it via response header, and threads it through structured logs and the global error handler.
  - **Kubernetes probes**: split `/health` into `/livez` (liveness — no dependency checks) and `/readyz` (pings Mongo with a 2s timeout; 503 when unreachable). `/health` kept as a backward-compat alias for the liveness handler.
  - **Frontend `apiClient`**: removed dead `X-User-Email` / `X-User-Display-Name` headers (stripped by the NyxID proxy, not read by the backend). Stopped triggering token refresh on 403 responses — 403 means permission denied, not token expiry, so the previous retry path hammered the refresh endpoint on legitimate authorization failures.

- [#81](https://github.com/ChronoAIProject/Ornn/pull/81) [`7b625a5`](https://github.com/ChronoAIProject/Ornn/commit/7b625a5e2a9cef5ec95efdffb47ae28663cdf036) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1: skill-\* domain merge + activity → me move (part of [#66](https://github.com/ChronoAIProject/Ornn/issues/66)).

  **Domain layout — before → after**

  ```
  domains/skillCrud/       →  domains/skills/crud/
  domains/skillSearch/     →  domains/skills/search/
  domains/skillFormat/     →  domains/skills/format/
  domains/skillGeneration/ →  domains/skills/generation/
  ```

  Four verb-oriented sibling domains are now one resource-oriented `skills/` domain with four submodules. Matches convention §11.4. No external `/api/*` path change.

  **Caller telemetry endpoints**

  `POST /activity/login` and `POST /activity/logout` moved from `domains/admin/routes.ts` to `domains/me/routes.ts`. They were never admin operations — any authenticated user logs their own session events. The `admin` domain now only exposes `/admin/*` (admin-only permission-gated routes). Path unchanged.

  **Mechanical import updates**

  - `bootstrap.ts`: 9 import paths updated to the new `domains/skills/*` layout.
  - Cross-domain imports (from `me/`, `admin/`, `playground/chatService.ts`): `../skillCrud/*` → `../skills/crud/*`.
  - Intra-skills sibling imports: `../skillCrud/*` → `../crud/*`.
  - Every relative import inside `skills/*` that escapes the module gained one `../` (path depth increased by one).
  - `@module` JSDoc comments updated to the new paths.

  All 136 backend tests pass. Backend typecheck: 13 pre-existing errors (unchanged). Web typecheck + lint green.

- [#77](https://github.com/ChronoAIProject/Ornn/pull/77) [`7015aae`](https://github.com/ChronoAIProject/Ornn/commit/7015aaef0102299ace0fa05313ecea8e2ca2af0c) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1: unify `AppError` class (part of [#66](https://github.com/ChronoAIProject/Ornn/issues/66)).

  Previously two `AppError` classes existed — the canonical one in `shared/types/index.ts` and an inlined duplicate in `middleware/nyxidAuth.ts`. The global error handler had to fall back to duck-typing (`err.name === "AppError" && typeof err.statusCode === "number" && typeof err.code === "string"`) so errors thrown from either class were caught. A third class or subclass would silently slip past the check.

  - Delete the inlined copy in `nyxidAuth.ts`.
  - Import the canonical `AppError` from `shared/types/index`. No circular dependency (`shared/types/index.ts` has zero imports).
  - Replace duck-typing in `bootstrap.ts`'s `app.onError` with `instanceof AppError` — single source of truth, faster, and a third class would surface immediately as an unhandled error instead of being silently wrapped.

- [#78](https://github.com/ChronoAIProject/Ornn/pull/78) [`8aef202`](https://github.com/ChronoAIProject/Ornn/commit/8aef202076c38627f0aea964721f31cfa595ffc1) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1: request validation middleware (part of [#66](https://github.com/ChronoAIProject/Ornn/issues/66)).

  New `ornn-api/src/middleware/validate.ts` replaces the per-route `c.req.json() → try/catch → schema.safeParse() → throw AppError` boilerplate with declarative composition: routes receive pre-validated data via typed helpers.

  ```ts
  app.put(
    "/skills/:id/permissions",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(permissionsPatchSchema, "INVALID_PERMISSIONS"),
    async (c) => {
      const body = getValidatedBody<z.infer<typeof permissionsPatchSchema>>(c);
      // ...
    }
  );
  ```

  Routes migrated:

  - `PUT /api/skills/:id/permissions` (body)
  - `PATCH /api/skills/:idOrName/versions/:version` (body)
  - `GET /api/skill-search` (query)
  - `POST /api/playground/chat` (body)
  - `POST /api/admin/categories` (body)
  - `PUT /api/admin/categories/:id` (body)
  - `POST /api/admin/tags` (body)
  - `GET /api/users/search` (query)

  External contract preserved: each route passes its existing error code (e.g. `INVALID_PERMISSIONS`, `INVALID_DEPRECATION_PATCH`) into `validateBody` / `validateQuery`. Error responses look identical to clients. Error code catalog collapse lands in Epic 2.

  Non-JSON bodies (ZIP uploads, multipart forms) keep their bespoke parsing — the middleware is `Content-Type: application/json` only.

- [#88](https://github.com/ChronoAIProject/Ornn/pull/88) [`dd2b709`](https://github.com/ChronoAIProject/Ornn/commit/dd2b7096fb9c774ec285c1544cc1f71b811e4ab5) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 4: OpenAPI contract test (part of [#72](https://github.com/ChronoAIProject/Ornn/issues/72)).

  New `ornn-api/src/openapi/specBuilder.test.ts` asserts structural invariants on the generated spec:

  - `paths` is a non-empty record.
  - `openapi` declares a version ≥ 3.x.
  - `info` block has `title` and `version`.
  - Every path item has ≥1 HTTP method.
  - Every defined operation (get/post/put/patch/delete) has a populated `responses` map.
  - Every operation declares at least one 2xx success code.

  50 generated tests, one per path × method. New endpoints added without a spec entry — or spec entries missing `responses` / success codes — fail CI immediately.

  Not a deep conformance check against handler behavior. Run-time route ↔ spec verification needs the integration-test layer (still tracked in [#72](https://github.com/ChronoAIProject/Ornn/issues/72), separate follow-up).

- [#85](https://github.com/ChronoAIProject/Ornn/pull/85) [`75b5c2f`](https://github.com/ChronoAIProject/Ornn/commit/75b5c2f38208fc831d2ce09045d2e3762e2c391e) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 4a: CI coverage + backend typecheck gate (part of [#72](https://github.com/ChronoAIProject/Ornn/issues/72)).

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

- [#86](https://github.com/ChronoAIProject/Ornn/pull/86) [`595143c`](https://github.com/ChronoAIProject/Ornn/commit/595143cb8f9b227efe04c3def5cf8d62159f507d) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 4b: graceful shutdown timeout (part of [#72](https://github.com/ChronoAIProject/Ornn/issues/72)).

  `index.ts` now wraps `shutdown()` in a 25s deadline. K8s sends `SIGTERM` then `SIGKILL`s after `terminationGracePeriodSeconds` (default 30s). A stuck Mongo close could hang past that window, leading to dirty pod termination and non-deterministic exit codes.

  The new `gracefulShutdown(signal)`:

  - logs the received signal
  - arms a `setTimeout` with `.unref()` so it doesn't block exit when shutdown resolves early
  - awaits `shutdown()` (MongoDB close etc.)
  - on success: `clearTimeout` + `process.exit(0)`
  - on error: `clearTimeout` + log + `process.exit(1)`
  - on timeout: `logger.fatal` + `process.exit(1)`

  Exit codes are now deterministic (0 for clean, 1 for any failure or timeout) so the ops dashboard can alert cleanly on non-clean shutdowns.

  Scope note: the lint rule enforcing "routes do not import repositories directly" is deferred. All current offending imports are type-only (`import type`), which ESLint's `no-restricted-imports` can't ergonomically distinguish from value imports. Enforcing the real boundary (route handlers calling repo methods directly) requires first refactoring routes to depend on services only — separate follow-up issue.

- [#87](https://github.com/ChronoAIProject/Ornn/pull/87) [`a3a5e3e`](https://github.com/ChronoAIProject/Ornn/commit/a3a5e3ec159309d9a567422e23c9bba5e66e7361) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 4c: ESLint rule enforcing the route↛repository boundary at import time (part of [#72](https://github.com/ChronoAIProject/Ornn/issues/72)).

  `eslint.config.js` now rejects **runtime** imports of `**/repository`, `**/repositories/*`, and `**/activityRepository` from files matching `ornn-api/src/domains/**/routes.ts`. `import type { ... }` is still allowed via `allowTypeImports: true` — routes still need repo types to type their Config interfaces.

  Current state:

  - All 8 existing repo imports in route files are `import type`, so lint remains clean at introduction.
  - Any new code that does `import { SkillRepository } from ".../repository"` (runtime) inside a routes file fails CI.

  Scope note:

  - This catches the **easy** class of boundary violation (runtime repo imports).
  - The **harder** class — routes invoking methods on config-passed repo instances at runtime (e.g. `skillRepo.findByGuid()` inside a handler) — needs a custom rule or a structural refactor (push remaining direct calls into services + pass services only into route factories). Tracked as follow-up; defer until the service-layer cleanup work.

- [#74](https://github.com/ChronoAIProject/Ornn/pull/74) [`6d28281`](https://github.com/ChronoAIProject/Ornn/commit/6d2828119caba316ffa77aa128f44a21aab34a49) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Remove Topic feature entirely (Epic 1 first step of the Refactor milestone).

  - Backend: delete `domains/topics/` (5 files), remove `TopicRepository` / `TopicSkillRepository` / `TopicService` wiring from bootstrap, remove `onSkillDeleted` cascade hook from `SkillService`, remove `topic` filter from skill search.
  - Frontend: delete `pages/TopicDetailPage.tsx`, `components/topic/` (5 files), `services/topicsApi.ts`, `hooks/useTopics.ts`; remove `topic` references in search/useSkills/types/i18n.
  - Data migration: `bun run migrate:drop-topics` drops the `topics` and `topic_skills` MongoDB collections (supports optional JSON archive via `ARCHIVE_DIR`, `--dry-run`, `--no-archive`).
  - Removes 7 endpoints from `/api/*` surface. External callers were limited to `ornn-web`, which is updated in the same commit.

- [#89](https://github.com/ChronoAIProject/Ornn/pull/89) [`0572d44`](https://github.com/ChronoAIProject/Ornn/commit/0572d4498e22afdac1987536f8ba17bc7ee89076) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Update hardcoded repository URLs after transfer from `aevatarAI/chrono-ornn` to `ChronoAIProject/Ornn`.

  Replaces 18 references across 11 files:

  - `.changeset/config.json` — `"repo": "ChronoAIProject/Ornn"` so auto-generated CHANGELOG PR links point to the new repo from the next release forward.
  - `CLAUDE.md` — Releases and issue-tracker URLs.
  - `docs/conventions.md` — Error `type` URL, deprecation `Link` target.
  - `docs/ARCHITECTURE.md` — Refactor milestone URL.
  - `ornn-web/src/components/layout/Navbar.tsx` — Navbar GitHub icon link.
  - `ornn-api/docs/site/{en,zh}/*.md` — Six user-facing developer-guide pages that instruct AI agents to fetch `.ornn-apis/` core skills from the repo.

  GitHub serves URL redirects from the old location, so old PR / issue / blob / tree URLs continue to resolve; this PR updates the text so links render with the correct canonical URL and do not decay if the redirect ever drops.

- [#84](https://github.com/ChronoAIProject/Ornn/pull/84) [`2a77a05`](https://github.com/ChronoAIProject/Ornn/commit/2a77a053cda03b54266a233c301f7eafb184152a) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Reserved-verb enforcement + DB audit tooling (closes [#69](https://github.com/ChronoAIProject/Ornn/issues/69)).

  Epic 2's `/v1/skills/{verb}` sub-resource action paths (`format`, `validate`, `search`, `counts`, `generate`, `lookup`) take router priority over `:id` captures, so a skill named after any of these verbs would become unreachable via its canonical read endpoint.

  This PR ships the enforcement + an audit tool:

  - **`ornn-api/src/shared/reservedVerbs.ts`** — single-source catalog of reserved verbs per resource. `isReservedVerb("skill", name)` is the check.
  - **`SkillService.createSkill`** rejects reserved names with `RESERVED_NAME` (400) before the uniqueness check. Covers all create paths (direct API upload, skill generation).
  - **`ornn-api/scripts/audit-reserved-verbs.ts`** — new one-shot script, exposed as `bun run audit:reserved-verbs`. Scans the `skills` collection for name collisions and exits non-zero when any are found. **Must be run against prod once before the Epic 2 deploy** so any colliding rows can be renamed with their owners' consent.
  - **`ornn-api/src/shared/reservedVerbs.test.ts`** — unit tests for the catalog + guard.

  Category and tag names currently use constrained whitelists (fixed enum / regex), so no enforcement needed on those paths yet. The `RESERVED_VERBS.category` / `RESERVED_VERBS.tag` slots are present and empty, ready for future v1-style action paths if any are added.

  Frontend mirror deferred: the skill name comes from `SKILL.md` frontmatter inside the uploaded ZIP, not a UI input — server-side enforcement is the only gate worth mirroring. If future skill-generation flows introduce a name input, a `ornn-web/src/lib/reservedVerbs.ts` mirror is a small follow-up.

## 0.1.3

### Minor Changes

- **Ornn Core Skills** — Three built-in skills that teach AI agents how to use Ornn:
  - `ornn-search-and-run` — Find and execute any skill from the library
  - `ornn-build` — Describe what you need in plain language and AI generates a complete skill
  - `ornn-upload` — Package and publish skills so others can use them
- **Multi-Platform Support** — Installation prompts for Claude Code, OpenAI Codex, Cursor, and Antigravity
- **Updated Documentation** — Rewritten quick start guide with real examples and step-by-step walkthrough

## 0.1.2

### Minor Changes

- **Skill Playground Chat** — Test any skill interactively with an AI-powered chat agent. The playground executes scripts in chrono-sandbox and streams responses in real time.
- **Admin Panel Fix** — Fixed a bug where the Admin Panel link disappeared after session expiry.

## 0.1.0

### Minor Changes

- **NyxID Login** — Sign in with NyxID account. Supports OAuth login and API key access.
- **Create Skills in 3 Ways** — Guided wizard, upload a pre-built package, or AI generation.
- **Skill Playground** — Test any skill interactively with an AI agent in a sandboxed environment.
- **Search the Skill Library** — Keyword search and semantic search.
- **Admin Dashboard** — User activity monitoring and platform-wide skill management.
- **Agent API** — AI agents can search, fetch, upload, and author skills programmatically.
