---
"ornn-web": patch
---

`apiClient.handleResponse` now extracts the actionable `error.message` from the legacy `{ data: null, error: { code, message } }` envelope on non-2xx responses, in addition to the RFC 7807 `application/problem+json` shape it already handled (#694).

Pre-#694, `handleResponse` parsed only `body.code / body.detail / body.title` on non-2xx. Several backend domains (LLM provider model sync, settings validation under #456, anything still funnelling through `AppError → buildErrorEnvelope`) keep emitting the legacy envelope, so their structured `error.message` was discarded and the frontend surfaced only the generic literal "An unexpected error occurred" — losing actionable detail like `"MODEL_LIST_UNREACHABLE: Provider model-list endpoint failed: …"` or `"INVALID_SETTING: postHogHost: URL host is private/loopback/link-local; set ORNN_URL_ALLOWLIST_CIDR to allow"`.

Fix: in the non-2xx branch, try `body.error.{code,message}` first (the more actionable shape when present), then fall back to RFC 7807's `body.{code,detail,title}`, then to the generic literal. `ApiClientError.code` and `.message` now carry whichever was richer.

Out of scope: no new unit test added because the existing module-init chain (`apiClient → authStore → …`) fails to load cleanly in vitest's headless environment without additional setup; the per-domain `onError` callsites already exercise `translateError(err, fallback)` against real `ApiClientError` instances in `pages/admin/settings/*` and `components/skill/*` flows. Manual repro per the issue body (LLM provider sync against an invalid model-list URL; saving PostHog config with a loopback host) is the gate.
