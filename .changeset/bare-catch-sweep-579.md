---
"ornn-api": patch
---

Audit + tighten the 31 bare `catch {}` blocks across `ornn-api/src` (#579).

Critical-path catches that swallowed errors silently now capture the error and emit `logger.debug({ err }, '…')` — analytics dispatch, NyxID org lookups, audit-bundle reads, audit-JSON parse, package-parse on source-refresh, optional JSON-array form fields, generation-context binary skips, LLM output parse, GitHub URL parse. Caller behavior is unchanged (still returns null / falls back to defaults), but a misconfigured or broken upstream is now observable in logs instead of hidden behind an empty result set.

The catches that already logged, already rethrew as `AppError`, or where the return value IS the signal (validation result, violation list, parse-failure fallback) are left alone. Each one that stays silent on purpose now carries a one-line comment explaining why, so a future reader doesn't re-flag it.
