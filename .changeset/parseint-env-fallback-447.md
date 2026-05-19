---
"ornn-api": patch
---

Replace `Number(process.env.X ?? "200")` with a fail-fast `parseNonNegativeInt(name, fallback)` helper in `scripts/migrate-quota-to-buckets.ts` (#447). `Number()` silently returns `NaN` on garbage input, baking `NaN` quotas into Mongo when an env file has a typo. The new helper rejects non-numeric input, trailing garbage (`"200abc"`), fractions, negatives, and empty strings at startup with a clear error naming the offending env var. Covered by 9 unit tests in the colocated test file.
