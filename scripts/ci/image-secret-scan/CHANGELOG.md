# Changelog

- **1.0.1 — 2026-11-17:** Fix SA-01 R1 by exporting opaque path hashes on every outcome, including detector errors; fix R2 by recursively decoding ZIP, gzip, tar, bzip2, xz and zstd by content signatures, with fail-closed handling for malformed/encrypted/unsupported containers and resource limits. Add direct shipped-wrapper and partial-detector regressions. Supersedes rejected 1.0.0-review-candidate; SA-01 re-verification required.
