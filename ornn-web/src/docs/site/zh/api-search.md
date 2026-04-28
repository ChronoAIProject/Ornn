# API Reference — Skill Search

## `GET /api/v1/skill-search`

**Unified keyword / semantic search.**

> **Auth optional.** Anonymous callers are forced to `scope=public` regardless of the query string.

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string ≤ 2000 | `""` | Search term |
| `mode` | `keyword` \| `semantic` | `keyword` | Semantic uses LLM re-ranking |
| `scope` | `public` \| `private` \| `mixed` \| `shared-with-me` \| `mine` | `private` (auth) / `public` (anon) | — |
| `page` | int ≥ 1 | `1` | — |
| `pageSize` | int 1–100 | `9` | — |
| `model` | string | platform default | LLM model override (semantic mode) |
| `systemFilter` | `any` \| `only` \| `exclude` | `any` | "System skill" tri-state filter |
| `sharedWithOrgs` | CSV of org IDs | — | Narrow by grant source |
| `sharedWithUsers` | CSV of user IDs | — | Narrow by grant source |
| `createdByAny` | CSV of user IDs | — | Narrow by author |

System-skill filtering uses the caller's NyxID user-services slug list; unreachable NyxID fail-softs to "no system skills" instead of 500.

### Response 200

```jsonc
{
  "data": {
    "items": [ /* SkillSummary[] */ ],
    "total": 42,
    "page": 1,
    "pageSize": 9,
    "totalPages": 5
  },
  "error": null
}
```

In semantic mode, each item also carries `relevanceScore: <0..1>`.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `QUERY_REQUIRED` | `mode=semantic` with empty `query` |
| 400 | `INVALID_QUERY` | Schema validation failed |
| 401 | `AUTH_REQUIRED` | `mode=semantic` from anonymous caller |

---

## `GET /api/v1/skill-counts`

**Counts for the registry tab badges (`Public`, `Mine`, `Shared with me`).**

> **Auth optional.** Anonymous callers see `mine = 0`, `sharedWithMe = 0`.

### Response 200

```json
{ "data": { "public": 42, "mine": 7, "sharedWithMe": 3 }, "error": null }
```

No errors.
