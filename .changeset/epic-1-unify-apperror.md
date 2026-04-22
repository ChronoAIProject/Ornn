---
"ornn-api": patch
---

Epic 1: unify `AppError` class (part of #66).

Previously two `AppError` classes existed — the canonical one in `shared/types/index.ts` and an inlined duplicate in `middleware/nyxidAuth.ts`. The global error handler had to fall back to duck-typing (`err.name === "AppError" && typeof err.statusCode === "number" && typeof err.code === "string"`) so errors thrown from either class were caught. A third class or subclass would silently slip past the check.

- Delete the inlined copy in `nyxidAuth.ts`.
- Import the canonical `AppError` from `shared/types/index`. No circular dependency (`shared/types/index.ts` has zero imports).
- Replace duck-typing in `bootstrap.ts`'s `app.onError` with `instanceof AppError` — single source of truth, faster, and a third class would surface immediately as an unhandled error instead of being silently wrapped.
