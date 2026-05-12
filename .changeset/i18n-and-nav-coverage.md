---
"ornn-web": patch
---

Close three i18n / nav coverage gaps that landed under the radar:

- **`nav.redeemCode` key was missing in both `en.json` and `zh.json`** — Navbar dropdown used `t("nav.redeemCode", "Redeem code")` with a fallback, so the English string was rendered to every locale. Added the key in both languages (`Redeem code` / `兑换码`).
- **Admin Dashboard was 100% hardcoded English.** `pages/admin/DashboardPage.tsx` + `components/admin/RecentActivities.tsx` had zero `useTranslation` calls. Both now wire to a new `adminPages.dashboard.*` i18n block covering heading, subtitle, the two section headings, all six tile labels + helpers, aria labels, the PostHog body / not-configured warning, and the Activity feed + Insights link labels. Skill-visibility code identifiers (`isSystemSkill: true`, `!isPrivate ∧ !isSystemSkill`, `isPrivate: true`) stay verbatim across locales — they're code, not natural language.
- **LandingNav had no `/news` entry.** PR #358 only added News to the app-shell `Navbar` (RootLayout), so anonymous visitors landing on `/` saw only Registry / Build / Docs / Contact. Added News between Docs and Contact in both the desktop nav row and the mobile hamburger panel, reusing the existing `nav.news` i18n key.

Closes #361.
