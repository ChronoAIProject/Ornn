---
"ornn-api": patch
---

Decompose `bootstrap.ts` per-domain (#580).

Lifts 10 leaf domains' wiring out of the 1089-line `bootstrap.ts` monolith into per-domain `bootstrap.ts` modules. Each one exports a `wire{Domain}({ db, logger, ...deps })` function that bundles repo construction + `ensureIndexes()` fire-and-forget catch + any one-shot boot migration + service construction + routes construction into a single call. The orchestrator stays in charge of *ordering* and shared client construction; the per-domain *detail* moves out.

Domains extracted:

- announcements
- analytics
- quota (consumed by playground / skill-gen / admin)
- redemption-codes (admin + me route surfaces, shared service for atomic pivot consistency)
- broadcasts (2-step: shared repo first, then service + routes)
- notifications (consumes shared broadcasts repo for the merged feed)
- platform settings (legacy single-doc surface)
- admin (dashboard + users + quota admin)
- skill search
- skill generation
- playground

What's still inlined: skills CRUD, skill audit, GitHub mirror, settings export/import, and `createAdminRoutes` (skill / generation / agentseal admin). These have heavier cross-cutting dependency lists (scheduler lifecycle, audit fan-out, analytics emitter closures) — extracting them cleanly needs a follow-up.

bootstrap.ts: **1089 → 970 lines** (-11%, -119 lines net). No behavioral change — boot order is preserved, all 798 tests still pass.
