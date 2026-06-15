---
"@chronoai/ornn-sdk": patch
---

Fix package download in both SDKs. `downloadPackage` / `download_package` (and the `pullClosure` / `pull_closure` that build on them) targeted a `GET /skills/:id/versions/:version/download` endpoint that does not exist server-side, so every package pull 404'd and both README quickstarts were broken. They now resolve the package via the skill-detail `presignedPackageUrl` (honoring an optional `version`), fetch the bytes directly from object storage, and verify them against the skill's `skillHash` (SRI) when present. (#1011)
