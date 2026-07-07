---
"ornn-api": minor
"ornn-web": minor
---

Migrate skill package downloads to chrono-bucket's streaming endpoint (#1196). chrono-bucket (replacing chrono-storage) removed presigned URLs and the object-copy endpoint and now serves downloads via a streaming `GET /objects/download` behind the NyxID proxy. ornn-api's storage client gains a streaming `downloadObject()` (replacing the removed `getPresignedUrl`/`copy`); package reads for diff/json/audit go through it, and a new `GET /skills/:idOrName/versions/:version/download` route streams the ZIP through ornn-api (the route the TS SDK's `downloadPackage()` already targets). The client-facing `presignedPackageUrl` field is dropped from the skill detail response, and the web viewer now pulls packages through that authenticated ornn-api route instead of fetching chrono-bucket / MinIO directly. Also removes the wasted presigned round-trip and dead code in the audit pipeline (#995).
