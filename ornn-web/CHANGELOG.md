# ornn-web

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
