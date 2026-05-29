---
"ornn-api": patch
"@chronoai/ornn-sdk": patch
---

Enable `noImplicitOverride` in `ornn-api`, `ornn-web`, and `sdk/typescript` tsconfigs (#450 part 1). Catches accidental method-signature drift during class-inheritance refactors. Only one site needed the explicit `override` keyword (`ErrorBoundary` in `ornn-web`) — zero behavior change.

The other two flags from #450 (`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`) surface 68 and 75 type errors respectively across `ornn-api` alone. Per the issue's "Land in stages" guidance, those ride in their own follow-up PRs to keep the diff reviewable. Tracked as sub-tasks on #450.
