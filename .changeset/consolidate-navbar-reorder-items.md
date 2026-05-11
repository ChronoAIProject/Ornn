---
"ornn-web": patch
---

Consolidate `LandingNav` into the unified `Navbar` and reorder the top nav items.

The landing page and the app shell were running two near-identical nav components — `pages/landing/LandingNav.tsx` and `components/layout/Navbar.tsx`. The visual divergence was an illusion: landing tokens (`parchment` / `bone` / `ember`) resolve to the exact same colors as the app-shell semantic tokens (`strong` / `body` / `accent`) in both themes. The only real functional differences were the extra "Get started" CTA on landing, the framer-motion-animated dropdown, and the mobile "Language" / "Theme" labels (where the app navbar hard-coded English — a real i18n bug for `zh` users).

All three are folded into `Navbar`:

- New optional prop `showGetStartedCta` opts into the landing CTA pair (Sign in + Get started).
- Motion-wrapped dropdown is now the default — consistent across both surfaces.
- All mobile labels go through `react-i18next`, fixing the i18n drift.

`LandingPage` now renders `<Navbar showGetStartedCta />`; `LandingNav.tsx` is deleted (–805 lines). #363 (shared `userMenu.ts`) and #361 (`/news` drift) treated symptoms of the same dual-nav structural problem — this fully removes the duplication.

Top nav items reordered on both surfaces (one-line change in the unified `NAV_ITEMS` constant) so visitors land on platform activity first, the agent-API funnel (`Build / Registry / Docs`) stays clustered in the middle, and `Contact` trails:

- Before: `Registry, Build, Docs, News, Contact`
- After: `News, Build, Registry, Docs, Contact`

Closes #375.
