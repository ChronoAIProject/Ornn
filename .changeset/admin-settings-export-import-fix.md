---
"ornn-api": patch
---

Fix admin Settings → Export / Import (both directions broken):

- **Export**: backend now wraps the export envelope in the standard `{ data, error }` shape so the SPA's `apiGet` can parse it. Previously returned a raw envelope, which made the SPA throw "Export missing" on every click.
- **Import**: backend now accepts the `dryRun` flag from the request body (where the SPA sends it) in addition to the query string. Previously query-only — the "Run dry-run preview" button silently committed the import every time.

Closes #330.
