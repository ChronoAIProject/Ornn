---
"ornn-web": patch
---

Restore the breadcrumb row + quota chip (playground + skill-gen pills) on the skillset pages (#1078): `useBreadcrumbs()` had no cases for `/skillsets*` routes, so `RootLayout` hid the whole breadcrumb bar — and with it the auth-only `QuotaChip` — on every skillset page. Adds breadcrumb trails for the skillset browse / detail / new / edit / mine routes (resolving GUID→name like the skill route). Also drops the version badge from the skillset browse card so its badge row matches `SkillCard` (which surfaces version only on the detail page).
