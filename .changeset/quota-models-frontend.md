---
"ornn-web": minor
---

feat(web): per-user quota UI + admin model selection (frontend for #250 + #251).

- **Quota chip** (#250): persistent counter pill in the top nav for authenticated users (admin-bypassed). Click → drawer with monthly base, daily ceiling, beta-credit balance, and reset times for both surfaces. Tone goes amber at 80% and red at zero.
- **In-context displays** on the playground and skill-gen pages — compact stamp by default, soft-warning banner at 80% of monthly base, and a brand-consistent `OverLimitPage` (CTA-forward, screenshot-friendly) when the surface is exhausted.
- **Admin grant UI** at `/admin/quota`: per-user inline `GrantCreditsForm` and bulk-select `BulkGrantCreditsModal`, plus a recent-grants audit-trail card.
- **Model picker** (#251) on playground + skill-gen: dropdown sourced from the admin-curated catalog, ordered default-first. Selection persists per-surface via `localStorage` (`ornn.preferredModel.playground`, `ornn.preferredModel.skillGen`); stored values that the admin later disables silently fall back to the surface default without clearing storage.
- **Admin Models** page at `/admin/models`: catalog list with per-surface enable toggles, default radios, archived flag, refresh-from-upstream button, and search.
- Wires `modelId` through the playground and skill-gen SSE clients so the picker's choice reaches the backend resolver added in #258.
