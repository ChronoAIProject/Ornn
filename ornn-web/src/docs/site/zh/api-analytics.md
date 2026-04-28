# API Reference — Analytics

Both endpoints follow skill visibility — anonymous callers can analyze public skills only.

## `GET /api/v1/skills/:idOrName/analytics`

**Execution summary for a skill.**

> **Auth optional.** Visibility rules apply.

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `window` | `7d` \| `30d` \| `all` | `30d` | — |
| `version` | `<major>.<minor>` | all | Aggregate one version |

### Response 200

```jsonc
{
  "data": {
    "skillGuid": "...",
    "skillName": "ornn-api",
    "window": "30d",
    "totalPulls": 14,
    "uniqueUsers": 8,
    "lastPull": "2026-04-28T...",
    "pullsBySource": { "api": 0, "web": 13, "playground": 1 },
    "executions": { "count": 42, "successRate": 0.95, "p50LatencyMs": 220, "p95LatencyMs": 1200, "p99LatencyMs": 3300, "topErrors": [] }
  },
  "error": null
}
```

`executions` is omitted when no execution data exists in the window.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_WINDOW` | `window` not in 7d/30d/all |
| 404 | `SKILL_NOT_FOUND` | — |

---

## `GET /api/v1/skills/:idOrName/analytics/pulls`

**Pull time-series, bucketed.**

> **Auth optional.** Visibility rules apply.

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `bucket` | `hour` \| `day` \| `month` | `day` | — |
| `from` | ISO timestamp | now − 7d | — |
| `to` | ISO timestamp | now | — |
| `version` | `<major>.<minor>` | all | — |

### Response 200

```jsonc
{
  "data": {
    "items": [
      { "bucket": "2026-04-22T00:00:00Z", "total": 14, "bySource": { "api": 0, "web": 13, "playground": 1 } },
      { "bucket": "2026-04-23T00:00:00Z", "total": 0, "bySource": { "api": 0, "web": 0, "playground": 0 } }
    ]
  },
  "error": null
}
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_BUCKET` | `bucket` not in hour/day/month |
| 400 | `INVALID_RANGE` | `from`/`to` invalid ISO or `from >= to` |
| 404 | `SKILL_NOT_FOUND` | — |
