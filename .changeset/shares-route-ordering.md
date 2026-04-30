---
"ornn-api": patch
---

fix(api): `GET /shares/review-queue` was 404 because the wildcard `/shares/:requestId` route was registered first and captured the literal segment as a `requestId`. Reorder so static paths (`/shares`, `/shares/review-queue`) are registered ahead of the dynamic one.
