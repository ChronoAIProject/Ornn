---
"ornn-api": minor
"@chronoai/ornn-sdk": minor
---

Cursor pagination on `/skill-search` per CONVENTIONS.md §4.3 + SDK auto-pagination iterator (#457 + #465).

**API (`/api/v1/skill-search`)**

- Accepts `?cursor=<opaque-base64>` (alongside the existing `?page=N`). When both are sent, `cursor` wins.
- Accepts `?limit=N` as an alias for the existing `?pageSize=N`.
- Response now carries a `meta` envelope: `{ data: { items, total, page, pageSize, totalPages, meta: { limit, hasMore, nextCursor? } }, error }`. The legacy fields stay until they're sunset — clients can migrate at their own pace.
- A malformed cursor returns `400 invalid_cursor` (RFC 7807 problem+json) instead of silently falling back to page 1.
- Cursor payload is server-internal (`{ page: number }` today, `lastSort` keyset in a future PR) — clients MUST treat it as opaque.

**SDK (`@chronoai/ornn-sdk`)**

- `client.search()` now accepts `cursor` + `limit` params (additive).
- New `client.searchAll({ q })` returns an `AsyncIterableIterator<SkillSummary>`. Threads `meta.nextCursor` automatically; terminates on `hasMore === false` or no more cursor. 10k-page safety cap.

```ts
for await (const skill of client.searchAll({ q: "pdf" })) {
  console.log(skill.name);
}
```

**Out of scope (follow-up)**

- Real lastSort keyset cursor under the hood — current cursor encodes `{ page }` so the wire contract conforms to §4.3 while the underlying query stays offset-based. Switching the payload is invisible to clients.
- Cursor support on other list endpoints (categories, tags, users) — those keep their existing offset shape for now.
- Python SDK `search_all()` — follow-up.
- `Sunset:` header on the legacy `page`/`pageSize` shape — once cursor adoption is high enough.
