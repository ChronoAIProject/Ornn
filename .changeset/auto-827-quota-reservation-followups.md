---
"ornn-api": patch
---

Thread the quota reservation timestamp through to charge-on-completion so per-model analytics reconcile against the reserved month bucket (fixes a benign month-boundary straddle). Add route-level integration tests covering model-resolution failure (used unchanged) and aborted/errored streams (slot released). Note for consumers: /me/quota remaining reflects in-flight reservations — used is bumped at reserve time and refunded on system-error/abort.
