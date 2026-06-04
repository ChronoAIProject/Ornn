---
"ornn-api": patch
---

Harden log redaction: token, accessToken, userAccessToken, clientSecret and privateKey are now censored in all Pino logger roots (shared logger, bootstrap, entrypoint), sourced from a single exported REDACT_PATHS constant.
