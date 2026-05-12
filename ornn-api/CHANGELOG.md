# ornn-api

## 0.6.0

### Minor Changes

- [#303](https://github.com/ChronoAIProject/Ornn/pull/303) [`5bc542a`](https://github.com/ChronoAIProject/Ornn/commit/5bc542a0ba1a8b93e68adf2e1066491dd8ec2543) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Admin settings reorganization. Trims admin Settings from 11 sections to 9 by folding domain-specific knobs into the section that actually owns them:

  - **Quota Defaults → Playground + Skill Generation.** The standalone `quotaDefaults` section is gone. `defaultMonthlyQuota` lives on each surface's own section.
  - **Other Services → NyxID Integration.** The standalone `services` section is gone. `chronoStorageUrl`, `chronoStorageBucket`, `chronoSandboxUrl` live on the `integrations/nyxid` section.
  - **Telemetry → PostHog.** Renamed UI title and API public path (`/admin/settings/telemetry` → `/admin/settings/posthog`). Section id stays `telemetry` so existing Mongo rows keep their `_id`.
  - **Extras → Service Binding List Configuration.** UI label only.

  Operator action on redeploy: re-enter `defaultMonthlyQuota` under Playground + Skill Generation, and the chrono-storage / chrono-sandbox endpoints under NyxID Integration. The previous `quotaDefaults` and `services` Mongo rows become orphans — safe to leave or drop.

  Closes [#302](https://github.com/ChronoAIProject/Ornn/issues/302).

- [#315](https://github.com/ChronoAIProject/Ornn/pull/315) [`7d6a7a4`](https://github.com/ChronoAIProject/Ornn/commit/7d6a7a48c4543908b62ffadf79eebf80331b3b0e) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - `api.request` PostHog event now also carries:

  - **`userAgent`** — capped at 500 chars (truncate not redact). Distinguishes browser / ornn-sdk / curl / bots.
  - **`queryParamKeys`** — sorted comma-joined list of query-string KEYS only (never values). 20-key cap. PII-safe by construction.
  - **`requestBytes`** — Content-Length on the request body when set.
  - **`responseBytes`** — Content-Length on the response when set (undefined for SSE/chunked).

  All four are dropped when undefined rather than emitted with a sentinel — keeps PostHog property graphs clean.

  Closes [#314](https://github.com/ChronoAIProject/Ornn/issues/314).

- [#295](https://github.com/ChronoAIProject/Ornn/pull/295) [`a542a86`](https://github.com/ChronoAIProject/Ornn/commit/a542a861baa111e7e4d55f9d35fcbbf68a49f841) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Restructure `.env.sample.ornn` into four explicit sections (kubernetes, docker, ornn-api runtime, ornn-web runtime) and trim it down. Two operator-facing changes:

  - **NyxID service-account credentials moved out of env into admin Settings → Integrations → NyxID.** `NYXID_SA_TOKEN_URL`, `NYXID_SA_CLIENT_ID`, `NYXID_SA_CLIENT_SECRET` are gone. `NyxidSaTokenProvider` now resolves credentials lazily from the `integrations/nyxid` settings section on every refresh. After deploy, configure the section once via /admin/settings — SA token minting fails-fast with a clear error until you do.
  - **ornn-web URL config consolidated to 3 base URLs + 5 paths** (`NYXID_API_BASE_URL`, `NYXID_WEB_BASE_URL`, `ORNN_API_BASE_URL` + `NYXID_OAUTH_{AUTHORIZE,TOKEN,REDIRECT}_PATH` / `NYXID_LOGOUT_PATH` / `NYXID_SETTINGS_PATH`). Replaces 12 full-URL vars. The SPA composes full URLs centrally in `src/config.ts`. `NYXID_BACKEND_HOST` is now derived from `NYXID_API_BASE_URL` by a sourced entrypoint script. Dead vars (`ORNN_API_URL`, `NYXID_BASE_FRONTEND_URL`, `NYXID_MY_*_PATH`) removed.

  Closes [#294](https://github.com/ChronoAIProject/Ornn/issues/294).

- [#249](https://github.com/ChronoAIProject/Ornn/pull/249) [`47092cc`](https://github.com/ChronoAIProject/Ornn/commit/47092cceacc5cb171b8f00e6b926e48b1669197a) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: auto-mirror public + system skills to GitHub for `npx skills add` compatibility, with per-skill sync state, admin console, and runtime-mutable repo coords ([#248](https://github.com/ChronoAIProject/Ornn/issues/248)).

  Every public (`isPrivate: false`) and system (admin-NyxID-service-tied) skill on Ornn now lands as a subdirectory in `ChronoAIProject/ornn-skills` on GitHub the moment it's published. Users install with the community-standard one-liner:

  ```bash
  npx skills add ChronoAIProject/ornn-skills/<skill-name>
  ```

  Identical UX to `npx skills add anthropics/skills/<name>` — no NyxID account, no auth, anonymous git clone. Limited-access skills (private + shared) stay Ornn-only; that's the intentional moat.

  Implementation:

  - New `domains/skills/mirror/` module with three pieces: `GitHubAppAuth` (RS256 JWT → installation-token mint, with cache), `GitHubMirrorClient` (Trees / Refs / Tags / Blobs / Commits REST wrapper), and `MirrorService` with `publishSkill(guid)` / `removeSkill(name)` / `reconcileAll()` operations.
  - Single-commit-per-sync semantics: each successful sync produces one atomic commit + an annotated `sync-<ISO timestamp>` tag — `git tag --list 'sync-*'` is the audit log.
  - Fire-and-forget hooks on every skill mutation route (create, version-publish, refresh, package update, deprecation toggle, permissions / visibility change, NyxID-service tie, delete, version-delete). Errors swallowed + logged; the hourly reconcile cron picks up anything dropped.
  - New admin route `POST /api/v1/admin/mirror/reconcile` (`ornn:admin:skill`) for manual full-sweep.
  - New `scripts/reconcile-mirror.ts` one-shot entry point + `deployment/ornn-api/mirror-cronjob.yaml` k8s `CronJob` (every hour at :17).
  - Disabled by default. Set `GITHUB_MIRROR_ENABLED=true` + the four GitHub App credentials (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, plus `GITHUB_MIRROR_REPO_OWNER` / `_NAME` / `_DEFAULT_BRANCH`) in the ornn-api ConfigMap + Secret to flip on. `assertMirrorConfigComplete` validates at boot — misconfigured deployments fail loud, not silently at first publish.
  - Added `findAllEligibleForMirror()` to `SkillRepository` mirroring `MirrorService.isEligible` exactly so the privacy predicate lives in one place.

  Per-skill sync state + admin console:

  - `SkillDocument.mirrorSync` (`{ version, syncedAt, commitSha }`) — stamped after every successful publish/reconcile commit; cleared on un-mirror; surfaced on `SkillDetailResponse` so the frontend can render a "Synced / Lagging / Never synced" chip.
  - Self-healing reconcile: every run starts by clearing stale stamps from skills that flipped private (`{ isPrivate: true, mirrorSync: { $exists: true } }`). The cron is the safety net for incremental-hook failures.
  - DB-backed runtime mirror coords: `platform_settings` extended with a `githubMirror: { owner, repo, branch }` block. The configmap (`GITHUB_MIRROR_REPO_*`) seeds the defaults; once an admin patches via `POST /api/v1/github/repo`, the DB value wins thereafter. `GitHubMirrorClient` resolves the target on every API call so admin patches propagate without a redeploy. The `GITHUB_MIRROR_ENABLED` kill switch deliberately stays in the configmap — flipping it is an ops decision that should leave a k8s trail, not a one-click in the admin UI.
  - New routes:
    - `GET /api/v1/github/repo` — public read; SkillDetailPage uses it to render the install snippet to anonymous viewers.
    - `POST /api/v1/github/repo` (`ornn:admin:skill`) — admin patch with `confirmAbandonOldRepo: true` required when the change would orphan a non-empty mirror; clears all `mirrorSync` stamps on accepted change so audit links don't dangle into the abandoned repo.
    - `GET /api/v1/admin/mirror/status` (`ornn:admin:skill`) — eligible/synced/lagging/never-synced counts, oldest-unsynced timestamp, last-reconcile state.
    - `POST /api/v1/admin/mirror/reconcile` is now fire-and-forget — returns `202` immediately with the run's `startedAt`; admin UI polls the status endpoint until completion.
  - Frontend:
    - `MirrorInstallCard` on `SkillDetailPage` — `npx skills add <owner>/<repo>/<name>` with click-to-copy, sync chip (Synced/Lagging/Never synced), GitHub commit + tree links. Hidden for private skills, when feature is off, and during the initial repo-config fetch.
    - New `/admin/mirror` page in the admin sidebar: feature-enabled banner, status header (repo + last reconcile), counts grid (eligible/synced/lagging/never with oldest-unsynced timestamp), manual reconcile button, repo-coords form with abandon-confirm modal that surfaces the stamped-skill count.

  Privacy regression test included: a private skill (with or without `sharedWithUsers` / `sharedWithOrgs`) is asserted to NEVER appear in any payload sent to GitHub.

- [#255](https://github.com/ChronoAIProject/Ornn/pull/255) [`a5166ad`](https://github.com/ChronoAIProject/Ornn/commit/a5166addd19a2b08a1b9f9da667a6e523bae4454) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Backend integrations for Go-Live: PostHog analytics ([#252](https://github.com/ChronoAIProject/Ornn/issues/252)) and AgentSeal trust scanner ([#253](https://github.com/ChronoAIProject/Ornn/issues/253)).

  - **[#252](https://github.com/ChronoAIProject/Ornn/issues/252) — PostHog server-side analytics.** New `infra/analytics` module wraps `posthog-node` behind an `AnalyticsTracker` interface (Noop sink when `POSTHOG_API_KEY` is unset). High-level emitter exposes `trackSkillPull` (with `callerType` + `skillId`), `trackSkillPublished`, and `trackApiError` (sampled at `POSTHOG_ERROR_SAMPLE_RATE`). Wired into the skill detail/json routes, the `createSkill` and `updateSkill` publish paths, and the global `app.onError` handler. Pino logging on every emission, with property-key lists at `info` and full bodies only at `debug` so we never leak PII.
  - **[#253](https://github.com/ChronoAIProject/Ornn/issues/253) — AgentSeal subprocess scanner.** New `infra/agentseal` module spawns `agentseal guard --output json` per skill version publish (and first-create) with a configurable timeout (`AGENTSEAL_TIMEOUT_MS`, default 60s). Scan record persisted on `skillVersion.agentsealScan = { score, findings, scannedAt, agentsealVersion }`, with a sparse Mongo index on `agentsealScan.score` for admin queries. v1 is warn-only — failures are logged but never block publish. New admin endpoint `POST /admin/skills/:idOrName/versions/:version/agentseal-rescan` to manually re-trigger a scan. AgentSeal Python package baked into `ornn-api/Dockerfile` (pinned `agentseal==0.5.0` via a `/opt/agentseal` venv).

- [#309](https://github.com/ChronoAIProject/Ornn/pull/309) [`68d8d27`](https://github.com/ChronoAIProject/Ornn/commit/68d8d27d65c76eca0c3a8c68ec61a23af8d1cb7e) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Landing-page announcement popup with admin management. Admins can curate news / changelog blurbs from a new `/admin/announcements` page; the most recent enabled record currently within its `[startsAt, endsAt]` window is shown to every visitor (anonymous + signed-in) on the landing page, dismissible per-id via `localStorage`.

  - **API.** New `announcements` Mongo domain. Public `GET /api/v1/announcements/active` (anonymous-friendly) returns the single live record or `null`. Admin CRUD lives under `/api/v1/admin/announcements` gated on `ornn:admin:skill`.
  - **Admin UI.** Top-level `/admin/announcements` next to Skills and Quota — list table with LIVE / SCHEDULED / EXPIRED / DISABLED status, per-row enable / edit / delete, and a 560px right-edge drawer for create / edit with a markdown body preview, optional CTA pair, and optional schedule window.
  - **Landing.** New `AnnouncementPopup` mounted on `/`. One-shot per id: `localStorage` key `ornn:announcement:dismissed:<id>` keeps the same browser from being re-prompted. CTA links open in a new tab and also mark dismissed on click.

  Closes [#307](https://github.com/ChronoAIProject/Ornn/issues/307).

- [#261](https://github.com/ChronoAIProject/Ornn/pull/261) [`1b9da12`](https://github.com/ChronoAIProject/Ornn/commit/1b9da1293094899309d3bd835b3f48e7b5cfef48) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: admin LLM provider config (encrypted at rest, mid-masked in UI), additive quota grants with period, AgentSeal Python wrapper, admin user collection, runtime LLM override.

  **LLM provider override (admin panel)** — `/admin/models` gets a `LlmProviderConfigCard` letting an admin paste a custom gateway URL + bearer key without redeploying. The key is encrypted with AES-256-GCM (`infra/crypto`, scrypt-derived from `ENCRYPTION_KEY`) before hitting Mongo and decrypted at the service boundary on each read; the UI mid-masks the persisted key (first 4 + last 4, bullets in the middle) so the operator can sanity-check which key is in place without exposing the body. Round-tripping the masked value preserves the existing key — the bullet character is the sentinel and is rejected if a fresh key would somehow contain one. Override takes effect on the next LLM call (no pod restart) via a `runtimeOverrideEnabled` resolver on `NyxLlmClient`.

  **Quota grants are additive with a period** — admin grants now stack on top of any existing balance instead of overwriting (`grant()` accepts `periodMonths`, persists to a `quota_grants` ledger with `consumed`/`expiresAt`). The admin quota table shows used/limit · daily · +bonus per user; the playground chip shows the effective remaining balance.

  **AgentSeal trust scanner** — replaced the broken `agentseal guard` CLI with a Python wrapper (`scripts/scan_skill.py`) that drives `agentseal.skill_scanner.SkillScanner` directly, plus a manual rescan button on the trust badge so an operator can re-run a stuck scan without re-publishing.

  **Admin user collection** — replaces `ORNN_ADMIN_EMAILS` env. Authenticated users with `ornn:admin:skill` are lazily inserted into `admin_users` by the auth middleware; routes that need an admin filter consult that collection.

  **New env var** — `ENCRYPTION_KEY` (32+ chars, generate with `openssl rand -hex 32`). When unset, the API falls back to a clearly-marked dev sentinel; production deployments **must** set this — rotating it makes every previously-encrypted secret unreadable.

- [#262](https://github.com/ChronoAIProject/Ornn/pull/262) [`2d28830`](https://github.com/ChronoAIProject/Ornn/commit/2d288308eed5efff6f8e558b682e5b58d2dac5d7) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: GitHub Mirror config moves to DB+UI (encrypted App key), Playground gets a chat-first redesign with hover drawer, and SSE streaming actually streams.

  **GitHub Mirror config in DB instead of configmap.** The kill switch + repo coords + GitHub App credentials (App ID, Installation ID, RSA private key) all live in `platform_settings` now and are managed at `/admin/mirror`. The App private key is encrypted at rest with AES-256-GCM (same `infra/crypto` we used for the LLM apiKey) and mid-masked on read. `MirrorService` is runtime-aware: it asks `PlatformSettingsService` for the active config on every public op and rebuilds its `GitHubMirrorClient` only when the credential fingerprint changes — admins can flip enabled or paste new creds and the next sync (cron at `:17` or manual reconcile) picks them up without a pod restart. The `configmap.yaml` is deleted; non-sensitive operational env (PORT, LOG_LEVEL, MONGODB_DB, NyxID base URL, etc.) inlined into Deployment + CronJob `env:` blocks. Only true bootstrap secrets remain in `ornn-api-secret`. New help popover on the Mirror admin page documents the GitHub App creation flow (which form fields matter, what to skip, App vs OAuth, "Any account" vs "Only on this account") so first-time setup doesn't bounce off GitHub's dense docs.

  **Playground redesign — chat is the page.** Replaced the 40/60 two-column layout with a centered chat hero (max-w-3xl) and a right-edge slide-in drawer with three tabs (Skill / Env / Package). Hover the rail to peek; click a tab to pin (with backdrop). Empty state replaced with a "Probe the skill." headline + 3 skill-aware quick-starter cards that pre-fill the input. Per-skill session lifecycle — chat resets on mount AND on `skillName` change, so navigating away and back gives a fresh conversation. Auto-scroll learns to leave you alone: tracks distance-from-bottom and only follows the stream when you're already at the tail; scroll up at any point and the page stops chasing you.

  **SSE streaming actually streams.** Two bugs were stacked. (1) The audit middleware was calling `await c.res.clone().text()` for every write/error response, which waits for the entire response body to drain before letting Hono send anything to the client — for a 45s LLM stream, the browser saw nothing until completion, then everything at once. Fixed: skip body capture when `Content-Type: text/event-stream`; SSE audits record metadata only (status / duration / route / req body) since multi-MB token streams aren't useful in the audit log anyway. (2) The chat route originally used Hono's `streamSSE` helper, which can batch under Bun. Replaced with a manual `ReadableStream<Uint8Array>` + synchronous `start()` that pre-flushes a 2KB SSE-comment to commit headers immediately, with the async pump deferred to an IIFE so the response body becomes readable on the first byte instead of waiting for the generator to drain. Front-end side: dropped 50ms token batching to render every text-delta synchronously (per-token typewriter feel), made the chat scroll container properly height-constrained (`min-h-0` was missing on the centered chat column), and pulled all live-streaming rendering through the existing `ChatMessage` so markdown + the `animate-blink` ember caret work end-to-end. Verified at the network layer with a `/sse-test` endpoint that streams 16 ticks at 250ms intervals — chunks arrive on time direct, through NyxID's reqwest proxy, and through ornn-web's nginx.

- [#358](https://github.com/ChronoAIProject/Ornn/pull/358) [`61fceb4`](https://github.com/ChronoAIProject/Ornn/commit/61fceb4d55e7dbbe13adb648b87173861de831b2) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add a public News page at `/news` listing every released announcement (current + historical), and the public list endpoint that powers it.

  - `ornn-api`: new public `GET /api/v1/announcements` endpoint returning `{ items: PublicAnnouncementListItem[] }` — every enabled announcement whose start gate has elapsed, newest first, with a serialized `publishedAt` (`startsAt ?? createdAt`). Past/expired records are intentionally retained: the News page is an archive. The popup-only `/announcements/active` endpoint is unchanged. Added `AnnouncementRepository.findAllReleased` and `AnnouncementService.listPublished` with unit tests.
  - `ornn-web`: new `NewsPage` route at `/news` mirroring the ContactPage editorial layout (eyebrow + display headline + impression cards). Each entry shows a locale-aware publish date, Space Grotesk title, sanitized markdown body (same `react-markdown` + `remark-gfm` + `rehype-sanitize` pipeline as the popup), and an optional CTA button. Navbar gets a "News / 动态" item between Docs and Contact; admin mutations now invalidate the public list query alongside the existing popup + admin queries so a just-created announcement shows up on the News page immediately.

  Closes [#357](https://github.com/ChronoAIProject/Ornn/issues/357).

- [#272](https://github.com/ChronoAIProject/Ornn/pull/272) [`f55decb`](https://github.com/ChronoAIProject/Ornn/commit/f55decb8d9fe6941aec5c69e347fb337c82dc226) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: fold model catalog into LLM provider settings — single-source per-provider model management ([#270](https://github.com/ChronoAIProject/Ornn/issues/270)).

  Replaces the parallel `/admin/models` global catalog with a single, per-provider, drawer-based flow. Click a provider in **Admin → Settings → LLM Providers** and a new **Models** action opens a side drawer listing every model the provider has synced. Per row: enable for Playground, enable for SkillGen, default for Playground (radio), default for SkillGen (radio). Defaults are global across providers — the server enforces at-most-one-true per surface in the same write that flips a flag, so picking a new default unselects every other model's default for that surface automatically.

  Backend

  - `LlmProviderModel` schema extended: `enabledForPlayground`, `enabledForSkillGen`, `defaultForPlayground`, `defaultForSkillGen`. Old `enabled: boolean` is gone — newly synced models arrive with all four flags `false` so adding a row to the upstream catalog never auto-changes platform behaviour.
  - `LlmProvider.defaultModelId` removed — defaults live on the per-model rows now, scoped per-surface.
  - New `PATCH /api/v1/admin/settings/llm-providers/:providerId/models/:modelId` for partial flag updates. Server enforces:
    - at-most-one default per surface across all providers (single write — `clearDefaultsForSurfaceExcept` runs first),
    - `defaultForX: true` ⇒ `enabledForX: true` (forced in the same write),
    - rejects when the row is `removed: true`.
  - `GET /api/v1/me/models?surface=...` rewired to union across every provider's `models[]`. Picker still returns flat `{ modelId, displayName, isDefault }` rows so SDK callers don't need to handle the provider dimension.
  - Idempotent boot migration (`migrateModelCatalogIntoProviders`) reads the legacy `models` collection, copies each row's surface flags onto the matching `(providerId, modelId)` slot in `llm_providers.models[]`, then drops the legacy collection. Repository ships a `normalizeModel` shim so reads survive even before the migration runs (e.g. cron pods that boot mid-migration).
  - `domains/models/` module deleted: routes, service, repository, types. The catalog client (`NyxLlmCatalogClient`) is no longer wired — per-provider sync uses each provider's own `modelListUrl`.
  - `playground` and `skill-gen` execute paths swapped to `LlmProvidersService.resolveModel({ surface, requested })`. Same `ModelResolution` shape, same HTTP error codes, same `throwModelResolutionError` helper (now exported from `domains/settings/llmProviders/routes.ts`).
  - 547/547 backend tests pass; new tests cover the at-most-one-default invariant + the `defaultForX → enabledForX` coherence rule.

  Frontend

  - New `ProviderModelsDrawer` (640px slide-in): per-row toggles for the two surface-enable flags, radios for the two surface-defaults, archived rows segregated below. Each interaction fires a per-model PATCH; on success the provider list invalidates so a sibling provider's default flip cascades into the open drawer's view on the next refetch.
  - `LlmProvidersSection` table now shows per-surface counts (`X playground · Y skillGen · Z total`) and a new **Models** action. The "Default" column is gone (defaults are per-model now).
  - `ProviderEditDrawer` lost its "Default model" select — that drawer is connection-config only (auth, gateway URLs, max tokens, temperature).
  - `/admin/models` page removed from the SPA. `services/modelsApi.ts` trimmed to picker-only; `useModels` keeps `usePickerModels` + `usePreferredModel` and drops the admin hooks. `LlmProviderConfigCard` deleted (only consumer was the deleted page). `App.tsx` route + lazy-import dropped. `pages/admin/index.ts` re-export dropped.
  - Section-level default-model dropdowns (Playground / SkillGen / SkillAudit) now filter the provider's models by the relevant `enabledFor<Surface>` flag instead of the dropped `enabled` boolean.

  Migration / data shape

  The old global `models` collection is dropped automatically on first boot under the new code. Everything that was an enabled/default flag in that collection is now a per-(provider, modelId) flag inside the per-provider arrays. After deploy, admins should re-verify their per-surface defaults via **Admin → Settings → LLM Providers → Models** and not via a separate page.

- [#276](https://github.com/ChronoAIProject/Ornn/pull/276) [`d5df1b3`](https://github.com/ChronoAIProject/Ornn/commit/d5df1b363b7550f42fe4992a03f134f9b5678b92) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - PostHog-only platform analytics + audit. Closes [#271](https://github.com/ChronoAIProject/Ornn/issues/271).

  Replaces every custom audit / activity surface in Ornn with the
  PostHog SDK as the single source of truth. The OpenTelemetry
  placeholder section was dropped — Ornn does not run an OTel pipeline.

  **`ornn-api` — added.** New per-request `apiRequestTracking`
  middleware on `/api/v1/*` emits an `api.request` PostHog event for
  every authenticated request with `userId`, `callerType` (web / api /
  system / playground), `method`, `path`, `routePattern`, `status`,
  `durationMs`, `sourceIp` (truncated /24 IPv4, /48 IPv6 before emit),
  and `requestId`. New typed `analyticsEmitter.trackPlatformActivity`
  helper covers every domain action that previously lived in the
  `activities` Mongo collection — login / logout, skill CRUD + version
  delete + visibility / permissions changes, source link / unlink,
  NyxID service tie, AgentSeal rescan, settings export / import. PostHog
  config now reads from the `telemetry` admin settings section at boot
  (env vars are bootstrap fallback); a non-empty `postHogApiKey` in the
  DB makes the whole record authoritative.

  **`ornn-api` — removed.** Universal API audit middleware ([#245](https://github.com/ChronoAIProject/Ornn/issues/245)):
  `middleware/audit/*`, `ApiAuditRepository`, `AuditBodyStorage`,
  `api_audit` Mongo collection, audit MinIO bucket usage, env vars
  `AUDIT_RETENTION_DAYS` / `MINIO_AUDIT_BUCKET` /
  `AUDIT_BODY_INLINE_MAX_KB` / `AUDIT_GLOBAL_REDACT_PATTERNS`.
  `ActivityRepository` and the `activities` collection. Endpoints
  `/admin/activities` and `/admin/stats` (legacy). OpenTelemetry fields
  on the telemetry settings section schema. The `users_meta` backfill
  in the quota migration script.

  **`ornn-api` — refactored.** `AdminUsersRepository` and
  `UsersMetaRepository` collapsed into a single
  `UserDirectoryRepository` (collection: `users`) — the typeahead,
  admin user list, and dashboard role partition were derived from
  `activities` aggregations and needed a different home now that the
  audit log is gone. Lazy upsert from `proxyAuthSetup.onAuthSeen` on
  every authenticated request stamps `firstSeenAt`, refreshes
  `lastSeenAt`, increments `activityCount`, and updates `isAdmin`. NyxID
  remains authoritative for permission checks; this collection is a
  display + indexing cache.

  **`ornn-web` — added.** Active `TelemetrySection` replaces the OTel +
  PostHog placeholder. Admin-editable PostHog enabled flag, API key
  (encrypted at rest), host, project ID, and error sample rate; saves
  trigger an explicit "restart required" notice. New `lib/postHogLinks`
  helper computes the dashboard URL from the ingest host (`eu.i.posthog.com`
  → `eu.posthog.com`).

  **`ornn-web` — removed.** Activity-feed UI (`ActivitiesPage`) and the
  `RecentActivities` dashboard widget — both replaced with deep-links
  to the PostHog Activity / Insights views. `fetchRecentActivities` and
  the `RecentActivity` type from `services/adminDashboardApi`.

  **Tradeoffs accepted.** No request/response body archive. Audit
  retention = PostHog retention. PostHog SaaS dependency (long outages
  drop events). No distributed tracing — OTel deferred to a future
  issue with a real backend.

  **Operator notes.** New env: `POSTHOG_ENABLED` (bootstrap fallback;
  admin telemetry section overrides). Operators with existing
  `api_audit` / `activities` / `admin_users` / `users_meta` Mongo
  collections + an `ornn-audit` MinIO bucket can drop them at their
  convenience — Ornn no longer reads or writes any of them. Audit
  trail post-deploy lives in the configured PostHog project.

- [#269](https://github.com/ChronoAIProject/Ornn/pull/269) [`93bf14d`](https://github.com/ChronoAIProject/Ornn/commit/93bf14d2488fd92d958b51cbd850a063a41d98ff) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Quota redefinition + admin panel restructure.

  - **Quota model**: replaced daily-ceiling + time-period grant ledger with calendar-month buckets. New `quota_buckets` collection, atomic `findOneAndUpdate $inc`, no carry-over, grants apply to the current month only. Admins (`ornn:admin:skill`) continue to bypass.
  - **Breaking** — `GET /api/v1/me/quota` payload drops the `daily` block. Each surface now exposes `defaultAllotment`, `adminGrant`, `used`, `remaining`, `warningThreshold`, `warning`, plus top-level `monthMarker`, `monthStart`, `monthEnd`, `nextMonthlyResetAt`. ornn-web is the only known consumer and is updated in lockstep.
  - **Breaking** — `POST /api/v1/admin/quota/grant` and `/grant/bulk` no longer accept `periodMonths`. Grants are additive to the current-month bucket and disappear at month rollover.
  - **New endpoints** — `/admin/quota/users?surface=` (per-user current-month rows), `/admin/quota/users/:id/lifetime?surface=` (per-month history with `usedByModel` breakdown), `/admin/dashboard/stats`, `/admin/dashboard/recent-activities`, `/admin/users?role=admin|normal&page&pageSize&q&sort&dir`.
  - **Settings umbrella** — admin settings split into nine per-section docs (LLM providers, playground, skill generation, mirror, NyxID, services, skill audit, telemetry, quota defaults, extras) with sentinel-redacted export/import.
  - **Hardcode parameterization** — runtime knobs (LLM gateway, default model, storage/sandbox URLs, NyxID base URL, AgentSeal toggle/timeout, SSE keep-alive, extra NyxID services) moved from env to admin settings.
  - **Migration** — `ornn-api/scripts/migrate-quota-to-buckets.ts` converts old `user_quotas` + `quota_grants` into the new shape, archives the legacy ledger to `_archive_quota_grants` with a 90-day TTL, backfills `users_meta.firstJoinedAt` from `MIN(activities.createdAt)`, and notifies users with multi-month grants per Story 10.3. Idempotent; supports `--dry-run`.

- [#258](https://github.com/ChronoAIProject/Ornn/pull/258) [`50a1233`](https://github.com/ChronoAIProject/Ornn/commit/50a1233349522aa86a6049dc4e86217db7dfbf80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: per-user playground & skill-gen quota with admin-granted credits ([#250](https://github.com/ChronoAIProject/Ornn/issues/250)) + admin-curated Chrono LLM model selection ([#251](https://github.com/ChronoAIProject/Ornn/issues/251)) — backend.

  [#250](https://github.com/ChronoAIProject/Ornn/issues/250) ships per-user monthly base + daily ceiling counters per surface (200/50 playground, 20/5 skill-gen), non-expiring admin-granted credit buckets, lazy UTC-marker-based resets, and admin-issued grants (per-user + bulk) with full audit trail. Charge fires on completion: skill errors count, system errors don't. Admins exempt. Over-limit returns 429 with the upsell message. New endpoints: `GET /me/quota`, `GET /admin/quota/users`, `POST /admin/quota/grant`, `POST /admin/quota/grant/bulk`, `GET /admin/quota/grants`.

  [#251](https://github.com/ChronoAIProject/Ornn/issues/251) ships an admin-controlled local `models` collection synced on demand from Chrono LLM via the NyxID proxy (`/api/v1/proxy/s/chrono-llm/models`). New rows default disabled; admin enables per-surface and picks a default. Removed upstream models flagged `archived`. Playground/skill-gen execute paths accept an optional `modelId`, validate against the surface's enabled list, and 503 with a `MODEL_UNAVAILABLE` admin-contact message when no models are enabled. New endpoints: `GET /me/models?surface=`, `GET /admin/models`, `POST /admin/models/refresh`, `PATCH /admin/models/:modelId`.

- [#308](https://github.com/ChronoAIProject/Ornn/pull/308) [`1ab68f8`](https://github.com/ChronoAIProject/Ornn/commit/1ab68f80e16601137118673a4d147cec8b4e0705) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Admin-issued redeem codes for quota grants.

  Admins mint single-use, time-bounded codes that carry a multi-surface grant bundle (playground / skillGen). Each code is 16 chars from a confusable-stripped alphabet; the redeem endpoint canonicalises to upper-case at the boundary so users can paste in any case. End users redeem from Settings → Redeem code; the grant lands on the caller's current-month bucket via the existing `QuotaService.grant()` path so existing audit + notification fanout fires.

  Lifecycle: `active → redeemed | invalidated`. Concurrent redemptions of the same code are race-safe — a single atomic `findOneAndUpdate` on `(code, status: "active", expiresAt > now)` is the pivot. Admins can invalidate any `active` code; redeemed and already-invalidated codes return 409.

  New surfaces:

  - `POST /api/v1/admin/redemption-codes` (mint), `GET` (list/filter/search), `GET /:id` (detail), `POST /:id/invalidate`. Gated on `QUOTA_ADMIN_PERMISSION`.
  - `POST /api/v1/me/redemption-codes/redeem`, `GET /api/v1/me/redemption-codes/history`. Per-error-code messages on the user form (`NOT_FOUND` / `EXPIRED` / `INVALIDATED` / `ALREADY_REDEEMED`).
  - Admin page at `/admin/redemption-codes`; user form on the Settings page.

  Closes [#306](https://github.com/ChronoAIProject/Ornn/issues/306).

- [#293](https://github.com/ChronoAIProject/Ornn/pull/293) [`caa2ca9`](https://github.com/ChronoAIProject/Ornn/commit/caa2ca9a5b95609d01b7efe61824f0c44ff72cab) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - chore: delete admin Categories / Tags / Auditing / Activities pages ([#292](https://github.com/ChronoAIProject/Ornn/issues/292)).

  Four admin pages with no real workflow gone:

  - **Categories** — admin CRUD over the four-name fixed enum (`plain`, `tool-based`, `runtime-based`, `mixed`) was operator surface area for nothing. Skill metadata's `category` field stays; the values become effectively immutable, matching how the system already worked in practice.
  - **Tags** — same shape. Predefined-tag list editor goes; skill upload still emits user-typed custom tags.
  - **Auditing** — pure "Coming soon" placeholder, no backend. Per-skill audit history at `/skills/:idOrName/audits` is a different surface and stays.
  - **Activities** — redirect-shim to PostHog. Dashboard's `<RecentActivities />` already renders `postHogActivityUrl()`, so the dedicated page was exactly redundant.

  Backend admin endpoints (`/api/v1/admin/categories/*`, `/api/v1/admin/tags/*`) deleted along with `AdminService` + `CategoryRepository` + `TagRepository` (admin-page-only consumers — no other caller). Frontend hooks/services/types wound down to empty stubs (kept as obvious homes for future admin-only frontend code).

  Ships across 7 commits — one page per commit, one for the backend, one for an orphan test file. Backend 477/477, frontend 50/50, typecheck clean both sides.

### Patch Changes

- [#331](https://github.com/ChronoAIProject/Ornn/pull/331) [`c141e90`](https://github.com/ChronoAIProject/Ornn/commit/c141e9007f67eab2d93e4b8f964a9696f9fd9bc1) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fix admin Settings → Export / Import (both directions broken):

  - **Export**: backend now wraps the export envelope in the standard `{ data, error }` shape so the SPA's `apiGet` can parse it. Previously returned a raw envelope, which made the SPA throw "Export missing" on every click.
  - **Import**: backend now accepts the `dryRun` flag from the request body (where the SPA sends it) in addition to the query string. Previously query-only — the "Run dry-run preview" button silently committed the import every time.

  Closes [#330](https://github.com/ChronoAIProject/Ornn/issues/330).

- [#239](https://github.com/ChronoAIProject/Ornn/pull/239) [`fbc485c`](https://github.com/ChronoAIProject/Ornn/commit/fbc485ca5189c323f36c03b12855b32f35b07582) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(api): admin user list + permissions-modal user resolve — pick latest **non-empty** email/displayName from activities, not the literal latest row.

  The aggregator's `$last: "$userEmail"` and `$last: "$userDisplayName"` surfaced whatever the most recent activity row carried — even empty strings — so users whose most recent activity was authenticated by a JWT lacking `email` / `name` claims (some admin / proxy / SA-flavored login paths emit those empty) showed up blank in the admin user list and the permissions-modal user chips, even though earlier activities had the labels populated. Sorts the group desc-by-createdAt, `$push`'s the values, then picks the first non-empty per field downstream.

  Also adds `scripts/backfill-skill-author-display-names.ts` to retro-populate `createdByEmail` + `createdByDisplayName` on existing skill docs by joining `skills.createdBy` against the activities directory — older skills predate the cache-at-create-time behavior so the Skill Detail / Skill Card UI was rendering the raw user_id UUID.

- [#385](https://github.com/ChronoAIProject/Ornn/pull/385) [`b1c4f08`](https://github.com/ChronoAIProject/Ornn/commit/b1c4f08e61ee78dab4878775d7ec5abe1d5aaf25) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Drop unused `@xenova/transformers` dependency and bump `hono`, `yaml`, `mermaid`, `posthog-js`, `vite`, and several transitive packages to clear all 34 high/critical/moderate advisories flagged by `bun audit` on the previous lockfile. The matching CI `audit` gate ships in a follow-up PR.

- [#398](https://github.com/ChronoAIProject/Ornn/pull/398) [`6509260`](https://github.com/ChronoAIProject/Ornn/commit/65092600390a18450f9947e153884b8fe793ab7f) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Drop legacy `share.*` notifications on boot. PR [#198](https://github.com/ChronoAIProject/Ornn/issues/198) removed the share/audit-gate workflow but pre-[#198](https://github.com/ChronoAIProject/Ornn/issues/198) notification rows still surfaced via `GET /api/v1/notifications` with dead deep-links into the removed `/shares/*` route tree. A new idempotent boot migration deletes any notification whose category is not in the current allowed set.

- [#336](https://github.com/ChronoAIProject/Ornn/pull/336) [`486c35a`](https://github.com/ChronoAIProject/Ornn/commit/486c35a8a170a62b111c4d677e5f78bef570ef70) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Settings export now drops the `models` array from each LLM provider entry entirely. Previously trimmed to operator flags ([#332](https://github.com/ChronoAIProject/Ornn/issues/332)); now removed. Model catalog is derived data — refreshed by Sync against the upstream gateway via /admin/settings/llm-providers — and doesn't belong in a portable settings export. Per-model flags ride out of band; re-set after Sync.

  Provider container fields (gateway URL, auth, defaults) stay in the export.

  Closes [#335](https://github.com/ChronoAIProject/Ornn/issues/335).

- [#332](https://github.com/ChronoAIProject/Ornn/pull/332) [`997eaa5`](https://github.com/ChronoAIProject/Ornn/commit/997eaa5936a15274c189900ab58112d163759a87) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Settings export trims each LLM provider's `models` array to operator-state fields only. The synced catalog fields (`displayName`, `firstSeenAt`, `lastSyncedAt`) — which are derived data refilled by hitting the upstream gateway via `/admin/settings/llm-providers` Sync — are no longer in the export. Operator flags (`enabledForPlayground`, `enabledForSkillGen`, `defaultForPlayground`, `defaultForSkillGen`, `removed`) stay so the export still captures the choices an admin made about which models to expose.

  Closes part of [#330](https://github.com/ChronoAIProject/Ornn/issues/330) — keeps the export portable without dragging stale upstream catalog snapshots along.

- [#277](https://github.com/ChronoAIProject/Ornn/pull/277) [`56bbf55`](https://github.com/ChronoAIProject/Ornn/commit/56bbf55d62ac9f48beb7754909b0e10664ecd164) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - chore: move browser-only NyxID link coords from admin settings into ornn-web configmap ([#275](https://github.com/ChronoAIProject/Ornn/issues/275)).

  The `nyxid` admin-settings section used to carry five fields with no server-side consumer (`baseFrontendUrl`, `myServicesPath`, `myProfilePath`, `myOrganizationPath`, `servicesListApiPath`). The four frontend link coords now live in ornn-web's configmap (`NYXID_BASE_FRONTEND_URL`, `NYXID_MY_SERVICES_PATH`, `NYXID_MY_PROFILE_PATH`, `NYXID_MY_ORGANIZATION_PATH`) — delivered via the existing `window.__ORNN_CONFIG__` injection alongside `NYXID_OAUTH_*` and `NYXID_LOGOUT_URL`. `servicesListApiPath` is dropped outright (the runtime hard-codes `/api/v1/user-services`).

  The admin NyxID section now contains only `tokenUrl`, `clientId`, `clientSecret`, and `baseApiUrl` — the four fields ornn-api actually consults at runtime.

  Migration-free: pre-existing `platform_settings` docs with the legacy fields keep working — Zod's default strip semantics drop unknown keys on parse. Operators upgrading should add the four new env vars to their ornn-web configmap (see `deployment/.env.sample.ornn`).

- [#263](https://github.com/ChronoAIProject/Ornn/pull/263) [`e4ee670`](https://github.com/ChronoAIProject/Ornn/commit/e4ee670d2d2b2730d50e3aff9efa96815374ae00) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(playground): real per-event SSE streaming via TransformStream + ChatGPT-style chat polish.

  **Streaming fix.** The previous chat route used `new ReadableStream({ start(controller) { ... controller.enqueue(...) } })` with a deferred IIFE producer. Under Bun's HTTP layer, this pattern coalesced 2,000+ enqueues into a single delivery at stream-close — the EventStream tab in DevTools would show every text-delta event arriving at the same millisecond despite the upstream LLM streaming over ~45s. Replaced with `TransformStream + writer.write()`, which establishes proper backpressure with Bun's response consumer: each `await writer.write(chunk)` resolves only once the chunk has been picked up by the HTTP writer, forcing real per-event flushing on the wire. Verified end-to-end via the EventStream tab — events now arrive at distinct timestamps as upstream emits.

  **Character-by-character typewriter.** Replaced the synchronous "render every text-delta as it arrives" path with a paced drain in `usePlaygroundChat`. Incoming chars accumulate in a `pendingTokensRef` buffer; a 22ms `setInterval` drains one character per tick onto the displayed message. Adaptive: if the LLM races ahead (>60 chars buffered) the pacer takes 3 chars/tick; past 200 chars it scales to `ceil(buffer/60)` chars/tick so visible text stays within ~1s of received. On `finish`/`tool-call`/`error`/`abort` it drains everything immediately — paced typewriter is a UX nicety, not a contract. Emoji-safe via `Array.from(buffer)` so a 4-byte 😀 counts as one character.

  **Chat polish.**

  - Composer moved to `max-w-2xl` and lifted off the floor (`pb-6`); model picker + quota chip now sit centered just above the input, ChatGPT-style. Top-right surface header dropped.
  - User bubbles use the Forge ember palette: `bg-warning-soft` fill + `border-accent/30` ember outline, contrasted against the assistant's cool `bg-card` bubble.
  - Empty-state hero is vertically centered, narrower hero copy + 3 quick-starter chips below.
  - Auto-scroll only follows when the user is already at the tail (tracks `distFromBottom < 80`), so scrolling up mid-stream stops the page from chasing.
  - Per-skill session lifecycle: chat resets on skillName change AND on unmount.
  - Chat header status row only renders once a conversation is active — no "Idle/Ready" noise on the empty state.
  - Right-edge drawer (Skill / Env / Package) anchored via `position: fixed` so it stays in view regardless of page scroll.

- [#327](https://github.com/ChronoAIProject/Ornn/pull/327) [`73d624f`](https://github.com/ChronoAIProject/Ornn/commit/73d624fe0b230742277b86b4573fca7ada7ac46b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Reposition Ornn consistently as **the end-to-end skill life-cycle manager for AI agents** across every public-facing surface — landing footer tagline (EN + ZH), OpenAPI top-level description, repo README, TS + Python SDK package descriptions and READMEs.

  Also drops the Product / Developers link columns from the landing footer — every entry was already reachable from the top nav (Registry / Build / Docs / GitHub icon). Footer now carries logo + tagline + (copyright · legal links · brand string).

  Closes [#326](https://github.com/ChronoAIProject/Ornn/issues/326).

- [#288](https://github.com/ChronoAIProject/Ornn/pull/288) [`a55043d`](https://github.com/ChronoAIProject/Ornn/commit/a55043da1b6d5c9ab690f22f38c87cd26256e3ab) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - chore(deploy): audit + clean env-var surface ([#287](https://github.com/ChronoAIProject/Ornn/issues/287)).

  Three categories of cleanup against `deployment/ornn-api/{deployment.yaml, mirror-cronjob.yaml}` and `deployment/.env.sample.ornn`:

  1. **Removed 11 stale env vars** that no code consumes anymore — each was migrated into `platform_settings` admin sections in earlier rounds ([#268](https://github.com/ChronoAIProject/Ornn/issues/268), [#269](https://github.com/ChronoAIProject/Ornn/issues/269), [#270](https://github.com/ChronoAIProject/Ornn/issues/270), [#271](https://github.com/ChronoAIProject/Ornn/issues/271)): `NYX_LLM_GATEWAY_URL`, `STORAGE_SERVICE_URL`, `STORAGE_BUCKET`, `SANDBOX_SERVICE_URL`, `DEFAULT_LLM_MODEL`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TEMPERATURE`, `SSE_KEEP_ALIVE_INTERVAL_MS`, `EXTRA_NYXID_SERVICES`, `AGENTSEAL_ENABLED`, `AGENTSEAL_TIMEOUT_MS`.
  2. **Added 3 missing env vars** that code reads but the manifests were not plumbing through: `AGENTSEAL_PYTHON`, `AGENTSEAL_SCRIPT`, `ORNN_URL_ALLOWLIST_CIDR`.
  3. **Renamed 3 vars** to drop a useless alias layer — `.env.ornn` keys now match the actual container env-var names: `ORNN_API_PORT → PORT`, `ORNN_API_LOG_LEVEL → LOG_LEVEL`, `ORNN_API_LOG_PRETTY → LOG_PRETTY`.

  **Operator action required.** After pulling this release, update local `deployment/.env.ornn`:

  - Rename `ORNN_API_PORT` → `PORT`, `ORNN_API_LOG_LEVEL` → `LOG_LEVEL`, `ORNN_API_LOG_PRETTY` → `LOG_PRETTY`.
  - Add `AGENTSEAL_PYTHON` (default `/opt/agentseal/bin/python`), `AGENTSEAL_SCRIPT` (default `/opt/agentseal/scan_skill.py`), and `ORNN_URL_ALLOWLIST_CIDR` (operator-explicit comma-separated allowlist of trusted hostnames + IPv4 CIDRs).
  - Remove the 11 stale vars listed above — they have no effect anymore.

  ornn-web's configmap + entrypoint were already clean — no change to web manifests.

- [#285](https://github.com/ChronoAIProject/Ornn/pull/285) [`38c4b53`](https://github.com/ChronoAIProject/Ornn/commit/38c4b53786d5389623233ea7edf5f72e0049b879) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix: relax Extras section's service-name regex to allow mixed case + dot/underscore ([#284](https://github.com/ChronoAIProject/Ornn/issues/284)).

  Was lowercase-only (`^[a-z0-9-]{1,64}$`), which rejected the legacy `EXTRA_NYXID_SERVICES` env var's own default value (`NyxID`) and any common service identifier with mixed case. Now matches the typical service-id shape: `^[A-Za-z0-9._-]{1,64}$` — covers `NyxID`, `twitter-api`, `openai_v2`, `v1.beta`. Spaces still rejected (the value flows into URL path segments where space encoding is fragile).

- [#409](https://github.com/ChronoAIProject/Ornn/pull/409) [`9c2e54f`](https://github.com/ChronoAIProject/Ornn/commit/9c2e54f357cf8b7b153e76aa8e630090556d8f56) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Upgrade `zod` 3 → 4 across the workspace. Three mechanical breaking-change fixes: `z.record(X)` → `z.record(z.string(), X)`, `invalid_type_error` constructor option → `error` callback, and a one-line type bridge for `zod-to-json-schema` while the upstream package catches up to v4. No runtime behaviour change.

## 0.5.0

### Minor Changes

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: delete a non-latest skill version ([#183](https://github.com/ChronoAIProject/Ornn/issues/183)). New endpoint `DELETE /api/v1/skills/:idOrName/versions/:version` (owner or `ornn:admin:skill`). Refuses to delete the only remaining version (use `DELETE /skills/:id`) or the current latest (publish a newer version first). The version's package zip is best-effort cleaned from storage; the row is removed from `skill_versions`. Frontend: per-row Delete button on `SkillVersionList` (owner / admin only, hidden for the latest row), confirmation modal, and a SkillDetailPage handler that toasts the result and snaps back to latest if the user was viewing the deleted version.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: redesign the GitHub-link feature around a single folder URL + manual sync.

  **Backend.**

  - New `parseGithubUrl(url)` helper accepts the canonical folder URL a user copies from the browser address bar (e.g. `https://github.com/owner/repo/tree/<ref>/<path>`) and returns `{ repo, ref, path }`. Bare-repo URLs and the `tree/<ref>` form (no path) work too. `blob/` URLs and non-github hosts are rejected. 11 unit tests.
  - New endpoint `PUT /api/v1/skills/:id/source` attaches (or clears, with `{ githubUrl: null }`) a GitHub source pointer on an existing skill _without_ pulling. Auth: skill author or platform admin + `ornn:skill:update`. Lets a user link an originally hand-uploaded skill to its GitHub source first and trigger the sync separately. The stored `source` is missing `lastSyncedAt`/`lastSyncedCommit` until the first sync.
  - `POST /api/v1/skills/:id/refresh` now accepts `{ dryRun?: boolean, skipValidation?: boolean }`. When `dryRun: true`: pulls from the linked source, computes a structured diff against the current latest version, and returns `{ skill, source, pendingVersion, hasChanges, diff }` without bumping. Powers the preview-then-confirm flow on the detail-page Advanced Options panel. When `dryRun: false`: existing behavior; `skipValidation` opts out of the format validator on the pulled package.
  - `POST /api/v1/skills/pull` now accepts `githubUrl` (preferred) alongside the existing `repo`/`ref`/`path` form, so the build flow can post the same single-URL form the panel uses.
  - `SkillSource.lastSyncedAt` / `lastSyncedCommit` are now optional on both the API and SDK shape, reflecting the new "linked but never synced" state.
  - New activity-log entries `skill:source_link` / `skill:source_unlink`.

  **Frontend.**

  - New "Link to GitHub" panel inside the `AdvancedOptionsModal` on the skill detail page. Single URL input, skip-validation checkbox, plus Save / Sync / Unlink buttons. Sync runs the dry-run preview → if no changes detected, toasts "already in sync"; otherwise switches the panel into a Sync-preview view that renders the diff via the new `VersionDiffView` component and asks the user to confirm with an "Apply sync" button.
  - `VersionDiffView` is a new pure renderer extracted from `VersionDiffModal` (which now consumes it) so the diff layout is shared between the version-compare modal and the GitHub sync preview.
  - `/skills/new/from-github` page redesigned to take a single GitHub folder URL + skip-validation toggle. Submitting calls `POST /skills/pull` with the URL and routes the user to the new skill's detail page.
  - New API client functions `setSkillSource`, `previewSkillRefresh`, plus hooks `useSetSkillSource`, `usePreviewSkillRefresh`. `useRefreshSkillFromSource` now takes `{ guid, skipValidation? }` so the Apply-sync step can opt out of validation.
  - en + zh translations.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: M3 polish batch — async audit lifecycle (running/completed/failed status with background pipeline + history polling), `Start Auditing` button moves out of `PermissionsModal` into its own slot under Manage permissions, sharing now requires a pre-existing completed audit (returns `AUDIT_REQUIRED` rather than auto-running), dedicated `/skills/:idOrName/audits` page replaces the squashed sidebar card, full Chinese translation rewrite + new `BackLink` component on every sub-page, and three M3 bug fixes ([#184](https://github.com/ChronoAIProject/Ornn/issues/184) `/my-shares` back nav, [#185](https://github.com/ChronoAIProject/Ornn/issues/185) `/reviews` back nav, [#186](https://github.com/ChronoAIProject/Ornn/issues/186) reviewer cannot accept/reject — `shareService.get()` now authorizes org-target reviewers via `reviewerOrgIds`). Also: `ornn-api` deployment gains the `MINIO_HOST_ALIAS_IP` `hostAlias` so the audit path can fetch presigned skill ZIPs in-cluster.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: per-version audit history + analytics filtering ([#181](https://github.com/ChronoAIProject/Ornn/issues/181)) and skill pull tracking with time-bucket aggregation ([#182](https://github.com/ChronoAIProject/Ornn/issues/182)).

  Backend: `GET /api/v1/skills/:idOrName/analytics` and `/audit/history` accept `?version=`. New `GET /api/v1/skills/:idOrName/analytics/pulls?bucket=hour|day|month&from=&to=&version=` returns bucketed pull counts grouped by source (api/web/playground). Three endpoints now emit fire-and-forget pull events into a new `skill_pulls` collection: `GET /skills/:idOrName/json` (api), `GET /skills/:idOrName` (web), `POST /playground/chat` when bound to a skill (playground). Analytics failures are swallowed and never surface to clients.

  Frontend: `AuditHistoryCard` and `AnalyticsCard` accept a `version` prop and pass it through; the dedicated `/skills/:idOrName/audits` page reads `?version=` from the URL so version selection on `SkillDetailPage` propagates to the deep-link. New `useSkillPulls` hook ready for the chart UI in [#187](https://github.com/ChronoAIProject/Ornn/issues/187).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: per-version audit badges + share scheme B ([#188](https://github.com/ChronoAIProject/Ornn/issues/188)).

  **Backend.** New `GET /api/v1/skills/:idOrName/audit/summary-by-version` returns the most recent _completed_ audit for each version of a skill. `AuditRepository.findLatestCompletedPerVersion` is one Mongo aggregation (`$match status:completed → $sort createdAt -1 → $group _id:version $first:doc`); `AuditService.summaryByVersion` exposes it as `Record<version, AuditRecord>`. Visibility mirrors the rest of the audit endpoints.

  **Frontend.** New `useAuditSummaryByVersion` hook + `fetchAuditSummaryByVersion` service; `useStartAudit` invalidates this key alongside the history keys. `SkillVersionList` accepts an `auditSummary` prop and renders an `AuditPill` next to each version row (green / yellow / red verdict pill, or a neutral "?" pill for versions that never had a completed audit). `SkillDetailPage` mounts a one-line cautionary banner above the main grid when the currently-viewed version is yellow / red / not-yet-audited; green is silent. Banner has a deep link to `/skills/:idOrName/audits?version=` so the user lands on that version's audit history. en/zh translations added.

  **Share semantics — scheme B confirmed in code.** The share gate already only consumes the _latest version's_ completed audit (`shareService.initiateShare` looks up via `auditService.getAudit(skill.guid, skill.version)`). Older versions keep whatever audit they had; consumers see the per-version pill. Documented in `agent-manual.md` already ([#192](https://github.com/ChronoAIProject/Ornn/issues/192)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: audit-gated permissions pipeline. `PUT /api/v1/skills/:id/permissions` now orchestrates the full audit + waiver flow — removals apply immediately, new grants (user/org/public) run a cached audit (30-day TTL per skill version) and either auto-apply when `overallScore >= platform threshold` or create a waiver request requiring owner justification + reviewer decision. The dedicated `POST /api/v1/skills/:idOrName/share` endpoint + the separate "Share" button are gone — everything happens through "Manage permissions". Threshold is admin-configurable at `/admin/settings` (default 6.0, range 0–10). The PermissionsModal shows a three-phase UX (form → running → results) so the user can see the audit progress and act on any flagged targets inline.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor: share is unconditional, audit is a passive risk label ([#197](https://github.com/ChronoAIProject/Ornn/issues/197)).

  `PUT /api/v1/skills/:id/permissions` now applies the requested allow-list as-is — no `AUDIT_REQUIRED`, no waiver flow, no reviewer queue. The whole `shares/` domain (api) + share UI pages / hooks / services (web) are deleted.

  Audit completion now fans out two notification categories:

  - `audit.completed` — owner, every audit (different copy for `green` vs `yellow`/`red`).
  - `audit.risky_for_consumer` — every consumer of a `yellow`/`red` audited skill (`sharedWithUsers` plus every org member resolved via NyxID).

  `NotificationCategory` is trimmed to those two values and `NyxidOrgsClient.listOrgMembers` (SA token) is wired so the audit pipeline can expand org grants to their membership.

  Deploy note: the `share_requests` collection should be dropped from MongoDB on the next deploy. No backwards-compat preserved.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: two history surfaces for the sharing workflow. Adds `/my-shares` (linked from the profile dropdown) showing every share request the caller initiated — pending, decided, cancelled — with an Active/Decided filter. Adds `/admin/review-history` (linked from the admin sidebar) showing every share request the caller has accepted or rejected, sourced from the new `GET /api/v1/shares/reviewed-history` endpoint on the backend.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - System skills + registry redesign:

  - **Skill ↔ NyxID-service tie.** A skill can be linked to a NyxID catalog service via `PUT /api/v1/skills/:id/nyxid-service`. Tying to an admin-tier service (`visibility: "public"` in NyxID) marks the skill `isSystemSkill: true` and atomically forces `isPrivate: false`. Personal-tier ties leave privacy alone. New `GET /api/v1/nyxid-services/:serviceId/skills` reverse-lookup. `GET /api/v1/me/nyxid-services` redefined to return catalog rows with a `tier` field. New `SYSTEM_SKILL_MUST_BE_PUBLIC` invariant blocks `PUT /skills/:id/permissions` and `PUT /skills/:id` from flipping a system skill private.
  - **Registry redesign.** New "System Skills" tab (default landing). Two-column layout per tab: search bar up top, sidebar filter chips on the left, cards on the right. Per-tab filters: System → service; Public → tags + authors; My Skills → tags + grant-orgs + grant-users; Shared with me → source-orgs + source-users. All filter state URL-encoded.
  - **New facet endpoints.** `/skill-facets/tags?scope=...`, `/skill-facets/authors?scope=...`, `/skill-facets/system-services` aggregate visibility-scoped chip data.
  - **Search params extended.** `/skill-search` now accepts `nyxidServiceId` (single id) and `tags` (CSV, AND-match).
  - **Skill detail polish.** New NyxID-service tie card + modal next to permissions. Skill content section capped at `min(80vh, viewport-140px)` with internal scroll. "Skill pulls" chart renamed to "Skill Usage", switched from stacked bars to multi-line, fixed canned windows (24h / 7d / 12mo) with full bucket padding, recolored to the editorial-forge palette.
  - **Docs become a system skill.** The `agent-manual.md` + 14 `api-*.md` docs-site pages are deleted. Their content is republished as the `ornn-agent-manual` Ornn skill (source at `skills/ornn-agent-manual/`, `SKILL.md` + `references/api-reference.md`, v2.2). Pull it via `GET /api/v1/skills/ornn-agent-manual/json`.

### Patch Changes

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(infra): pin bun in both Dockerfiles + copy real sibling workspace package.jsons instead of stubbing.

  Caught while redeploying locally: a fresh `--no-cache` build of `ornn-web` failed at typecheck with `Cannot find module 'zustand'`. `bun install` ran successfully but skipped hoisting some transitive deps because the stubbed `ornn-api` / `ornn-sdk` `package.json` files (`{"name":"...","version":"...","private":true}` — no `dependencies` block) misled bun's hoister. The host's pinned bun (`1.3.8`) hoisted those deps fine; the floating `oven/bun:latest` had already moved to `1.3.13`, which behaves differently here.

  Two-line repro of the hoister mismatch:

  ```
  COPY ornn-api/package.json ornn-api/   # real, with deps
  COPY ornn-sdk/package.json ornn-sdk/   # real, with deps
  ```

  …replaces the previous `RUN mkdir … && echo '{}' > …/package.json` stubs that used to drift away from `bun.lock`.

  Both Dockerfiles now:

  - **Pin to `oven/bun:1.3.13`** (was `oven/bun:latest`). Stops surprise-upgrades from breaking the build.
  - **Copy the real workspace `package.json` files** for every sibling the lockfile references, instead of stubbing them. Keeps `bun.lock` + the on-disk workspace graph consistent.

  No runtime behaviour changes — pure build-pipeline reliability.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Polish + docs stack landing after [#228](https://github.com/ChronoAIProject/Ornn/issues/228):

  **ornn-api**

  - Search projects `hasGithubSource: boolean` on every row so cards can render the github mark without an extra fetch.
  - `mapDoc` no longer fabricates an `Invalid Date` when `source` was linked but never synced.

  **ornn-web**

  - Skill detail hero strip: small github icon button immediately to the left of "Try in Playground" for github-linked skills (opens the deep-linked folder in a new tab).
  - Explore card: small non-clickable github mark in the badge cluster on github-linked skills.
  - Advanced Options modal: fixed 80vh shell with left rail + right pane scrolling independently — long sync-preview content no longer stretches the modal.
  - Build page (`/skills/new`): four mode cards now share a uniform primary CTA, pinned to the card bottom via `mt-auto`. Labels shortened (Start / Start / Start / Import) so they fit at any card width. `/skills/new/from-github` rewritten to take a single GitHub folder URL + skip-validation toggle (matches the panel UX).
  - Install-skill prompt: settled on a uniform "every Ornn API call goes through NyxID's proxy regardless of skill visibility" framing — Option A NyxID CLI, Option B direct HTTPS bearer. Earlier visibility-branched iteration was reverted because anonymous fetch always 401s through the NyxID proxy layer.
  - Docs site refreshed against current state. Three vs-\* comparison pages (Vercel skills.sh / SkillMP / raw GitHub) folded as evidence sections inside a single "Why Ornn?" page; Technical References section dropped. New Agent Manual quick-start page describing the `ornn-agent-manual-{cli,http}` system skills and how to access them. What is Ornn + Web Users quick start refreshed.

  **Skill manuals**

  - `ornn-agent-manual-cli` and `ornn-agent-manual-http` bumped to v1.1. §2.7 rewritten as "Compare diff between two skill versions"; §2.10 expanded to "Delete or deprecate a single version"; new §2.14 "Link a skill to GitHub or trigger a sync" (three flows + error catalogue). `references/api-reference.md` updated for `POST /skills/pull` (`githubUrl` field), `POST /skills/:id/refresh` (`dryRun` + `skipValidation`), and a new §3.15 (`PUT /skills/:id/source`).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(api): `GET /shares/review-queue` was 404 because the wildcard `/shares/:requestId` route was registered first and captured the literal segment as a `requestId`. Reorder so static paths (`/shares`, `/shares/review-queue`) are registered ahead of the dynamic one.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(api): `POST /api/v1/skill-format/validate` now returns every rule violation in the package, not just the first one that throws. Previously the route was discarding the array `validateZipFormat` returned and only catching thrown errors, so packages whose violations were collected (rather than thrown) came back as `valid: true` even when the upload path would later reject them. Response on failure is now `{ data: { valid: false, violations: [{ rule, message }, ...] } }` covering every fired rule, so a calling agent / SDK can fix every problem in one round-trip. Three integration tests added (valid case, single YAML-parse violation, multiple independent violations).

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
