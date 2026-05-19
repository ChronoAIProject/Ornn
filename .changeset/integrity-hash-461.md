---
"ornn-api": patch
---

Surface npm-style Subresource Integrity on the skill version manifest (#461). `GET /skills/:idOrName/versions` now returns each version with an `integrity: "sha256-<base64>"` field alongside the existing hex `skillHash`. Clients (SDK + agents) verify a downloaded package byte-for-byte before installing — equivalent in spirit to npm's `package-lock.json` `integrity:` field and PyPI's per-file `sha256_digest`. The underlying hash was already computed at upload + stored on the version doc; this PR just derives the SRI form (`hexToIntegrity` helper) and surfaces it.
