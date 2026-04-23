# ornn-web

## 0.3.1

### Patch Changes

- [#131](https://github.com/ChronoAIProject/Ornn/pull/131) [`b8fc37a`](https://github.com/ChronoAIProject/Ornn/commit/b8fc37a39d9cc1e03b3cb5aa63978bf34661fcf7) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Smoke test for the new push-to-main release workflow (PR [#130](https://github.com/ChronoAIProject/Ornn/issues/130)). This changeset forces a v0.3.1 patch bump with no functional change; it exists so State A → State B can be exercised end-to-end on a live release cycle.

## 0.3.0

### Minor Changes

- [#99](https://github.com/ChronoAIProject/Ornn/pull/99) [`4f77e60`](https://github.com/ChronoAIProject/Ornn/commit/4f77e60449d118a831b977e4b8dce0027c9dc681) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Move docs (product guides + release notes) from backend to frontend static build. `/api/docs/tree`, `/api/docs/content/:lang/:slug`, `/api/docs/releases`, `/api/docs/releases/:version` are removed; `ornn-api` no longer serves docs traffic, no longer ships `ornn-api/docs/`, and `ornn-web/nginx.conf` drops the `/api/docs/` bypass. `ornn-web` loads markdown at build time via Vite `import.meta.glob`. Closes [#40](https://github.com/ChronoAIProject/Ornn/issues/40).

- [#101](https://github.com/ChronoAIProject/Ornn/pull/101) [`3602a50`](https://github.com/ChronoAIProject/Ornn/commit/3602a507086b7ff8a3fb4409093614af15ec20e8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - M1 sprint — `/api/v1/` prefix cut (closes [#68](https://github.com/ChronoAIProject/Ornn/issues/68)), route-level React.lazy code splitting (drops initial bundle from ~2 MB to ~335 kB), and integration test harness seed under `ornn-api/tests/integration/` (part of [#72](https://github.com/ChronoAIProject/Ornn/issues/72)).

- [#117](https://github.com/ChronoAIProject/Ornn/pull/117) [`ab47878`](https://github.com/ChronoAIProject/Ornn/commit/ab4787858c7bf2f5ef82d59dcf7251b6d7112226) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Convert ornn-web config from build-time to runtime. Both the nginx upstream URLs (`NYXID_BACKEND_URL`, `ORNN_API_URL`) and the Vite-side `VITE_NYXID_*` / `VITE_API_BASE_URL` values are now injected at container startup via the new `ornn-web-config` ConfigMap instead of being baked into the image. `nginx.conf` → `nginx.conf.template` (envsubst'd by the image's built-in 20-envsubst-on-templates.sh); a new 40-envsubst-config-js.sh script generates `/config.js` from a template, which sets `window.__ORNN_CONFIG__` before the main bundle loads. A new `src/config.ts` module is the single entrypoint for config reads (falls back to `import.meta.env.VITE_*` for `bun run dev` / Vitest). `VITE_NYXID_SETTINGS_URL` was used in code but missing from the Dockerfile ARG list — now covered as part of the runtime config. Drops all `--build-arg VITE_*` from the frontend `docker build` command in CLAUDE.md; one image now runs across every environment.

### Patch Changes

- [#120](https://github.com/ChronoAIProject/Ornn/pull/120) [`322a154`](https://github.com/ChronoAIProject/Ornn/commit/322a1546be90523c34ca1a12a17e1930c6522cb9) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Drop the `location = /api/v1/openapi.json` block from `ornn-web/nginx.conf.template` — no frontend code fetches it (the spec URL built in `ServiceDetailPage.tsx` / `GenerateSkillModal.tsx` goes through the NyxID proxy, not nginx). `/health`, SSE passthrough, gzip, static caching, SPA fallback, and NyxID X-Forwarded headers are kept.

- [#113](https://github.com/ChronoAIProject/Ornn/pull/113) [`e8a8311`](https://github.com/ChronoAIProject/Ornn/commit/e8a8311b23b104562a991439c6d986e419611786) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Drop the MinIO-specific proxy from `ornn-web/nginx.conf` and its frontend companion `toBrowserAccessibleUrl` in `useSkillPackage.ts`. These were local-dev bandaids that got baked into the production nginx image, causing deploys to fail with `host not found in upstream "minio"` on clusters without a MinIO service. Local dev now exposes MinIO through a dedicated ingress (`deployment/dependencies/minio/ingress.yaml`) at `minio.ornn-cluster.local`.

- [#123](https://github.com/ChronoAIProject/Ornn/pull/123) [`16b5d1d`](https://github.com/ChronoAIProject/Ornn/commit/16b5d1deada51763addf4e367086070437c42ff1) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fix `ornn-web-config` ConfigMap accidentally reusing ornn-api's `NYXID_TOKEN_URL` / `NYXID_CLIENT_ID` values. ornn-api wants internal K8s DNS + a service-account client; ornn-web needs a browser-reachable URL + a user-facing OAuth client. The ConfigMap now sources ornn-web's two vars from dedicated `.env.ornn` entries (`NYXID_WEB_TOKEN_URL`, `NYXID_WEB_CLIENT_ID`); the container env keys stay `NYXID_TOKEN_URL` / `NYXID_CLIENT_ID` so no frontend code change is needed.

## 0.2.0

### Minor Changes

- [#51](https://github.com/ChronoAIProject/Ornn/pull/51) [`88e53fc`](https://github.com/ChronoAIProject/Ornn/commit/88e53fc11e6e0ce8c03a46a4a29b96aac3cbd7af) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add My NyxID Services and Admin NyxID Services pages with user-dropdown links. Filters auto-connected services using `requires_connection` and `auto_connected`.

- [#52](https://github.com/ChronoAIProject/Ornn/pull/52) [`3cf96eb`](https://github.com/ChronoAIProject/Ornn/commit/3cf96eb25f75563526669938354a5f3e092408a3) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add Service Detail page showing endpoint list parsed from the service OpenAPI spec, fetched via the NyxID proxy to avoid mixed-content blocks.

- [#53](https://github.com/ChronoAIProject/Ornn/pull/53) [`223a21f`](https://github.com/ChronoAIProject/Ornn/commit/223a21ffb1ec5e505018f7cfb451f7f5c2ae4b8d) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add skill generation wizard with multi-step flow, reference selection, and progress UI during generation.

- [#63](https://github.com/ChronoAIProject/Ornn/pull/63) [`3b81a68`](https://github.com/ChronoAIProject/Ornn/commit/3b81a68dea4adb7c9969b07c74de23d266958dc8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill registry reorganized around access scope: new 3-tab layout (Public / My Skills / Shared with me) with per-tab counts and filter chips for grant orgs/users. System-skill classification is now derived per-caller from NyxID user-service tag matches rather than stored as a dedicated field. Permissions modal redesigned into three access tiers (Public / Limited / Private) with co-equal Org + User grant channels, focus-open email picker, and chip labels that resolve to real names via a new `/api/users/resolve` endpoint. Backend write paths now read user identity from the decoded NyxID identity token instead of the X-User-\* headers that the proxy strips, fixing stale empty `userEmail`/`userDisplayName` fields that caused raw GUIDs to render in UI bylines. Theme-aware Logo component with dark/light variants and reorganized profile dropdown.

- [#61](https://github.com/ChronoAIProject/Ornn/pull/61) [`b7adc99`](https://github.com/ChronoAIProject/Ornn/commit/b7adc99c059f07dac18063c172771200e1225ec1) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill Topics ([#56](https://github.com/ChronoAIProject/Ornn/issues/56)): a new primitive for grouping skills. A `Topic` is a named, owner-curated group with its own privacy flag; skills belong to many topics via a separate `topic_skills` edge collection so neither side carries back-pointing arrays.

  **Backend.** Endpoints: `POST /api/topics`, `GET /api/topics`, `GET /api/topics/:idOrName`, `PUT /api/topics/:id`, `DELETE /api/topics/:id`, `POST /api/topics/:id/skills`, `DELETE /api/topics/:id/skills/:skillGuid`. `GET /api/skill-search` also accepts an optional `?topic=<name>` filter. Topic names are globally-unique kebab-case and immutable; visibility rules mirror skills (private topic → owner + admin only; a private skill placed in a public topic stays hidden from non-authorized viewers). Skill hard-delete cascades membership. No migration required.

  **Frontend.** New Topics tab on Registry, `/topics/:idOrName` detail page, create / edit / delete modals, add-skills picker (multi-select search across public + user's private skills), per-card remove button on the topic detail page, and a topic-filter dropdown on the Public / My Skills tabs that narrows results to a topic's members.

- [#59](https://github.com/ChronoAIProject/Ornn/pull/59) [`16a32f5`](https://github.com/ChronoAIProject/Ornn/commit/16a32f5404f66a2b38dd66c2f3c8f53f867e8608) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Skill versioning ([#25](https://github.com/ChronoAIProject/Ornn/issues/25)): SKILL.md requires a 2-digit `version` field; each publish snapshots an immutable row in the new `skill_versions` collection with its own storage key. New endpoints `GET /api/skills/:idOrName?version=X.Y`, `GET /api/skills/:idOrName/versions`, and `PATCH /api/skills/:idOrName/versions/:version` (deprecation toggle). Package updates enforce a strictly-greater version and reject interface-breaking changes without a major bump (409 `BREAKING_CHANGE_WITHOUT_MAJOR_BUMP`). Skill detail page adds a version picker, history list, and deprecation banner with owner/admin deprecation controls. **Requires running `bun run migrate:versions` in `ornn-api` against any pre-existing database** — see `docs/migrations.md`.

- [#50](https://github.com/ChronoAIProject/Ornn/pull/50) [`eaf33de`](https://github.com/ChronoAIProject/Ornn/commit/eaf33de3b36f0612d41756397f820c1dffbed163) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add System Skills tab in Registry, sourced from the NyxID service catalog. Supports admin table view and user card view; generates skills from service OpenAPI specs via NyxID proxy (SSRF-safe, user-token forwarded).

- [#58](https://github.com/ChronoAIProject/Ornn/pull/58) [`ff33eff`](https://github.com/ChronoAIProject/Ornn/commit/ff33effad8371b85cfac78b984eea41855d33f3a) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Add "Try with Nyx CLI" button on skill detail pages — copies a NyxID-CLI-based prompt (4 steps: prerequisites check, fetch, dependency verification, execute) so users can paste into any agent to run the skill. Also brings System Skills tab to feature parity with Public/My Skills (keyword search + pagination), backed by a new searchable `/api/system-skills` endpoint.

- [#46](https://github.com/ChronoAIProject/Ornn/pull/46) [`01b4f93`](https://github.com/ChronoAIProject/Ornn/commit/01b4f9397d72607b77cac3e60b1c39f50e1f781f) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Unify API routes under `/api` prefix. All traffic now flows through NyxID proxy; JWT self-verification and `jose` dependency removed. Frontend service paths updated from `/api/web/*` to `/api/*`.

### Patch Changes

- [#75](https://github.com/ChronoAIProject/Ornn/pull/75) [`61a5eac`](https://github.com/ChronoAIProject/Ornn/commit/61a5eac3c4279d666b1b91c01c82ae8f8da34b9b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Epic 1 foundations (part of [#66](https://github.com/ChronoAIProject/Ornn/issues/66)):

  - **Config**: `ornn-api/src/infra/config.ts` rewritten on top of Zod. Missing or invalid env vars throw `ConfigError` with a full summary of every violation; library code no longer calls `process.exit()` (the entry point owns that).
  - **Request correlation**: new `requestIdMiddleware` generates or echoes `X-Request-ID` per request, exposes it via response header, and threads it through structured logs and the global error handler.
  - **Kubernetes probes**: split `/health` into `/livez` (liveness — no dependency checks) and `/readyz` (pings Mongo with a 2s timeout; 503 when unreachable). `/health` kept as a backward-compat alias for the liveness handler.
  - **Frontend `apiClient`**: removed dead `X-User-Email` / `X-User-Display-Name` headers (stripped by the NyxID proxy, not read by the backend). Stopped triggering token refresh on 403 responses — 403 means permission denied, not token expiry, so the previous retry path hammered the refresh endpoint on legitimate authorization failures.

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

## 0.1.3

### Minor Changes

- **Ornn Core Skills UI** — Core skills section with multi-platform installation prompts
- **Go to NyxID** — Quick link to NyxID from profile dropdown menu
- **Version Roadmap** — New page listing all released versions with details
- **One-Click Copy** — Code blocks in documentation now have a copy button
- **Updated Documentation** — Rewritten quick start guide with real examples

## 0.1.2

### Minor Changes

- **Skill Playground Chat** — Interactive AI-powered chat interface for testing skills with real-time streaming.
- **Login Session Fix** — Fixed login session loss after page refresh or access token expiry. Sessions now persist correctly across page reloads.

## 0.1.0

### Minor Changes

- **NyxID Login UI** — OAuth login flow and API key access interface.
- **Skill Creation Wizard** — Guided, free upload, and AI generation modes.
- **Skill Playground UI** — Interactive sandbox playground for testing skills.
- **Skill Library** — Browse and search skills with keyword and semantic search.
- **Admin Dashboard** — User and skill management interface.
- **English & Chinese** — Full bilingual support with language switching.
- **Dark & Light Mode** — Theme switching support.
