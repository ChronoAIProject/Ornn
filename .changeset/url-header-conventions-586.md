---
"ornn-api": minor
"ornn-web": patch
"@chronoai/ornn-sdk": patch
---

**BREAKING** for two of the three changes — bring URL + header surface in line with CONVENTIONS.md §2/§4/§7 (#586):

1. **`PATCH /skills/:id/versions/:version` + `DELETE /skills/:id/versions/:version`** — write operations now accept the stable GUID only, not `:idOrName`. Callers passing a name should resolve it via `GET /skills/lookup?name=…` first. (§2.2)
2. **`?q=` is the canonical search param** (§4.1). The legacy `?query=` keeps working as a fallback during the alpha grace window — `q` wins when both are present. Both SDKs and ornn-web migrated to send `q`.
3. **Deprecation signal is RFC 8594 (`Deprecation: true` + `Link: rel="deprecation"`)** — replaces `X-Skill-Deprecated` / `X-Skill-Deprecation-Note` custom headers (§7).

The fourth violation flagged in the issue — `/skills/:id/json` → content negotiation via `Accept` header (§3.3) — is **deferred** to a focused follow-up PR. That one rewires the playground and several SDK paths and deserves its own review.
