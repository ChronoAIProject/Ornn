# ornn-web

## 0.7.1

### Patch Changes

- [#487](https://github.com/ChronoAIProject/Ornn/pull/487) [`a683328`](https://github.com/ChronoAIProject/Ornn/commit/a6833283efdbe345dfa16fa1b7f4a68c0a6e26e2) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Web copy + layout polish (patch). The Contact page is restructured into a three-channel routing guide — `support@chrono-ai.fun` for private matters, GitHub Discussions for public community Q&A / ideas / show-and-tell, GitHub Issues / PRs for actionable maintainer work — with a per-category quick-jump table for all six GitHub Discussions categories. The cookie consent banner is now vendor-agnostic; the third-party analytics processor name is no longer inlined in the consent copy (still itemised in the privacy policy where it belongs). No behaviour change in `ornn-api` itself — patch bump because the two repos are version-linked in fixed mode.

## 0.7.0

### Minor Changes

- [#455](https://github.com/ChronoAIProject/Ornn/pull/455) [`cb24ec8`](https://github.com/ChronoAIProject/Ornn/commit/cb24ec845e7abf135363311e5b48a59054394b72) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - In-process GitHub mirror reconcile scheduler with admin-configurable cadence ([#437](https://github.com/ChronoAIProject/Ornn/issues/437)). The k8s `CronJob` is gone — the periodic mirror reconcile now runs inside the `ornn-api` pod via Agenda, multipod-safe via per-fire row locking on a shared MongoDB collection. The schedule is editable on the admin GitHub mirror settings page (preset dropdown + custom cron), interpreted in Singapore time (UTC+8, no DST), defaulting to `0 2 * * *` (daily 2am SGT). Empty schedule disables the scheduled reconcile without affecting publish-time webhooks. Mirror configuration is now unified under `SettingsService` — a one-shot boot migration copies any legacy `platform_settings.githubMirror` values into the new section on first boot.

- [#476](https://github.com/ChronoAIProject/Ornn/pull/476) [`f8d45d1`](https://github.com/ChronoAIProject/Ornn/commit/f8d45d1b8906604b236d184ea5f039ee8bac7bb7) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Surface last-run status of the scheduled mirror reconcile ([#475](https://github.com/ChronoAIProject/Ornn/issues/475)). Both the GitHub mirror settings page and the legacy mirror dashboard now show whether the most recent _scheduled_ fire succeeded, failed (with the error message), is currently running, or hasn't happened yet — sourced from Agenda's persisted recurring-job doc so the view is consistent across pods and survives restarts. The previous in-process `lastReconcile` block on `GET /admin/mirror/status` is replaced with a new `scheduledRun` block. Manual `Reconcile now` clicks from the dashboard still work but do not appear in this widget; the 409 "already running" guard on the manual reconcile endpoint is unchanged.

## 0.6.0

### Minor Changes

- [#303](https://github.com/ChronoAIProject/Ornn/pull/303) [`5bc542a`](https://github.com/ChronoAIProject/Ornn/commit/5bc542a0ba1a8b93e68adf2e1066491dd8ec2543) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Admin settings reorganization. Trims admin Settings from 11 sections to 9 by folding domain-specific knobs into the section that actually owns them:

  - **Quota Defaults → Playground + Skill Generation.** The standalone `quotaDefaults` section is gone. `defaultMonthlyQuota` lives on each surface's own section.
  - **Other Services → NyxID Integration.** The standalone `services` section is gone. `chronoStorageUrl`, `chronoStorageBucket`, `chronoSandboxUrl` live on the `integrations/nyxid` section.
  - **Telemetry → PostHog.** Renamed UI title and API public path (`/admin/settings/telemetry` → `/admin/settings/posthog`). Section id stays `telemetry` so existing Mongo rows keep their `_id`.
  - **Extras → Service Binding List Configuration.** UI label only.

  Operator action on redeploy: re-enter `defaultMonthlyQuota` under Playground + Skill Generation, and the chrono-storage / chrono-sandbox endpoints under NyxID Integration. The previous `quotaDefaults` and `services` Mongo rows become orphans — safe to leave or drop.

  Closes [#302](https://github.com/ChronoAIProject/Ornn/issues/302).

- [#257](https://github.com/ChronoAIProject/Ornn/pull/257) [`ff67729`](https://github.com/ChronoAIProject/Ornn/commit/ff67729beea3329be5a9a57e22c60fac5c9de65b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: PostHog browser SDK + AgentSeal trust badge.

  [#252](https://github.com/ChronoAIProject/Ornn/issues/252) — wires PostHog as Ornn's product analytics layer in `ornn-web`. Browser SDK installs at app root via a new `PostHogProvider`; auto-pageview is on, SPA navigation is captured through React Router's `useLocation`, and `identify` runs on every NyxID login (and tab-restore) with email / displayName / isAdmin traits. A GDPR-compliant cookie consent banner ships on by default — analytics stay opted out until Accept is clicked, and revoking consent stops session replay + resets the distinct id. Custom events emit at the listed call sites: `skill.created` / `skill.published` / `skill.version_published` (every create + version publish path), `playground.run` / `.completed` / `.failed`, `skill_gen.started` / `.completed`, `model.selected`, `login.completed`. Config (`POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`) is runtime-injected via `window.__ORNN_CONFIG__` — empty values disable analytics entirely so previews and local dev keep working without a live project.

  [#253](https://github.com/ChronoAIProject/Ornn/issues/253) — adds the AgentSeal trust badge to the skill detail page. Reads `agentsealScan = { score, findings, scannedAt, version }` off the resolved skill version, color-codes the badge across five bands (excellent / high / medium / low / critical) on the Industrial Forge palette (DESIGN.md mineral state tokens — never raw consumer greens / reds), and surfaces an expandable findings list sorted worst-first under the badge. Unscanned skills get a `Not scanned` tile with the same silhouette so the right-rail spacing stays consistent.

- [#289](https://github.com/ChronoAIProject/Ornn/pull/289) [`a7b0a00`](https://github.com/ChronoAIProject/Ornn/commit/a7b0a005be3e196ab0eb33bcd159dc93cd93b314) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat(web): add public `/contact` page ([#278](https://github.com/ChronoAIProject/Ornn/issues/278)) with email, GitHub, Xiaohongshu (placeholder), and workshop/location card; wire `Contact` link into both `Navbar` (app shell) and `LandingNav` (landing) — desktop + mobile collapsed panel.

  Page follows DESIGN.md "Whole-App Application Guidance → App Shell": cool steel-paper page background inherited from `RootLayout`, letterpress impression on cards via `card-impression`, bracketed mono section label, Space Grotesk display headline with `<HighlighterMark>` on the emphasis noun, JetBrains Mono for technical metadata (email + repo URL), Inter body for prose. No backend / no contact form — email is a `mailto:` link, GitHub points at `https://github.com/ChronoAIProject/Ornn`. Xiaohongshu URL is a TODO marker until the real handle ships.

  i18n: adds `nav.contact` and a new `contact.*` namespace in both `en.json` and `zh.json` using the same `headlineStart` / `headlineHighlight` / `headlineEnd` split pattern landing already uses for highlighter-mark headlines.

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

- [#351](https://github.com/ChronoAIProject/Ornn/pull/351) [`f0ba7ba`](https://github.com/ChronoAIProject/Ornn/commit/f0ba7bab96b1a386c0e812d9d4c3945f02831775) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Close out the i18n coverage milestone for `ornn-web`. ~363 new i18n keys land in `en.json` + `zh.json` with full locale parity; ~110 source files updated; the services-layer error pattern is restructured so locale switching actually reaches user-visible error toasts and panels.

  What lands per issue:

  - **[#344](https://github.com/ChronoAIProject/Ornn/issues/344) — Shared controls + drawer Close.** `Button` accepts an optional `loadingText` prop defaulting to `t("common.loading")` so every loading button localises automatically. `Toast`, `CategoryTooltip`, and `UnsavedChangesGuard` go through new `common.aria.*` / `common.unsavedChanges` keys. Drawer `"Close"` aria-labels across QuotaUserDetailDrawer + RedemptionCodeDetailDrawer reuse existing `common.close`.
  - **[#346](https://github.com/ChronoAIProject/Ornn/issues/346) — aria-label sweep.** All screen-reader-visible aria-label and title attributes across landing pages, global chrome (Navbar / Sidebar), playground, and admin chart/table widgets now live under a flat `aria.*` namespace. Brand-bearing labels use `t("aria.brandHome", { brand })` interpolation.
  - **[#345](https://github.com/ChronoAIProject/Ornn/issues/345) — Form / skill / settings / user / editor components.** Placeholders, modal titles, button labels, help text, empty states, and section headings across `components/form/*`, `components/skill/*`, `components/settings/RedeemCodeSection`, `components/user/PhoneNumberInput`, and `components/editor/*` now route through `form.tools.*`, `skillComponents.*`, `settings.redeemCode.*`, `userProfile.*`, `editor.*`, and `githubLink.urlPlaceholder`.
  - **[#343](https://github.com/ChronoAIProject/Ornn/issues/343) — Admin pages + settings sections + `adminMirror` backfill.** Every admin page table header, modal copy, tab label, toast, and confirm dialog goes through `adminPages.*` keys. Settings sections (`Mirror`, `NyxID`, `Telemetry`, `SkillAudit`, `Playground`, `SkillGen`, `Extras`, `LlmProviders`, `ExportImport`) route every form label, hint, and toast through `adminSettings.sections.<name>.*`. `MirrorPage.tsx` was already calling `t("adminMirror.X", "English fallback")` but the keys never existed in either locale — they now exist with proper zh translations.
  - **[#347](https://github.com/ChronoAIProject/Ornn/issues/347) — Services / utils error-code refactor (structural).** New `utils/translateError.ts` helper parses either a JSON-encoded `{key, params}` payload or a bare `errors.foo.bar` key from `Error.message` and routes through `i18n.t()`. Services (`quotaApi`, `redemptionCodesApi`, `settingsApi`, `adminUsersApi`, `modelsApi`, `adminDashboardApi`, `auditApi`) throw i18n keys instead of English prose. `utils/zipValidator` and `utils/skillFrontmatterSchema` return structured `{key, params}` entries; `ValidationErrorPanel` consumes them via `t(entry.messageKey, entry.params)`. All component + page error sinks that previously surfaced `err.message` raw (toast.error, error-state JSX, modal bodies) now route through `translateError(err)`. New `errors.*` namespace covers all sites.
  - **[#348](https://github.com/ChronoAIProject/Ornn/issues/348) — zh translation fix.** `guided.agentLabel` translated from `"Agent"` to `"代理"`. Remaining 10 audit-flagged `zh==en` entries (URL / identifier placeholders, language-selector labels in their own native names, code-comment style strings) intentionally retained.

  Test infrastructure: vitest mock for `react-i18next` now resolves keys via `en.json` lookup before falling back to the inline default string or the key itself. Unblocks tests where bare `t("key")` calls produce locale-correct text without ad-hoc fallbacks.

  Closes [#343](https://github.com/ChronoAIProject/Ornn/issues/343), [#344](https://github.com/ChronoAIProject/Ornn/issues/344), [#345](https://github.com/ChronoAIProject/Ornn/issues/345), [#346](https://github.com/ChronoAIProject/Ornn/issues/346), [#347](https://github.com/ChronoAIProject/Ornn/issues/347), [#348](https://github.com/ChronoAIProject/Ornn/issues/348).

- [#412](https://github.com/ChronoAIProject/Ornn/pull/412) [`50b41a4`](https://github.com/ChronoAIProject/Ornn/commit/50b41a4bda0041e925b5824435a8733517de12ee) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fold the skill-detail install flow into a single tabbed card. New `SkillInstallCard` replaces the old `MirrorInstallCard` ("Install via npx") + the "Install skill to my agent" three-dots menu item with two tabs: **Via prompt** (LLM-paste-ready install instruction, always available) and **Via npx** (mirror `npx skills add ...` command, available when the deployment has the GitHub mirror configured and the skill is public). The three-dots menu is removed; **Edit skill** (owner-only) and **Download package** (when the raw ZIP is available) become small icon buttons next to the existing GitHub icon.

- [#309](https://github.com/ChronoAIProject/Ornn/pull/309) [`68d8d27`](https://github.com/ChronoAIProject/Ornn/commit/68d8d27d65c76eca0c3a8c68ec61a23af8d1cb7e) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Landing-page announcement popup with admin management. Admins can curate news / changelog blurbs from a new `/admin/announcements` page; the most recent enabled record currently within its `[startsAt, endsAt]` window is shown to every visitor (anonymous + signed-in) on the landing page, dismissible per-id via `localStorage`.

  - **API.** New `announcements` Mongo domain. Public `GET /api/v1/announcements/active` (anonymous-friendly) returns the single live record or `null`. Admin CRUD lives under `/api/v1/admin/announcements` gated on `ornn:admin:skill`.
  - **Admin UI.** Top-level `/admin/announcements` next to Skills and Quota — list table with LIVE / SCHEDULED / EXPIRED / DISABLED status, per-row enable / edit / delete, and a 560px right-edge drawer for create / edit with a markdown body preview, optional CTA pair, and optional schedule window.
  - **Landing.** New `AnnouncementPopup` mounted on `/`. One-shot per id: `localStorage` key `ornn:announcement:dismissed:<id>` keeps the same browser from being re-prompted. CTA links open in a new tab and also mark dismissed on click.

  Closes [#307](https://github.com/ChronoAIProject/Ornn/issues/307).

- [#325](https://github.com/ChronoAIProject/Ornn/pull/325) [`213197f`](https://github.com/ChronoAIProject/Ornn/commit/213197f768542d479596a7ae84d60ac07b0dc5d5) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Pre-launch landing trim + reposition:

  - Unmount the lower marketing sections (Why / Install / Featured / VS / Publish) — the hero alone carries the message at v1. Section components stay in `pages/landing/` so we can selectively remount as positioning stabilizes.
  - Hero subhead now frames Ornn as the **skill life-cycle manager** for AI agents (search / install / run / build / audit / publish), replacing the narrower "registry of composable skills" copy. Both EN and ZH updated; the static-context shorter variant follows.

  Closes [#324](https://github.com/ChronoAIProject/Ornn/issues/324).

- [#321](https://github.com/ChronoAIProject/Ornn/pull/321) [`c091adf`](https://github.com/ChronoAIProject/Ornn/commit/c091adf9e263d38bd2bc19c7c36093c330676b2b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Legal pages for launch — three deep-linkable routes:

  - `/legal/privacy` — Privacy Policy (data collected, sub-processors, DSR rights, retention)
  - `/legal/terms` — Terms of Service (eligibility, content license, AS-IS, USD 100 / 12-month liability cap, Singapore governing law)
  - `/legal/acceptable-use` — Acceptable Use Policy (malicious-code rules, AgentSeal disclosure, content rules, takedown / abuse reporting)

  All three share a `LegalLayout` shell with cross-doc nav, last-updated stamp, and footer contact. English-only at launch. Cookie consent banner now links into the Privacy Policy. Landing footer carries Privacy / Terms / Acceptable Use links.

  Also drops the placeholder Xiaohongshu card and the brand-decorative "WORKSHOP" stamp from the Contact page — both offered no contact value, the stamp wasn't even a link.

  Closes [#320](https://github.com/ChronoAIProject/Ornn/issues/320).

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

- [#260](https://github.com/ChronoAIProject/Ornn/pull/260) [`3c982a6`](https://github.com/ChronoAIProject/Ornn/commit/3c982a6324c391a9104093f1e731785b82af5abd) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat(web): per-user quota UI + admin model selection (frontend for [#250](https://github.com/ChronoAIProject/Ornn/issues/250) + [#251](https://github.com/ChronoAIProject/Ornn/issues/251)).

  - **Quota chip** ([#250](https://github.com/ChronoAIProject/Ornn/issues/250)): persistent counter pill in the top nav for authenticated users (admin-bypassed). Click → drawer with monthly base, daily ceiling, beta-credit balance, and reset times for both surfaces. Tone goes amber at 80% and red at zero.
  - **In-context displays** on the playground and skill-gen pages — compact stamp by default, soft-warning banner at 80% of monthly base, and a brand-consistent `OverLimitPage` (CTA-forward, screenshot-friendly) when the surface is exhausted.
  - **Admin grant UI** at `/admin/quota`: per-user inline `GrantCreditsForm` and bulk-select `BulkGrantCreditsModal`, plus a recent-grants audit-trail card.
  - **Model picker** ([#251](https://github.com/ChronoAIProject/Ornn/issues/251)) on playground + skill-gen: dropdown sourced from the admin-curated catalog, ordered default-first. Selection persists per-surface via `localStorage` (`ornn.preferredModel.playground`, `ornn.preferredModel.skillGen`); stored values that the admin later disables silently fall back to the surface default without clearing storage.
  - **Admin Models** page at `/admin/models`: catalog list with per-surface enable toggles, default radios, archived flag, refresh-from-upstream button, and search.
  - Wires `modelId` through the playground and skill-gen SSE clients so the picker's choice reaches the backend resolver added in [#258](https://github.com/ChronoAIProject/Ornn/issues/258).

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

- [#299](https://github.com/ChronoAIProject/Ornn/pull/299) [`14ee154`](https://github.com/ChronoAIProject/Ornn/commit/14ee15498331e71fc86ca619766bbe2fca022285) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Stop proxying ornn-api requests through ornn-web's nginx. The SPA now hits NyxID's proxy URL directly via `ORNN_API_BASE_URL=https://<nyxid>/api/v1/proxy/s/ornn-api`. Fixes a 502 regression from [#295](https://github.com/ChronoAIProject/Ornn/issues/295) in any topology where the ornn-web pod can't resolve the same hostname the browser uses.

  Removes the `/api/v1/` proxy_pass block from `nginx.conf.template`, the `15-derive-nyxid-api-host.envsh` entrypoint script, and the `NGINX_ENVSUBST_FILTER` plumbing in the configmap. `NYXID_API_BASE_URL` is now SPA-only (used to compose the OAuth token URL); nginx no longer needs it.

  Closes [#298](https://github.com/ChronoAIProject/Ornn/issues/298).

- [#319](https://github.com/ChronoAIProject/Ornn/pull/319) [`719473b`](https://github.com/ChronoAIProject/Ornn/commit/719473b7b57d63523251487aec5075906d1119a7) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - SPA stale-bundle self-recovery. Every build emits `dist/version.json` and bakes the same `<pkg.version>+<git-short-sha>` string into `__APP_VERSION__`. At runtime the SPA polls `/version.json` every 60s + on tab focus / visibility change; when the deployed version differs from the baked one a small ember-stamp banner pinned to the top of the viewport offers a one-click reload. Users on stale tabs / aggressively-cached browsers (Safari) recover without being told to clear cache.

  Failure-tolerant: any network / parse / 404 path returns `null` silently — we'd rather under-prompt than spam.

  Operator change: `docker build` for ornn-web now needs `--build-arg GIT_COMMIT=$(git rev-parse --short HEAD)` so the deployed bundle has a real commit-pinned identity. CLAUDE.md Step 6 updated to match.

  Closes [#318](https://github.com/ChronoAIProject/Ornn/issues/318).

### Patch Changes

- [#313](https://github.com/ChronoAIProject/Ornn/pull/313) [`c25f48d`](https://github.com/ChronoAIProject/Ornn/commit/c25f48d72d52e295e2f6b1b8325c28d29d1a8b0d) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Restyle the landing-page announcement popup as an ember-stamped card. The popup now sits on the brand ember surface (orange) with obsidian ink, a Space Grotesk Bold UPPERCASE title, a `[§ NEWS — ORNN]` JetBrains Mono micro-label, a welded-seam divider, and a hard-offset letterpress shadow in ember-deep. CTA + dismiss buttons press DOWN on hover per DESIGN.md.

  Closes [#312](https://github.com/ChronoAIProject/Ornn/issues/312).

- [#317](https://github.com/ChronoAIProject/Ornn/pull/317) [`195cb9f`](https://github.com/ChronoAIProject/Ornn/commit/195cb9fb42f548a9981a74c132464e583e622ab0) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Auth store now self-heals the "username shows as UUID" state on browser restart. When a user's NyxID `id_token` lands without `email`/`name` claims (admin-created accounts), `displayName` falls back to the NyxID GUID. The login path always kicked off a `/api/v1/me` backfill to fix this, but if the user closed the tab before that backfill resolved, the UUID got persisted and never recovered — every subsequent session, every token refresh, kept propagating it.

  `initialize()` now re-runs the backfill on rehydrate whenever `user.displayName === user.id` (or email/name is empty). The check + helper are extracted so the login path and the rehydrate path share one source of truth.

  Closes [#316](https://github.com/ChronoAIProject/Ornn/issues/316).

- [#291](https://github.com/ChronoAIProject/Ornn/pull/291) [`8bec5f6`](https://github.com/ChronoAIProject/Ornn/commit/8bec5f6c9dbd8ff28b648b70ccf7f77e2f98ef3e) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(web): unbreak admin **Users** page — split sort wire payload into `sort` + `dir` ([#290](https://github.com/ChronoAIProject/Ornn/issues/290)).

  Frontend was sending `sort=lastActiveAt:desc` as a single combined query param, but the backend's Zod schema (`admin-users/routes.ts`) takes `sort=<field>` and `dir=<asc|desc>` as two separate params. The combined value bounced off the field-name enum with `Invalid enum value`, returning 500 to both Admin Users and Normal Users tables. UI table state stays on the convenient `field:dir` shape; the API client now splits before constructing the HTTP request.

- [#282](https://github.com/ChronoAIProject/Ornn/pull/282) [`72ddc01`](https://github.com/ChronoAIProject/Ornn/commit/72ddc018b1fb869030b4e6fdddd42e1b53cf52f8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(web): replace browser-native unsaved-changes confirm with a styled Modal ([#281](https://github.com/ChronoAIProject/Ornn/issues/281)).

  Navigating away from a settings section with unsaved changes used to pop Chrome's native `window.confirm` dialog ("ornn.ornn-cluster.local says — You have unsaved changes in this section. Discard them?"). It was the only place in the SPA that bypassed the Forge Workshop design system. `UnsavedChangesGuard` now renders the project's `<Modal>` with **Cancel** and **Discard changes** buttons. The `beforeunload` tab-close prompt stays raw — that one's owned by the OS shell and can't be styled from the page.

- [#360](https://github.com/ChronoAIProject/Ornn/pull/360) [`dc841ff`](https://github.com/ChronoAIProject/Ornn/commit/dc841ffe2312ba33e5083d396e0712eeaa753c1b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Replace browser-native `window.confirm()` prompts with the new `ConfirmDialog` Ornn primitive so destructive-action confirmations stay inside the Forge Workshop vocabulary (card-impression surface, hairline border, Space Grotesk title, spring entry, ESC + backdrop dismissal). Two admin callsites updated:

  - `/admin/announcements` delete announcement
  - `/admin/redemption-codes` invalidate redemption code

  `ConfirmDialog` lives at `components/ui/ConfirmDialog.tsx`, layered on top of the existing `Modal`. Declarative props (`isOpen` / `onClose` / `onConfirm` / `title` / `description` / `confirmLabel` / `cancelLabel` / `variant` / `isLoading`); the mutation lives outside, the dialog only orchestrates the UI. Also adds ESC-key dismissal to the underlying `Modal` primitive so every modal in the app — not just confirms — closes on ESC for parity with the native dialog it replaced.

  Closes [#359](https://github.com/ChronoAIProject/Ornn/issues/359).

- [#376](https://github.com/ChronoAIProject/Ornn/pull/376) [`ddb1333`](https://github.com/ChronoAIProject/Ornn/commit/ddb13337201d94c8d3d6fde371bafce90b083b94) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Consolidate `LandingNav` into the unified `Navbar` and reorder the top nav items.

  The landing page and the app shell were running two near-identical nav components — `pages/landing/LandingNav.tsx` and `components/layout/Navbar.tsx`. The visual divergence was an illusion: landing tokens (`parchment` / `bone` / `ember`) resolve to the exact same colors as the app-shell semantic tokens (`strong` / `body` / `accent`) in both themes. The only real functional differences were the extra "Get started" CTA on landing, the framer-motion-animated dropdown, and the mobile "Language" / "Theme" labels (where the app navbar hard-coded English — a real i18n bug for `zh` users).

  All three are folded into `Navbar`:

  - New optional prop `showGetStartedCta` opts into the landing CTA pair (Sign in + Get started).
  - Motion-wrapped dropdown is now the default — consistent across both surfaces.
  - All mobile labels go through `react-i18next`, fixing the i18n drift.

  `LandingPage` now renders `<Navbar showGetStartedCta />`; `LandingNav.tsx` is deleted (–805 lines). [#363](https://github.com/ChronoAIProject/Ornn/issues/363) (shared `userMenu.ts`) and [#361](https://github.com/ChronoAIProject/Ornn/issues/361) (`/news` drift) treated symptoms of the same dual-nav structural problem — this fully removes the duplication.

  Top nav items reordered on both surfaces (one-line change in the unified `NAV_ITEMS` constant) so visitors land on platform activity first, the agent-API funnel (`Build / Registry / Docs`) stays clustered in the middle, and `Contact` trails:

  - Before: `Registry, Build, Docs, News, Contact`
  - After: `News, Build, Registry, Docs, Contact`

  Closes [#375](https://github.com/ChronoAIProject/Ornn/issues/375).

- [#368](https://github.com/ChronoAIProject/Ornn/pull/368) [`cb50530`](https://github.com/ChronoAIProject/Ornn/commit/cb50530c75ed74dce09eef8164bdf8254c5ea3a0) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Replace the old `favicon.png` with the Forge-gear mark on a transparent background. The pre-redesign favicon was a 64×64 RGB PNG (no alpha) with a solid plate baked in; it no longer matched the wordmark `Logo.tsx` renders in the navbar and read as an opaque tile against any non-matching browser-tab chrome.

  - New `ornn-web/public/favicon.svg` — single ember `#FF7322` gear path lifted from `logo-light.svg`, transparent background, 64×64 viewBox. The primary favicon for modern browsers.
  - New `ornn-web/public/favicon.png` — 64×64 RGBA rendered from the SVG via `rsvg-convert` so the transparent background carries through. Fallback for legacy clients that don't honor `type="image/svg+xml"`.
  - `ornn-web/index.html` lists both `<link rel="icon">` tags with SVG first; cache-bust bumped `?v=12` → `?v=13` so existing browser caches refetch.

  Closes [#367](https://github.com/ChronoAIProject/Ornn/issues/367).

- [#380](https://github.com/ChronoAIProject/Ornn/pull/380) [`3c58d9b`](https://github.com/ChronoAIProject/Ornn/commit/3c58d9be4cb6da20fe61d05a9d1240dda8b10a76) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fix NyxID portal links in the signed-in user menu — "My Services" now opens `/keys` and "Admin Services" now opens `/services`. Previously both pointed to non-existent or wrong portal paths.

- [#297](https://github.com/ChronoAIProject/Ornn/pull/297) [`3a83de0`](https://github.com/ChronoAIProject/Ornn/commit/3a83de00c8850c4102c4b4fa69d6ec9d29681919) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fix ornn-web crash on first deploy after the URL consolidation in [#295](https://github.com/ChronoAIProject/Ornn/issues/295). `15-derive-nyxid-api-host.envsh` shipped without exec bit, so the nginx entrypoint silently skipped it (it sources `*.envsh` only when executable), `NYXID_API_HOST` never got exported, and nginx refused to start with `unknown "nyxid_api_host" variable`. Added the missing `chmod +x` in the Dockerfile.

  Closes [#296](https://github.com/ChronoAIProject/Ornn/issues/296).

- [#382](https://github.com/ChronoAIProject/Ornn/pull/382) [`b249cfb`](https://github.com/ChronoAIProject/Ornn/commit/b249cfb1da00fc7242e859b420f940716e0e9c44) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Make the Build → Create Skill mode-selection page responsive. On 1366×768 / 1440×900 laptops the bottom row of cards used to be clipped because the page combined `overflow-hidden` parent, vertical centering, and a two-column grid for four cards. The page now scrolls when needed, uses a 1/2/3/4-column ladder, and shrinks card internals on narrow viewports.

- [#280](https://github.com/ChronoAIProject/Ornn/pull/280) [`b7c9faf`](https://github.com/ChronoAIProject/Ornn/commit/b7c9faf357a255b42f41524f5391b8cf117dde09) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(web): make Extras section's per-row Base URL accept empty string ([#279](https://github.com/ChronoAIProject/Ornn/issues/279)).

  The admin **Extras** section's per-row `Base URL` input rejected the empty string with `Invalid url; Must be http(s)`, even though the backend (`extras.ts:optionalHttpUrl`) has always accepted it. Frontend Zod schema now matches the backend's empty-or-http(s) semantics: operators can register a service by name only and fill in the gateway later. `Scopes` was already optional; the field labels now say so explicitly.

- [#362](https://github.com/ChronoAIProject/Ornn/pull/362) [`9d53682`](https://github.com/ChronoAIProject/Ornn/commit/9d536825f32cfb6e2570a053c4df29da89a9739a) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Close three i18n / nav coverage gaps that landed under the radar:

  - **`nav.redeemCode` key was missing in both `en.json` and `zh.json`** — Navbar dropdown used `t("nav.redeemCode", "Redeem code")` with a fallback, so the English string was rendered to every locale. Added the key in both languages (`Redeem code` / `兑换码`).
  - **Admin Dashboard was 100% hardcoded English.** `pages/admin/DashboardPage.tsx` + `components/admin/RecentActivities.tsx` had zero `useTranslation` calls. Both now wire to a new `adminPages.dashboard.*` i18n block covering heading, subtitle, the two section headings, all six tile labels + helpers, aria labels, the PostHog body / not-configured warning, and the Activity feed + Insights link labels. Skill-visibility code identifiers (`isSystemSkill: true`, `!isPrivate ∧ !isSystemSkill`, `isPrivate: true`) stay verbatim across locales — they're code, not natural language.
  - **LandingNav had no `/news` entry.** PR [#358](https://github.com/ChronoAIProject/Ornn/issues/358) only added News to the app-shell `Navbar` (RootLayout), so anonymous visitors landing on `/` saw only Registry / Build / Docs / Contact. Added News between Docs and Contact in both the desktop nav row and the mobile hamburger panel, reusing the existing `nav.news` i18n key.

  Closes [#361](https://github.com/ChronoAIProject/Ornn/issues/361).

- [#340](https://github.com/ChronoAIProject/Ornn/pull/340) [`16e924f`](https://github.com/ChronoAIProject/Ornn/commit/16e924fe05dc7051f074bca028eca78f06d612c2) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Pre-v0.6.0 i18n cleanup:

  - Drop workshop / forge / 工坊 brand voice from four keys still using it after the recent positioning change. New copy aligns with "the end-to-end skill life-cycle manager for AI agents":
    - `login.tagline` — "Skill life-cycle for AI agents" / "面向 AI 代理的技能生命周期平台"
    - `notFound.goHome` — "Return to home" / "返回首页"
    - `landing.footer.tagline` — drops the "From the Chrono AI workshop" tail
    - `contact.headlineHighlight` — "team" / "我们"
  - t()-ify `ServiceDetailPage` end-to-end. New `serviceDetail` i18n section covers status badges, action button, error/empty states, back nav, and all card headings.
  - t()-ify the three hardcoded strings in `AnnouncementsPage` empty state.

  Closes [#339](https://github.com/ChronoAIProject/Ornn/issues/339).

- [#423](https://github.com/ChronoAIProject/Ornn/pull/423) [`a54b8f8`](https://github.com/ChronoAIProject/Ornn/commit/a54b8f807aa19cce3efb0f59aa1919ac9867abda) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Install card — center the Via-npx command on both axes inside its code box. Also fills in the missing `skillInstallCard` i18n namespace for both en and zh (previously all strings only had inline English fallbacks).

- [#420](https://github.com/ChronoAIProject/Ornn/pull/420) [`94a3ee6`](https://github.com/ChronoAIProject/Ornn/commit/94a3ee6df63610c229730109d9de14b10e700225) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Install card — narrow the code field (max-w-2xl) without shrinking the rest of the card. The wrapper Card stays full-width; only the code+COPY block is capped so the prompt text wraps at a comfortable reading length.

- [#419](https://github.com/ChronoAIProject/Ornn/pull/419) [`5f453ca`](https://github.com/ChronoAIProject/Ornn/commit/5f453ca76b357347d800954d3554b8fc169e5374) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Cap the skill-detail install card at `max-w-2xl` so the Via-prompt code block doesn't stretch the full width of the page on wide viewports.

- [#422](https://github.com/ChronoAIProject/Ornn/pull/422) [`704f7c3`](https://github.com/ChronoAIProject/Ornn/commit/704f7c3a701b1d078a18eff365a514b5b3664a89) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Install card — COPY button is now a small accent (orange) pill floating in the top-right corner of the code field. The code area takes the full width of the card, no sidebar.

- [#421](https://github.com/ChronoAIProject/Ornn/pull/421) [`9c5439c`](https://github.com/ChronoAIProject/Ornn/commit/9c5439c49a2b9914fa28f540b5bab925c7682e3b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Install card — restore code field to full width, shorten the box from h-40 (160px) to h-32 (128px). Prompt previews ~5 lines before scroll without dominating the page vertically.

- [#417](https://github.com/ChronoAIProject/Ornn/pull/417) [`7cf31f7`](https://github.com/ChronoAIProject/Ornn/commit/7cf31f7b3c3f01875a3a8139fd401f0560c03493) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Polish the install card after the height-unification attempt in [#415](https://github.com/ChronoAIProject/Ornn/issues/415). Drops the `min-h-[14rem]` padding that left a giant empty zone on the Via-npx tab; the CopyBlock itself is now a fixed `h-40` (160px) on both tabs with the single-line npx command vertically centred and the COPY button restored to a full-height vertical bar (no more disconnected look on Via-prompt).

- [#415](https://github.com/ChronoAIProject/Ornn/pull/415) [`9e8d935`](https://github.com/ChronoAIProject/Ornn/commit/9e8d9353c2bfe5ad34aba7108f956185a60f8766) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Two install-card polish fixes:

  - Install card visibility now follows the skill itself — anyone who can see the skill can see the install card, including unauthenticated viewers on public skills. The prior `canTryWithCli` gate from [#411](https://github.com/ChronoAIProject/Ornn/issues/411) was an unnecessary second wall on top of the page-level access control.
  - Install card height is stable when switching tabs. The Via-prompt code block is now a fixed 160px scrollable preview (was 288px max, which dwarfed the npx tab); both tabpanels reserve the same 224px envelope so the card outline doesn't jump.

- [#265](https://github.com/ChronoAIProject/Ornn/pull/265) [`3b0d98f`](https://github.com/ChronoAIProject/Ornn/commit/3b0d98f57ead287e6814fe141e678316940f6b70) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Playground chat — soft spring entrance for each message + ThinkingBubble (opacity + tiny rise + 98→100% scale). Plus strengthened the PR ↔ issue linkage rule in `CLAUDE.md` so every PR (no exceptions) must link an issue via `Closes #N` / `Fixes #N` / `Resolves #N`. Closes [#264](https://github.com/ChronoAIProject/Ornn/issues/264).

- [#267](https://github.com/ChronoAIProject/Ornn/pull/267) [`29e887f`](https://github.com/ChronoAIProject/Ornn/commit/29e887f1aa74d614223be00d63c0c95326bd4696) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Generative skill creation page now uses the same UI/UX language as the Playground: chat is the page hero (centered `max-w-2xl`), composer pinned at the bottom of the chat column with the model picker + quota chip centered above, ember-tinted user bubble + cool assistant bubble (15px / leading-7), spring entrance choreography on each turn, smart auto-scroll that respects manual scroll-up, and a right-edge slide-in drawer hosting the package preview + Save / Start-over actions. The drawer is **pinned-open by default** here because the package preview IS the work product (not auxiliary context like in the Playground). Closes [#266](https://github.com/ChronoAIProject/Ornn/issues/266).

- [#241](https://github.com/ChronoAIProject/Ornn/pull/241) [`c4e6c58`](https://github.com/ChronoAIProject/Ornn/commit/c4e6c587fa9cbbc999c697a0d5e76476e75b4058) Thanks [@ctkm-aelf](https://github.com/ctkm-aelf)! - UI polish across landing + app shell. (1) Featured-skill cards: replace the legacy `$ ornn install …` box with a wrapped row of monospace tag chips drawn from each skill's `tags` — CLI is no longer the agent path, so the card's visual gravity is preserved without implying install. (2) Active nav state: both `LandingNav` and the app-shell `Navbar` now wrap the active route's text in `<HighlighterMark>` for the same hand-drawn ember wash used on the landing headline; the singleton `<HighlighterMarkFilter />` is hoisted from `LandingPage` to `App` so every route shares the SVG turbulence filter. (3) `SkillDetailPage`: drop the `lg:h-[80vh] lg:max-h-[calc(100vh-140px)]` clamps on both columns and the right-rail's `lg:overflow-y-auto` so neither column has its own inner scroll; default flex `stretch` keeps both columns ending at the same y-pixel; responsive `min-h-[420px] lg:min-h-[680px]` keeps the file panel substantial when the package is small.

- [#334](https://github.com/ChronoAIProject/Ornn/pull/334) [`6111d3d`](https://github.com/ChronoAIProject/Ornn/commit/6111d3dd9044b92f589ba156afdf5109350dc59b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Remove the "NOW FORGING · v 0.9.3" badge from the landing hero — it was a stale dev-time build-status stamp that didn't belong on the public landing. Drops the `<Stamp>` usage from both the scrub and static hero variants, the `landing.nowForging` i18n keys, and the unused `Stamp` import.

  Closes [#333](https://github.com/ChronoAIProject/Ornn/issues/333).

- [#323](https://github.com/ChronoAIProject/Ornn/pull/323) [`56037a5`](https://github.com/ChronoAIProject/Ornn/commit/56037a529e087f35742f74236e5c5993de81d105) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Collapse all legal-page email contacts (`legal@`, `security@`, `abuse@`) to a single `support@chrono-ai.fun` and tighten the per-page Contact sections that listed the same address two or three times. Matches the inbox we actually staff at launch; separating again later is a one-PR fix.

  Closes [#322](https://github.com/ChronoAIProject/Ornn/issues/322).

- [#277](https://github.com/ChronoAIProject/Ornn/pull/277) [`56bbf55`](https://github.com/ChronoAIProject/Ornn/commit/56bbf55d62ac9f48beb7754909b0e10664ecd164) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - chore: move browser-only NyxID link coords from admin settings into ornn-web configmap ([#275](https://github.com/ChronoAIProject/Ornn/issues/275)).

  The `nyxid` admin-settings section used to carry five fields with no server-side consumer (`baseFrontendUrl`, `myServicesPath`, `myProfilePath`, `myOrganizationPath`, `servicesListApiPath`). The four frontend link coords now live in ornn-web's configmap (`NYXID_BASE_FRONTEND_URL`, `NYXID_MY_SERVICES_PATH`, `NYXID_MY_PROFILE_PATH`, `NYXID_MY_ORGANIZATION_PATH`) — delivered via the existing `window.__ORNN_CONFIG__` injection alongside `NYXID_OAUTH_*` and `NYXID_LOGOUT_URL`. `servicesListApiPath` is dropped outright (the runtime hard-codes `/api/v1/user-services`).

  The admin NyxID section now contains only `tokenUrl`, `clientId`, `clientSecret`, and `baseApiUrl` — the four fields ornn-api actually consults at runtime.

  Migration-free: pre-existing `platform_settings` docs with the legacy fields keep working — Zod's default strip semantics drop unknown keys on parse. Operators upgrading should add the four new env vars to their ornn-web configmap (see `deployment/.env.sample.ornn`).

- [#301](https://github.com/ChronoAIProject/Ornn/pull/301) [`336afed`](https://github.com/ChronoAIProject/Ornn/commit/336afed6b089b6a05688c2044abd0be7cd5d7b0f) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Playground model dropdown now flips upward when the trigger sits near the bottom of the viewport. Previously the menu always opened down, so long model lists got clipped under the composer bar. Smart placement: opens up only when remaining space below is less than the menu's max-height (320px) AND space above is larger; otherwise stays the default downward direction. Computed once per open before render, so no flicker.

  Closes [#300](https://github.com/ChronoAIProject/Ornn/issues/300).

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

- [#374](https://github.com/ChronoAIProject/Ornn/pull/374) [`a483cce`](https://github.com/ChronoAIProject/Ornn/commit/a483ccef1d84cc0f97a6384926030bfdef8dd57f) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: i18n the PostHog cookie-consent banner.

  The GDPR analytics-consent banner (`CookieConsentBanner`) was hardcoded in English. Pulled every visible string — the `[ § ANALYTICS — CONSENT ]` stamp, the title, the body (with inline PostHog + Privacy Policy links), and the Accept / Decline buttons — out into a new `cookieConsent.*` block in `i18n/en.json` and `i18n/zh.json`. The body uses `<Trans>` with named `postHogLink` / `privacyLink` component slots so the link anchors stay translation-friendly without splitting the sentence into glued fragments. zh visitors now see the banner in Chinese; switching language via the existing `ornn-lang` toggle re-renders it live.

- [#305](https://github.com/ChronoAIProject/Ornn/pull/305) [`aa4ef4c`](https://github.com/ChronoAIProject/Ornn/commit/aa4ef4cf76ee208207b773971d71809020cd8c41) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - PostHog browser hardening:

  - **`respect_dnt: true`** — opt out of capture when the browser sends Do-Not-Track. GDPR/CCPA affinity, complements the cookie banner.
  - **`maskTextSelector: "*"`** in session-recording config (replaces the narrower `[data-ph-mask], input[type='password']` selector). Every rendered text node is now masked in replays — skill content, user names, emails, activity feeds. Trade-off: replays lose visual fidelity but no longer carry PII. Opt specific elements back in with `data-ph-no-mask` when an element is genuinely public chrome.

  Closes [#304](https://github.com/ChronoAIProject/Ornn/issues/304).

- [#289](https://github.com/ChronoAIProject/Ornn/pull/289) [`a7b0a00`](https://github.com/ChronoAIProject/Ornn/commit/a7b0a005be3e196ab0eb33bcd159dc93cd93b314) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(web): pre-production UI audit fixes ([#283](https://github.com/ChronoAIProject/Ornn/issues/283)).

  - **CookieConsentBanner** — anchor to bottom-right on `sm+` (was centered) and narrow `max-w-3xl → max-w-md` so it no longer overlaps content cards on short pages (e.g. `/contact`). Mobile keeps the centered full-width treatment since there's no competing layout there. Buttons stack vertically inside the card now that horizontal room is tighter, which also reads cleaner alongside the body copy.
  - **LandingNav** — replace inline `shadow-[var(--card-shadow-rest)]` with the `.card-impression` class on both the desktop avatar dropdown and the mobile slide-down panel. Inline arbitrary shadow strings on landing surfaces are a DESIGN.md review-blocker; the class indirection lets the component shadow tokens evolve without touching consumers.
  - **NotFoundPage** — add Forge eyebrow `[ § 404 — NOT FOUND ]` above the 404 numeral so the page voice stays consistent with the new `/contact` and other bracketed-mono surfaces.
  - **LoginPage** — add Forge eyebrow `[ § ENTRY — NYXID ]` above the wordmark for the same voice-consistency reason.
  - i18n: new `notFound.eyebrow` and `login.eyebrow` keys in both `en.json` and `zh.json`.

  Out of scope and tracked as follow-ups: residual `neon-input` legacy class in 8 form/admin components ([#286](https://github.com/ChronoAIProject/Ornn/issues/286)). Surfaced during the audit but pulling it into this PR would balloon the diff.

- [#366](https://github.com/ChronoAIProject/Ornn/pull/366) [`32436d2`](https://github.com/ChronoAIProject/Ornn/commit/32436d212b828ea662ffc798e39a6cf0f3d338c8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fix the README hero logo washing out on GitHub light mode. The static `ornn-web/public/logo.svg` had the wordmark fill hardcoded to `#F1ECDE` (parchment / dark-theme `text-strong`), so the "rnn" letters barely read against GitHub's default near-white page background. The website itself never had this problem — its inline `Logo.tsx` uses `fill="currentColor"` and inherits the surrounding text color, so it lands on obsidian on light themes and parchment on dark.

  Split into two static variants and wire the README through GitHub's recommended `<picture>` + `prefers-color-scheme` pattern:

  - `ornn-web/public/logo-light.svg` — wordmark in obsidian `#14130E`, served as the default `<img>` for GitHub light
  - `ornn-web/public/logo-dark.svg` — wordmark in parchment `#F1ECDE` (the original artwork), served when the viewer is on GitHub dark
  - README's hero `<img>` becomes a `<picture>` with both sources

  Result is README-website parity: same wordmark color in the same viewer-theme context on both surfaces. `logo.svg` had no other consumer (favicon ships separately as `favicon.png`; `index.html` doesn't reference it), so the rename has no runtime impact.

  Closes [#365](https://github.com/ChronoAIProject/Ornn/issues/365).

- [#311](https://github.com/ChronoAIProject/Ornn/pull/311) [`b283ccd`](https://github.com/ChronoAIProject/Ornn/commit/b283ccd26ff2b0fff71fc8051c76128b2d0dbdc7) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Mount `/settings` route and add a "Redeem code" entry to the user menu (desktop dropdown between "My Organizations" and "Go to NyxID"; mobile menu after "My Profile"). The redeem form shipped in [#306](https://github.com/ChronoAIProject/Ornn/issues/306) was previously unreachable because `SettingsPage` had no route. Existing NyxID external links are unchanged.

  Closes [#310](https://github.com/ChronoAIProject/Ornn/issues/310).

- [#364](https://github.com/ChronoAIProject/Ornn/pull/364) [`bfb80ff`](https://github.com/ChronoAIProject/Ornn/commit/bfb80ffcbcf4984ece93511a898bdf4f15427c0b) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Extract the signed-in avatar-dropdown content into a shared `lib/userMenu` module so the app-shell `Navbar` and landing `LandingNav` can't drift apart again.

  Both navs used to hand-maintain identical item lists (profile / services / orgs / redeem code / NyxID / admin section / signout). Over time LandingNav fell behind: it was missing **Redeem code** and **Admin services** on desktop, and its mobile hamburger was even sparser (profile + admin + signout only). The shape mirrored the previous `/news` drift fixed in [#361](https://github.com/ChronoAIProject/Ornn/issues/361) — two surfaces, two hand-maintained copies, divergence by drift.

  `lib/userMenu.ts` now exports `getNyxIdUrl()` (was duplicated verbatim in both navs) plus a `useUserMenuGroups(user)` hook returning a typed, i18n-resolved, admin-gated list of grouped items. Each surface renders the items with its own wrapper components — `Navbar` keeps `text-body` / `hover:bg-elevated` / `hover:text-accent`, `LandingNav` keeps `text-bone` / `hover:bg-surface-elevated` / `hover:text-ember` — but the **content** lives in one place. Renaming, reordering, or gating an item is now a single-file edit that lands on both surfaces in the same commit; divergence becomes a TS error instead of a visual one. Both desktop dropdowns AND mobile hamburger menus now render the full item list on every surface.

  Closes [#363](https://github.com/ChronoAIProject/Ornn/issues/363).

- [#342](https://github.com/ChronoAIProject/Ornn/pull/342) [`71983c5`](https://github.com/ChronoAIProject/Ornn/commit/71983c58cb7dbe9e70549788573586f2e2e7cd10) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - `SkillDetailPage` main grid now caps at a viewport-relative height on lg+ (`calc(100vh-280px)`, with a 480px min floor) and lets each column scroll its own long content inside the frame. Previously every long file or growing audit history pushed the whole page longer; now both columns stay readable side-by-side and only their internal content scrolls. Mobile keeps natural page-flow.

  Closes [#341](https://github.com/ChronoAIProject/Ornn/issues/341).

- [#285](https://github.com/ChronoAIProject/Ornn/pull/285) [`38c4b53`](https://github.com/ChronoAIProject/Ornn/commit/38c4b53786d5389623233ea7edf5f72e0049b879) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix: relax Extras section's service-name regex to allow mixed case + dot/underscore ([#284](https://github.com/ChronoAIProject/Ornn/issues/284)).

  Was lowercase-only (`^[a-z0-9-]{1,64}$`), which rejected the legacy `EXTRA_NYXID_SERVICES` env var's own default value (`NyxID`) and any common service identifier with mixed case. Now matches the typical service-id shape: `^[A-Za-z0-9._-]{1,64}$` — covers `NyxID`, `twitter-api`, `openai_v2`, `v1.beta`. Spaces still rejected (the value flows into URL path segments where space encoding is fragile).

- [#408](https://github.com/ChronoAIProject/Ornn/pull/408) [`b52ee09`](https://github.com/ChronoAIProject/Ornn/commit/b52ee0921f314b06e2d70480cd9d91ccfd067d12) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Upgrade `framer-motion` 11 → 12. Retypes the three `Variants` definitions in the codebase (SkillGrid, ExplorePage, MySkillsPage) and the `PageTransition.ease` prop to match v12's tightened animation typing.

- [#406](https://github.com/ChronoAIProject/Ornn/pull/406) [`5f658bc`](https://github.com/ChronoAIProject/Ornn/commit/5f658bc01cb9f4377709e74ca39b09fdffb3e43c) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Upgrade `@hookform/resolvers` 3 → 5. v5 changed the Resolver to reference the Zod output shape; form components are updated to use the `z.input` / `z.output` split so the form-state types and the submit-handler types are both correctly narrowed. Pure type refactor — no behaviour change.

- [#407](https://github.com/ChronoAIProject/Ornn/pull/407) [`2fe035b`](https://github.com/ChronoAIProject/Ornn/commit/2fe035ba20262c9efb17f019a6043bfa1b073839) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Upgrade `i18next` 25 → 26 and `react-i18next` 16 → 17 together (peer-dep coupling).

- [#401](https://github.com/ChronoAIProject/Ornn/pull/401) [`8378e97`](https://github.com/ChronoAIProject/Ornn/commit/8378e97edd23c8e6f657a349f9b00a89e5c60fe8) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Upgrade `vite` 6 → 8 and `@vitejs/plugin-react` 4 → 6. Rolldown-based build cuts production build time from ~4.8s to ~338ms. Drops the `overrides.vite: ^6.4.2` workaround from [#385](https://github.com/ChronoAIProject/Ornn/issues/385) — staying on vite 6 was a stopgap to dodge GHSA-p9ff-h696-f583; vite 8 is on the secure line natively.

## 0.5.0

### Minor Changes

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: per-skill analytics card on `SkillDetailPage`. Shows execution count, success rate with outcome breakdown (ok / fail / timeout), p50 + p95 latency (p99 in hint), unique users, and top error codes for a rolling window (7d / 30d / all). Graceful empty state for skills with no executions yet. Wires up the already-shipped `GET /api/v1/skills/:idOrName/analytics` endpoint; closes [#161](https://github.com/ChronoAIProject/Ornn/issues/161) from the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: skill audit banner on SkillDetailPage. Shows the cached verdict (green / yellow / red), overall 0–10 score, and a collapsible drawer with per-dimension scores and findings. Admins get a "Rerun" button (and a "Run audit" CTA for skills that have never been audited). Wires up the already-shipped `/api/v1/skills/:idOrName/audit` endpoints; closes [#158](https://github.com/ChronoAIProject/Ornn/issues/158) from the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: delete a non-latest skill version ([#183](https://github.com/ChronoAIProject/Ornn/issues/183)). New endpoint `DELETE /api/v1/skills/:idOrName/versions/:version` (owner or `ornn:admin:skill`). Refuses to delete the only remaining version (use `DELETE /skills/:id`) or the current latest (publish a newer version first). The version's package zip is best-effort cleaned from storage; the row is removed from `skill_versions`. Frontend: per-row Delete button on `SkillVersionList` (owner / admin only, hidden for the latest row), confirmation modal, and a SkillDetailPage handler that toasts the result and snaps back to latest if the user was viewing the deleted version.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - docs: restructure in-product docs site (About / Quick Start / Technical References), add 4 new About pages (Why Ornn? + 3 comparison pages), split API Reference into per-domain pages (14 pages), make Agent Manual a paste-installable skill (SKILL.md frontmatter prepended), add Copy-as-markdown button to every doc.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Editorial Forge migration — Phase B, global chrome + token remap ([#205](https://github.com/ChronoAIProject/Ornn/issues/205)). Legacy `neon-*` / `bg-deep` / `text-text-primary` / `font-heading` / `font-body` Tailwind tokens are remapped to Editorial Forge values directly inside `@theme` so every existing component using those classes adopts the Editorial Forge palette + Fraunces / Inter typography automatically. Sanitizes legacy helper classes (`.glass`, `.scanlines`, scrollbar, focus ring, markdown body, hljs syntax highlight) and migrates `RootLayout` breadcrumb + `Navbar` nav-button typography to Inter / mono per DESIGN.md.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat(web): apply Forge Workshop v3 design language to the entire app shell + ship landing-nav avatar dropdown.

  Landing v3 ships shared visual language to every component and page in the app shell, so the registry, build flows, skill detail, playground, settings, admin, and auth pages all read in the same Space Grotesk display + Inter body + JetBrains Mono operational vocabulary. Cards, buttons, and panels now press DOWN under hover via letterpress impression shadows; the legacy soft drop shadows, glow halos, hover-lift, and Fraunces display from the Editorial Forge era are retired everywhere outside the landing page (landing surfaces keep their own design contract).

  Also ships the landing-nav avatar dropdown so authenticated users see the same identity anchor on the landing surface that they get inside the app — profile / services / orgs / NyxID portal / admin / sign out.

  Both dark and light modes are covered. `bun run build` and `tsc --noEmit` are clean across the seven-commit migration.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: GitHub import + refresh UI. Adds a fourth creation mode on `/skills/new` ("Import from GitHub") that pulls a public repo into Ornn via `POST /api/v1/skills/pull`. On `SkillDetailPage`, imported skills now show a compact origin chip (repo + commit + synced-at) with a one-click "Refresh from GitHub" action for owners/admins that calls `POST /api/v1/skills/:id/refresh`. Closes [#159](https://github.com/ChronoAIProject/Ornn/issues/159) from the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

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

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: editorial-forge landing page redesign. Rebuilt `/` from scratch in the design language defined by `DESIGN.md` — paper + metal + ember palette, Fraunces / Inter / JetBrains Mono, semantic role-based tokens. The hero is a full 820vh scroll-scrubbed sequence (phone builds itself layer-by-layer while 16 skill chips fly along SVG cables from a registry rail) with a static fallback for reduced-motion + mobile viewports. Tokens for the new palette + theme-flipping gradients are added to `src/styles/neon.css` (the existing `neon-*` tokens stay for legacy pages — no new CSS file). Featured skill cards render hardcoded copy first then quietly swap to live `/api/v1/skill-search` results when available. Routes restructured so `/` lives outside `RootLayout` (the 820vh hero needs full document scroll).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: in-product notifications UI — navbar bell with unread badge, popover with latest 10 items, dedicated `/notifications` page with filter + mark-all-read. Wires up the already-shipped `/api/v1/notifications/*` endpoints; closes [#157](https://github.com/ChronoAIProject/Ornn/issues/157) from the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: M3 polish batch — async audit lifecycle (running/completed/failed status with background pipeline + history polling), `Start Auditing` button moves out of `PermissionsModal` into its own slot under Manage permissions, sharing now requires a pre-existing completed audit (returns `AUDIT_REQUIRED` rather than auto-running), dedicated `/skills/:idOrName/audits` page replaces the squashed sidebar card, full Chinese translation rewrite + new `BackLink` component on every sub-page, and three M3 bug fixes ([#184](https://github.com/ChronoAIProject/Ornn/issues/184) `/my-shares` back nav, [#185](https://github.com/ChronoAIProject/Ornn/issues/185) `/reviews` back nav, [#186](https://github.com/ChronoAIProject/Ornn/issues/186) reviewer cannot accept/reject — `shareService.get()` now authorizes org-target reviewers via `reviewerOrgIds`). Also: `ornn-api` deployment gains the `MINIO_HOST_ALIAS_IP` `hostAlias` so the audit path can fetch presigned skill ZIPs in-cluster.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: per-version audit history + analytics filtering ([#181](https://github.com/ChronoAIProject/Ornn/issues/181)) and skill pull tracking with time-bucket aggregation ([#182](https://github.com/ChronoAIProject/Ornn/issues/182)).

  Backend: `GET /api/v1/skills/:idOrName/analytics` and `/audit/history` accept `?version=`. New `GET /api/v1/skills/:idOrName/analytics/pulls?bucket=hour|day|month&from=&to=&version=` returns bucketed pull counts grouped by source (api/web/playground). Three endpoints now emit fire-and-forget pull events into a new `skill_pulls` collection: `GET /skills/:idOrName/json` (api), `GET /skills/:idOrName` (web), `POST /playground/chat` when bound to a skill (playground). Analytics failures are swallowed and never surface to clients.

  Frontend: `AuditHistoryCard` and `AnalyticsCard` accept a `version` prop and pass it through; the dedicated `/skills/:idOrName/audits` page reads `?version=` from the URL so version selection on `SkillDetailPage` propagates to the deep-link. New `useSkillPulls` hook ready for the chart UI in [#187](https://github.com/ChronoAIProject/Ornn/issues/187).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: per-version audit badges + share scheme B ([#188](https://github.com/ChronoAIProject/Ornn/issues/188)).

  **Backend.** New `GET /api/v1/skills/:idOrName/audit/summary-by-version` returns the most recent _completed_ audit for each version of a skill. `AuditRepository.findLatestCompletedPerVersion` is one Mongo aggregation (`$match status:completed → $sort createdAt -1 → $group _id:version $first:doc`); `AuditService.summaryByVersion` exposes it as `Record<version, AuditRecord>`. Visibility mirrors the rest of the audit endpoints.

  **Frontend.** New `useAuditSummaryByVersion` hook + `fetchAuditSummaryByVersion` service; `useStartAudit` invalidates this key alongside the history keys. `SkillVersionList` accepts an `auditSummary` prop and renders an `AuditPill` next to each version row (green / yellow / red verdict pill, or a neutral "?" pill for versions that never had a completed audit). `SkillDetailPage` mounts a one-line cautionary banner above the main grid when the currently-viewed version is yellow / red / not-yet-audited; green is silent. Banner has a deep link to `/skills/:idOrName/audits?version=` so the user lands on that version's audit history. en/zh translations added.

  **Share semantics — scheme B confirmed in code.** The share gate already only consumes the _latest version's_ completed audit (`shareService.initiateShare` looks up via `auditService.getAudit(skill.guid, skill.version)`). Older versions keep whatever audit they had; consumers see the per-version pill. Documented in `agent-manual.md` already ([#192](https://github.com/ChronoAIProject/Ornn/issues/192)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: audit-gated permissions pipeline. `PUT /api/v1/skills/:id/permissions` now orchestrates the full audit + waiver flow — removals apply immediately, new grants (user/org/public) run a cached audit (30-day TTL per skill version) and either auto-apply when `overallScore >= platform threshold` or create a waiver request requiring owner justification + reviewer decision. The dedicated `POST /api/v1/skills/:idOrName/share` endpoint + the separate "Share" button are gone — everything happens through "Manage permissions". Threshold is admin-configurable at `/admin/settings` (default 6.0, range 0–10). The PermissionsModal shows a three-phase UX (form → running → results) so the user can see the audit progress and act on any flagged targets inline.

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

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor: share is unconditional, audit is a passive risk label ([#197](https://github.com/ChronoAIProject/Ornn/issues/197)).

  `PUT /api/v1/skills/:id/permissions` now applies the requested allow-list as-is — no `AUDIT_REQUIRED`, no waiver flow, no reviewer queue. The whole `shares/` domain (api) + share UI pages / hooks / services (web) are deleted.

  Audit completion now fans out two notification categories:

  - `audit.completed` — owner, every audit (different copy for `green` vs `yellow`/`red`).
  - `audit.risky_for_consumer` — every consumer of a `yellow`/`red` audited skill (`sharedWithUsers` plus every org member resolved via NyxID).

  `NotificationCategory` is trimmed to those two values and `NyxidOrgsClient.listOrgMembers` (SA token) is wired so the audit pipeline can expand org grants to their membership.

  Deploy note: the `share_requests` collection should be dropped from MongoDB on the next deploy. No backwards-compat preserved.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: audit-gated share workflow — PR 2/3. Adds the `/shares/:requestId` detail page: status pill, audit findings (pulled from the cached audit record), and a justification form for owners when the request is in `needs-justification`. Existing justifications + reviewer decisions render read-only. Owner cancel action also lives here. The reviewer accept/reject controls land in PR #160c. Progresses [#160](https://github.com/ChronoAIProject/Ornn/issues/160) from the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: audit-gated share workflow — PR 1/3. Adds a "Share (audit-gated)" button on `SkillDetailPage` that opens a target picker (user / org / public), fires `POST /api/v1/skills/:idOrName/share`, and surfaces the caller's in-flight requests for this skill inline with status badges and a cancel action. The `/shares/:requestId` detail view and reviewer queue land in follow-up PRs (#160b / #160c). Progresses [#160](https://github.com/ChronoAIProject/Ornn/issues/160) from the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - frontend: audit-gated share workflow — PR 3/3 (the final slice). Adds a `/reviews` page listing share requests awaiting the caller's decision, a matching "Reviews" nav link, and accept/reject controls (with optional note) on the `/shares/:requestId` detail page for non-owner reviewers. Closes [#160](https://github.com/ChronoAIProject/Ornn/issues/160), wrapping up the phase-3 frontend catch-up umbrella ([#156](https://github.com/ChronoAIProject/Ornn/issues/156)).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: two history surfaces for the sharing workflow. Adds `/my-shares` (linked from the profile dropdown) showing every share request the caller initiated — pending, decided, cancelled — with an Active/Decided filter. Adds `/admin/review-history` (linked from the admin sidebar) showing every share request the caller has accepted or rejected, sourced from the new `GET /api/v1/shares/reviewed-history` endpoint on the backend.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat(web): SkillDetailPage redesign — Editorial Forge wireframe v1 ([#201](https://github.com/ChronoAIProject/Ornn/issues/201)).

  The page now leads with a hero strip (icon, name, description, category + tag row, status pills for visibility / version / audit verdict / 7-day pulls, owner line, primary CTA) instead of a tall pulls chart. The pulls strip is preserved but the right rail is consolidated into 4 contextual cards: **Audit / Visibility / Versions / Danger** — each owning its concept end-to-end (verdict badge + actions).

  Implements the Editorial Forge design language from `DESIGN.md`:

  - Adds Editorial Forge tokens to `ornn-web/src/styles/neon.css` via `@theme` so they coexist with legacy `neon-*` tokens during migration. New utilities available app-wide: `bg-page`, `bg-panel`, `bg-card`, `bg-elevated`, `text-strong`, `text-body`, `text-meta`, `text-accent`, `bg-accent`, `text-success`/`warning`/`danger`/`info`, `border-subtle`, `border-strong-edge`, `font-display` (Fraunces), `font-reading` (Inter).
  - Loads Fraunces + Inter alongside the legacy Orbitron + Rajdhani in `index.html`.
  - Only `SkillDetailPage` opts into the new tokens; other pages stay on the legacy `neon-*` tokens until migrated per-page.

  Closes [#201](https://github.com/ChronoAIProject/Ornn/issues/201).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat: SkillDetailPage gets a full-width "Skill pulls" chart at the top ([#187](https://github.com/ChronoAIProject/Ornn/issues/187)). New `UsagePullsCard` component renders a stacked bar chart (recharts) of pull counts over a user-controlled time range (datetime-local from / to inputs) with a Hour / Day / Month bucket toggle, broken down by source (api / web / playground). Default window: last 7 days, day buckets. Empty / invalid-range states render gracefully. Wired into SkillDetailPage between the GitHub origin chip and the Package Contents grid; respects the currently selected skill version. Added `recharts@3.x` as a dependency. en/zh i18n keys added.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - System skills + registry redesign:

  - **Skill ↔ NyxID-service tie.** A skill can be linked to a NyxID catalog service via `PUT /api/v1/skills/:id/nyxid-service`. Tying to an admin-tier service (`visibility: "public"` in NyxID) marks the skill `isSystemSkill: true` and atomically forces `isPrivate: false`. Personal-tier ties leave privacy alone. New `GET /api/v1/nyxid-services/:serviceId/skills` reverse-lookup. `GET /api/v1/me/nyxid-services` redefined to return catalog rows with a `tier` field. New `SYSTEM_SKILL_MUST_BE_PUBLIC` invariant blocks `PUT /skills/:id/permissions` and `PUT /skills/:id` from flipping a system skill private.
  - **Registry redesign.** New "System Skills" tab (default landing). Two-column layout per tab: search bar up top, sidebar filter chips on the left, cards on the right. Per-tab filters: System → service; Public → tags + authors; My Skills → tags + grant-orgs + grant-users; Shared with me → source-orgs + source-users. All filter state URL-encoded.
  - **New facet endpoints.** `/skill-facets/tags?scope=...`, `/skill-facets/authors?scope=...`, `/skill-facets/system-services` aggregate visibility-scoped chip data.
  - **Search params extended.** `/skill-search` now accepts `nyxidServiceId` (single id) and `tags` (CSV, AND-match).
  - **Skill detail polish.** New NyxID-service tie card + modal next to permissions. Skill content section capped at `min(80vh, viewport-140px)` with internal scroll. "Skill pulls" chart renamed to "Skill Usage", switched from stacked bars to multi-line, fixed canned windows (24h / 7d / 12mo) with full bucket padding, recolored to the editorial-forge palette.
  - **Docs become a system skill.** The `agent-manual.md` + 14 `api-*.md` docs-site pages are deleted. Their content is republished as the `ornn-agent-manual` Ornn skill (source at `skills/ornn-agent-manual/`, `SKILL.md` + `references/api-reference.md`, v2.2). Pull it via `GET /api/v1/skills/ornn-agent-manual/json`.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - feat(web): surface skill version diff in the UI ([#225](https://github.com/ChronoAIProject/Ornn/issues/225)). The all-versions modal on the skill detail page now has a "Compare versions" button that opens a new `VersionDiffModal`. Two version pickers (defaulted to current ↔ latest) call `GET /api/v1/skills/:idOrName/versions/:from/diff/:to` and the result renders three sections — Modified / Added / Removed — with file paths, byte sizes, and a unified line-level diff for every modified text file via the `diff` npm package. Binary files report their size + hash change without inline content. Same-version compares short-circuit locally so the backend doesn't see them. en + zh translations added.

### Patch Changes

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - docs: encode the "Ornn is an agent-facing skill-lifecycle API, not a marketplace" positioning into CLAUDE.md, the landing page hero, and the docs site `what-is-ornn` page (EN + zh). Also drops the stale "audit-gated sharing" bullet — replaced by the audit-as-public-risk-label framing shipped in [#197](https://github.com/ChronoAIProject/Ornn/issues/197). Closes [#199](https://github.com/ChronoAIProject/Ornn/issues/199).

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

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Editorial Forge migration — Phase C, auth + 404 pages. LoginPage / OAuthCallbackPage / NotFoundPage now use the migrated `Button` primitive + `bg-card` / `border-subtle` surfaces; Fraunces display / Inter body / mineral state colors. No behavior changes. (Builds on [#205](https://github.com/ChronoAIProject/Ornn/issues/205).)

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Editorial Forge migration — Phase D, Landing + Docs. LandingPage hero rewritten with Fraunces display + italic ember accent + mono uppercase CTAs. DocsPage sidebar / TOC micro-labels switch from font-heading to font-mono so they read as forge stamps rather than Fraunces uppercase. Builds on [#208](https://github.com/ChronoAIProject/Ornn/issues/208).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Editorial Forge migration — Phase A, shared UI primitives ([#203](https://github.com/ChronoAIProject/Ornn/issues/203)). API surfaces unchanged; only internal styling migrates from legacy `neon-*` tokens to Editorial Forge semantic tokens (`bg-card`, `bg-accent`, `text-strong`, `border-subtle`, etc.). Affects `Button`, `Card`, `Modal`, `Badge`, `Input`, `Select`, `Toast`, `Pagination`, `EmptyState`, `NeonSkeleton`, `CategoryTooltip`. Foundation for the rest of the migration.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Editorial Forge migration — Phase E, registry / my-skills / audit history / edit pages. Targeted polish: switches `font-heading` micro-labels to `font-mono` so they render as forge stamps (uppercase mono tracking) rather than Fraunces uppercase. EditSkillPage hero gets a Fraunces title with a small ember overline. Builds on [#210](https://github.com/ChronoAIProject/Ornn/issues/210).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Editorial Forge migration — Phase F, remaining pages sweep. Mechanical conversion of `font-heading` micro-labels (uppercase tracking-wider) → `font-mono` (forge stamps) across NotificationsPage / PlaygroundPage / SettingsPage / 4 admin pages / CreateSkillFromGitHubPage. Closes the migration started in [#201](https://github.com/ChronoAIProject/Ornn/issues/201)/[#202](https://github.com/ChronoAIProject/Ornn/issues/202).

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor(web): Forge Workshop v3 landing direction. Pivots the landing visual language away from the Editorial Paper baseline (warm parchment + Fraunces italic-ember signature) toward a decisively non-Claude-adjacent industrial-publication identity. Replaces display typography with Space Grotesk Bold UPPERCASE, swaps soft drop shadows for letterpress hard-offset shadows with press-down hover (`--button-primary-shadow-rest/-hover/-active`, `--card-shadow-rest/-hover`, `--button-focus-ring`), introduces arc-blue (`--color-arc{,-dim,-glow,-soft}`) as a secondary diagrammatic accent, ember-deep (`--color-ember-deep`) for press impressions, and cools the light-mode page bg from warm cream `#F5EFE1` to cool steel paper `#EAECEC` (B≥G≥R). Adds two landing-only chrome primitives (`<HighlighterMark>` for hand-applied translucent emphasis on key nouns, `<LandingChrome>` for fixed page-corner registration marks + light-mode drafting overlay) scoped via `.landing-route` so app-shell pages do not inherit landing chrome. Hero scroll-scrub wires now anchor to the registry rail's outer edge with index-fanned Y on desktop (was tracking interior row rect, which dragged with rail-list internal auto-scroll). DESIGN.md updated with a Differentiation Guardrails section (testable rules: banned visual combination, allowed light bg HEX ranges, Fraunces deprecated for landing, hover-press-down mandatory, arc-blue restricted role, pre-merge screenshot requirement) and Material & Print Vocabulary section, and asserted as the canonical source of truth (implementations follow DESIGN.md, not the reverse). Reference build deployed at `chrono-ornn-web.surge.sh`.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - fix(web): apply landing design-audit fixes against DESIGN.md Editorial Forge v3. Resolves the seven HIGH-severity findings from a structured audit of the v3 implementation: (1) Space Grotesk now actually loads (was missing from `index.html` Google Fonts request, so the v3 hero typography was rendering Inter as fallback); (2) Orbitron and Rajdhani dropped from the font request (DESIGN.md anti-patterns, were ~35KB of dead weight); (3) `--font-display` scoped to `var(--font-display-grotesk)` under `.landing-route`, so the existing `font-display` Tailwind utility resolves to Space Grotesk on landing surfaces while app-shell still inherits Fraunces during the separate migration window — fixes Fraunces leakage on top nav, mobile drawer, skill card titles, agent labels, repo rail header, catalog rows, and pillar numerals in one CSS rule; (4) hero h1 hierarchy restored — section h2 size tokens pulled from `clamp(36-40px,5.4vw,72px)` to `clamp(36px,4vw,56px)` across `WhyOrnn`, `InstallEverywhere`, `FeaturedSkills`, `VSComparison`, `PublishSection` so the hero is the dominant type moment again (was 58.88px hero vs 69.12px sections at desktop 1280); (5) static reduced-motion hero synced to active hero token; (6) `LandingNav` mobile dropdown panel soft drop shadow swapped to `--card-shadow-rest` letterpress impression token; (7) phone mockup composite shadow stripped of its 140px-blur soft drop floor and 100px-blur ember halo (both DESIGN.md anti-patterns), replaced with a hard 12×12 letterpress impression at `--color-shadow-press`; (8) body element `bg-[#0A0907] text-[#F1ECDE]` arbitrary classes replaced with `bg-page text-strong` token utilities so theme switching now flows through the page bg instead of relying on a sticky overlay; (9) focus-visible ring added to `SkillCard` (via new `.card-letterpress:focus-visible` rule), `CatalogRow`, and all `LandingNav` text links + logo via a new reusable `.focus-ring-ember` utility class that stacks DESIGN.md's `--button-focus-ring` (page-color halo + ember outer) — keyboard navigation now lights up landing surfaces correctly. Bonus: nav text links migrated from `font-display` to `font-text` (Inter) per DESIGN.md "Inter is the default for navigational labels."

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor: group skill-related pages under `pages/skill/` ([#104](https://github.com/ChronoAIProject/Ornn/issues/104)). Pure file move — `CreateSkillFreePage`, `CreateSkillFromGitHubPage`, `CreateSkillGenerativePage`, `CreateSkillGuidedPage`, `EditSkillPage`, `MySkillsPage`, `SkillAuditHistoryPage`, `SkillDetailPage`, `UploadSkillPage` now live under `pages/skill/`. New `pages/skill/index.ts` barrel; `App.tsx` imports updated to use the new paths. No route or behavior change.

- [#234](https://github.com/ChronoAIProject/Ornn/pull/234) [`a057c91`](https://github.com/ChronoAIProject/Ornn/commit/a057c911e2d6f3169d66212d4e0f87c6a14a8f80) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - refactor: migrate `App.tsx` to RR7's data router ([#103](https://github.com/ChronoAIProject/Ornn/issues/103)). `BrowserRouter + Routes + Route` is replaced with `createBrowserRouter(createRoutesFromElements(...))` + `<RouterProvider>`. The route tree itself is still authored as JSX so the diff is minimal — every route, layout, guard, and code-split target is preserved exactly. Loaders / actions are NOT introduced in this PR; that's per-route work that can land separately when a clear win surfaces. Suspense fallback wraps the RouterProvider so existing `lazy()` chunks keep working unchanged.

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

### Patch Changes

- [#146](https://github.com/ChronoAIProject/Ornn/pull/146) [`e7e8c18`](https://github.com/ChronoAIProject/Ornn/commit/e7e8c18fd74d708bd7213256f61649297669caaa) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Fix nginx SNI when proxying to an HTTPS NyxID upstream behind a multi-tenant edge (Cloudflare et al). Without `proxy_ssl_server_name on` + a proper `proxy_ssl_name`, the upstream TLS handshake fails with alert 40 and the browser sees 502. Adds a new `NYXID_BACKEND_HOST` env var (hostname part of `NYXID_BACKEND_URL`, e.g. `nyx.chrono-ai.fun`) consumed by `nginx.conf.template` for SNI + Host header; plumbed through `deployment/ornn-web/configmap.yaml` and `deployment/.env.sample.ornn`.

## 0.3.2

### Patch Changes

- [#142](https://github.com/ChronoAIProject/Ornn/pull/142) [`bc5157c`](https://github.com/ChronoAIProject/Ornn/commit/bc5157c7d5f545e0cc1df1da819f319aad3532c2) Thanks [@chronoai-shining](https://github.com/chronoai-shining)! - Smoke test for PR [#141](https://github.com/ChronoAIProject/Ornn/issues/141) — forces a v0.3.2 patch bump so the release state machine can exercise the new direct-API merge path. After this ships, `git show` on the sync commit should list two parents and `git merge-base origin/main origin/develop` should equal `origin/main`'s HEAD.

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
