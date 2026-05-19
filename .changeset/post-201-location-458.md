---
"ornn-api": patch
---

Return `201 Created` + `Location` header on resource-creating POST endpoints (#458). `POST /skills` (ZIP upload), `POST /skills/pull` (GitHub pull), `POST /admin/announcements`, and `POST /admin/broadcasts` previously returned `200 OK` with the resource in the envelope; CONVENTIONS.md §3.2 + RFC 9110 §15.3.2 specify `201 Created` with a `Location: /api/v1/{resource}/{id}` header so clients (and the upcoming SDK auto-pagination wrapper) can discover the canonical URL without re-parsing the body. Response body unchanged — only status code + new header. Existing 200-aware clients still work; the SDK already follows redirects and reads the envelope regardless of 2xx code.
