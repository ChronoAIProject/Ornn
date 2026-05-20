---
"ornn-api": minor
---

Mirror the client-side `#443` zip-bomb defense on the backend (#633). Closes the gap surfaced during retrospective verification: an agent / SDK / `curl` client that bypasses the browser SPA could POST a 50 KB ZIP that uncompresses to 500 MB inside `validateZipFormat` or the AgentSeal subprocess.

New `enforceZipLimits(zipBuffer)` in `shared/utils/zipLimits.ts` walks the ZIP central directory **without extracting** and throws RFC 7807 `413 Payload Too Large` (with stable `lowercase_snake_case` codes per CONVENTIONS.md §1.4) on any of:

| Cap | Default | Error code |
|---|---|---|
| Cumulative uncompressed | 50 MiB | `uncompressed_too_large` |
| Per-entry uncompressed | 25 MiB | `uncompressed_too_large` |
| File count | 1000 | `too_many_files` |
| Compression ratio | 50× (skipped for tiny ZIPs) | `uncompressed_too_large` |
| Invalid ZIP | — | `invalid_zip` (400) |

Wired into every authenticated upload path:
- `POST /api/v1/skills` (create)
- `PUT /api/v1/skills/:id` (update, only when a ZIP is actually replaced)
- `POST /api/v1/skill-format/validate` (the standalone validator endpoint)

Defaults match the client-side guard exactly so a ZIP that passes browser pre-flight also passes the server. Configurable via the function signature today (env-var hooks can ride in a follow-up if operators ask for them).

8 unit tests cover the happy path, each cap, the invalid-ZIP fast-path, and the tiny-ZIP ratio-check carve-out.
