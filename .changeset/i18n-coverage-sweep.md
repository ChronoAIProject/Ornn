---
"ornn-web": minor
---

Close out the i18n coverage milestone for `ornn-web`. ~363 new i18n keys land in `en.json` + `zh.json` with full locale parity; ~110 source files updated; the services-layer error pattern is restructured so locale switching actually reaches user-visible error toasts and panels.

What lands per issue:

- **#344 — Shared controls + drawer Close.** `Button` accepts an optional `loadingText` prop defaulting to `t("common.loading")` so every loading button localises automatically. `Toast`, `CategoryTooltip`, and `UnsavedChangesGuard` go through new `common.aria.*` / `common.unsavedChanges` keys. Drawer `"Close"` aria-labels across QuotaUserDetailDrawer + RedemptionCodeDetailDrawer reuse existing `common.close`.
- **#346 — aria-label sweep.** All screen-reader-visible aria-label and title attributes across landing pages, global chrome (Navbar / Sidebar), playground, and admin chart/table widgets now live under a flat `aria.*` namespace. Brand-bearing labels use `t("aria.brandHome", { brand })` interpolation.
- **#345 — Form / skill / settings / user / editor components.** Placeholders, modal titles, button labels, help text, empty states, and section headings across `components/form/*`, `components/skill/*`, `components/settings/RedeemCodeSection`, `components/user/PhoneNumberInput`, and `components/editor/*` now route through `form.tools.*`, `skillComponents.*`, `settings.redeemCode.*`, `userProfile.*`, `editor.*`, and `githubLink.urlPlaceholder`.
- **#343 — Admin pages + settings sections + `adminMirror` backfill.** Every admin page table header, modal copy, tab label, toast, and confirm dialog goes through `adminPages.*` keys. Settings sections (`Mirror`, `NyxID`, `Telemetry`, `SkillAudit`, `Playground`, `SkillGen`, `Extras`, `LlmProviders`, `ExportImport`) route every form label, hint, and toast through `adminSettings.sections.<name>.*`. `MirrorPage.tsx` was already calling `t("adminMirror.X", "English fallback")` but the keys never existed in either locale — they now exist with proper zh translations.
- **#347 — Services / utils error-code refactor (structural).** New `utils/translateError.ts` helper parses either a JSON-encoded `{key, params}` payload or a bare `errors.foo.bar` key from `Error.message` and routes through `i18n.t()`. Services (`quotaApi`, `redemptionCodesApi`, `settingsApi`, `adminUsersApi`, `modelsApi`, `adminDashboardApi`, `auditApi`) throw i18n keys instead of English prose. `utils/zipValidator` and `utils/skillFrontmatterSchema` return structured `{key, params}` entries; `ValidationErrorPanel` consumes them via `t(entry.messageKey, entry.params)`. All component + page error sinks that previously surfaced `err.message` raw (toast.error, error-state JSX, modal bodies) now route through `translateError(err)`. New `errors.*` namespace covers all sites.
- **#348 — zh translation fix.** `guided.agentLabel` translated from `"Agent"` to `"代理"`. Remaining 10 audit-flagged `zh==en` entries (URL / identifier placeholders, language-selector labels in their own native names, code-comment style strings) intentionally retained.

Test infrastructure: vitest mock for `react-i18next` now resolves keys via `en.json` lookup before falling back to the inline default string or the key itself. Unblocks tests where bare `t("key")` calls produce locale-correct text without ad-hoc fallbacks.

Closes #343, #344, #345, #346, #347, #348.
