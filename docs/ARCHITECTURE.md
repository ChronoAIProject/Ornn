# Architecture — chrono-ornn

> For API v1 and architecture conventions, see [`conventions.md`](./conventions.md). Active refactor work is tracked under the [`Refactor` milestone](https://github.com/ChronoAIProject/Ornn/milestone/6).

## Project Overview

chrono-ornn is an AI skill platform. Users create, publish, search, and execute AI skills (packaged prompts + scripts) via a web UI or API. Authentication and LLM calls go through NyxID. Script execution runs in chrono-sandbox.

## External Services

| Service | How ornn-api talks to it |
|---------|---------------------------|
| NyxID | JWT verification (JWKS), API key introspection, LLM Gateway (Responses API) |
| chrono-sandbox | `POST /execute` — script execution with env vars, dependencies, file retrieval |
| chrono-storage | Upload/download/delete skill packages (presigned URLs) |

## Skill Format

- Available runtimes: `node`, `python`
- Frontmatter field for dependencies: `runtime-dependency`
- Category types: `plain`, `tool-based`, `runtime-based`, `mixed`
- Output types: `text` (stdout), `file` (generated files retrieved via glob)

## Ornn Core Skills

The `.ornn-apis/` directory contains three plain skills that teach AI agents how to use Ornn:

| Skill | Purpose |
|-------|---------|
| `ornn-search-and-run` | Discover, pull, and execute skills via NyxID MCP |
| `ornn-upload` | Package and upload skills to the registry |
| `ornn-build` | Generate new skills from natural language via AI |

### Editing Core Skills

When editing skills in `.ornn-apis/`:
- Each skill is a single directory containing at minimum a `SKILL.md` file
- `SKILL.md` must have valid YAML frontmatter with `name`, `description`, and `metadata.category`
- Skills guide AI agents through multi-step MCP workflows — keep instructions precise and include example JSON payloads
- The upload skill must instruct agents to create ZIPs **with a root folder** (e.g., `skill-name/SKILL.md`), not flat files

## Audit

The audit subsystem captures one structured record per `/api/v1/*` request. Records answer the questions Pino logs alone can't (who? from where? was this human or agent? what did the request body look like?) and feed forensic / compliance / future admin-dashboard use cases. See issue #245 for the original spec; the implementation lives at `ornn-api/src/middleware/audit/`.

### Pipeline

```
HTTP request ─→ proxyAuthSetup (resolves c.var.auth)
            ─→ auditMiddleware
                  ├─ snapshot req body via req.raw.clone()
                  ├─ resolve source IP from XFF / X-Real-IP, truncate immediately
                  ├─ run downstream handler (await next())
                  ├─ snapshot res body via res.clone() (write op or 4xx/5xx only)
                  ├─ resolve callerType from auth shape + X-Ornn-Caller hint
                  ├─ redact bodies (whitelist + global blacklist)
                  ├─ inline (≤16 KB) or gzip → MinIO
                  ├─ insertOne → Mongo `api_audit`
                  └─ Pino info `api audit` line
```

Failure isolation is non-negotiable: any error inside the audit pipeline is caught and logged at `error`; the business response is never delayed or replaced. Mongo down → no audit row, business OK. MinIO down → `bodyOffloadFailed: true` on the doc, body refs left null, business OK.

### MongoDB schema (`api_audit`)

```ts
{
  _id: string,                        // ULID
  timestamp: Date,
  durationMs: number,
  method: string,
  path: string,                       // route pattern (`/api/v1/skills/:id`)
  rawPath: string,                    // actual path
  queryString: string | null,
  sourceIp: string,                   // truncated (last octet zeroed for IPv4; first /48 kept for IPv6)
  userAgent: string | null,
  callerIdentity: string | null,      // NyxID userId, null for anonymous
  callerType: 'web' | 'agent' | 'anonymous',
  headerHint: string | null,          // raw X-Ornn-Caller (untrusted)
  callerTypeMismatch: boolean,        // true when hint disagrees with auth shape
  status: number,
  reqBodyRef: { kind: 'inline'; data } | { kind: 'minio'; key } | null,
  resBodyRef: { kind: 'inline'; data } | { kind: 'minio'; key } | null,
  redactedFields: string[],
  bodyOffloadFailed?: true,
}
```

**Indexes**: `(timestamp -1)` · `(callerIdentity, timestamp -1)` · `(path, timestamp -1)` · `(callerType, timestamp -1)` · TTL on `timestamp` (`expireAfterSeconds = AUDIT_RETENTION_DAYS * 86400`).

### Caller-type matrix

| auth shape | `X-Ornn-Caller` | `callerType` | mismatch? |
|---|---|---|---|
| browser session (NyxID OAuth cookie / browser-scope Bearer) | `web` | `web` | no |
| browser session | missing or other | `web` | yes |
| NyxID forwarded access token (agent via NyxID proxy) | empty | `agent` | no |
| NyxID forwarded access token | non-empty + non-`agent` | `agent` | yes |
| no identity | any | `anonymous` | — |

Mismatch is informational only — never blocks the request. Pino emits a warn line when it fires; admin dashboards highlight mismatched rows for forensic review.

### Redaction

Two layers compose:

1. **Whitelist (per-route opt-in).** Routes call `setAuditConfig(c, { req: [...], res: [...] })` with field names they want preserved. Anything not listed becomes `[REDACTED]` in the persisted doc. Empty whitelist (default) means everything is redacted — safe-default.
2. **Blacklist (global, regex).** Field names matching `password|token|apiKey|secret|key|credential` (case-insensitive) are always redacted, regardless of whitelist. Operators extend the pattern set via `AUDIT_GLOBAL_REDACT_PATTERNS` (comma-separated). The blacklist always wins — even if a route mistakenly lists `apiKey` in its whitelist, secrets stay out of the database.

Identity-bearing **headers** (`Authorization`, `Cookie`, `Set-Cookie`, `X-NyxID-*`) are never read into the pipeline at all — the middleware doesn't even snapshot them. Only `User-Agent`, `X-Ornn-Caller`, `X-Forwarded-For`, and `X-Real-IP` are consulted.

### Body offload

| condition | action |
|---|---|
| read 200 | metadata only (`reqBodyRef = resBodyRef = null`) |
| write op (POST/PUT/PATCH/DELETE) or status ≥ 400, body ≤ `AUDIT_BODY_INLINE_MAX_KB` | inline in Mongo doc |
| same, body > inline cutoff | gzip → MinIO `${MINIO_AUDIT_BUCKET}/<YYYY>/<MM>/<DD>/<auditId>-<side>.json.gz`; doc holds the key |
| MinIO put fails | `bodyOffloadFailed: true`; doc still inserted; business response unaffected |

MinIO bucket lifecycle is configured out-of-band (mirroring `AUDIT_RETENTION_DAYS`) so offloaded bodies expire on the same cadence as the Mongo TTL.

### Configuration

| env var | default | meaning |
|---|---|---|
| `AUDIT_RETENTION_DAYS` | `90` | Mongo TTL window for audit docs |
| `MINIO_AUDIT_BUCKET` | `ornn-audit` | bucket holding offloaded bodies |
| `AUDIT_BODY_INLINE_MAX_KB` | `16` | inline-vs-MinIO cutoff |
| `AUDIT_GLOBAL_REDACT_PATTERNS` | (empty) | comma-separated extra blacklist patterns |

### Per-route opt-in example

```ts
import { setAuditConfig } from "../../../middleware/audit";

app.post("/skills", async (c) => {
  setAuditConfig(c, {
    req: ["skillName", "description", "category"],
    res: ["skillId", "version"],
  });
  // ...handler...
});
```

Routes that don't call `setAuditConfig` still get audited — they just produce records where every body field reads `[REDACTED]`. The expectation is that admin and write routes opt in to capturing the most operationally-useful fields.
