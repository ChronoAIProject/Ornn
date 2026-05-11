---
"ornn-web": patch
---

Extract the signed-in avatar-dropdown content into a shared `lib/userMenu` module so the app-shell `Navbar` and landing `LandingNav` can't drift apart again.

Both navs used to hand-maintain identical item lists (profile / services / orgs / redeem code / NyxID / admin section / signout). Over time LandingNav fell behind: it was missing **Redeem code** and **Admin services** on desktop, and its mobile hamburger was even sparser (profile + admin + signout only). The shape mirrored the previous `/news` drift fixed in #361 — two surfaces, two hand-maintained copies, divergence by drift.

`lib/userMenu.ts` now exports `getNyxIdUrl()` (was duplicated verbatim in both navs) plus a `useUserMenuGroups(user)` hook returning a typed, i18n-resolved, admin-gated list of grouped items. Each surface renders the items with its own wrapper components — `Navbar` keeps `text-body` / `hover:bg-elevated` / `hover:text-accent`, `LandingNav` keeps `text-bone` / `hover:bg-surface-elevated` / `hover:text-ember` — but the **content** lives in one place. Renaming, reordering, or gating an item is now a single-file edit that lands on both surfaces in the same commit; divergence becomes a TS error instead of a visual one. Both desktop dropdowns AND mobile hamburger menus now render the full item list on every surface.

Closes #363.
