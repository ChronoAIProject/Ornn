/**
 * OpenAPI paths for the **Audit & analytics** domain (#1214).
 *
 * Two read-heavy, skill-scoped surfaces that answer different questions
 * about the same skill:
 *
 *   - **Audit** (`domains/skills/audit/routes.ts`) — "is this skill safe
 *     to install and run?". An audit is an LLM review of one specific
 *     *version's* package bytes, scored across five dimensions
 *     (security, code_quality, documentation, reliability,
 *     permission_scope) and reduced to a green / yellow / red verdict.
 *     Audits are never triggered implicitly: sharing a skill does not
 *     audit it, and pulling a skill does not audit it. An owner or a
 *     platform admin POSTs to start one, then polls the GET endpoints
 *     for the terminal record.
 *   - **Analytics** (`domains/analytics/routes.ts`) — "is this skill
 *     actually being used, and does it work?". Two aggregates over
 *     append-only event logs: an execution summary (counts, success
 *     rate, latency percentiles, top error codes) and a time-bucketed
 *     pull series split by `api` / `web` / `playground`. Only the pull
 *     log is written in this build — no code path records an execution
 *     event, so the execution summary is always all-zero / all-null.
 *
 * Everything here is skill-scoped and therefore visibility-scoped: the
 * read endpoints mirror `GET /skills/{idOrName}` exactly. A private
 * skill the caller cannot read answers `404 skill_not_found` — never
 * 403 — so existence is not leaked.
 *
 * No Zod schemas exist for these payloads (the domains model their wire
 * shapes as TypeScript interfaces in `types.ts`, and the one Zod body
 * schema in the audit routes module is not exported), so the schemas
 * below are hand-written and must be kept in lockstep with
 * `domains/skills/audit/types.ts` and `domains/analytics/types.ts`.
 *
 * @module openapi/paths/auditAnalytics
 */

import {
  bearerAuth,
  jsonBody,
  jsonResponse,
  optionalAuth,
  pathParam,
  problemResponses,
  queryParam,
  type JsonSchema,
  type PathMap,
} from "../helpers";

// ---------------------------------------------------------------------------
// Shared schema fragments — audit
// ---------------------------------------------------------------------------

/** Mirrors `AuditDimension` in `domains/skills/audit/types.ts`. */
const auditDimensionSchema: JsonSchema = {
  type: "string",
  enum: ["security", "code_quality", "documentation", "reliability", "permission_scope"],
  description:
    "One of the five fixed scoring dimensions. A completed audit always carries exactly one score per dimension — the parser rejects LLM output that omits any of them, so clients may index by dimension without a presence check.",
};

const auditScoreSchema: JsonSchema = {
  type: "object",
  required: ["dimension", "score", "rationale"],
  properties: {
    dimension: auditDimensionSchema,
    score: {
      type: "integer",
      minimum: 0,
      maximum: 10,
      description: "Integer 0–10, clamped and rounded server-side. Higher is better.",
    },
    rationale: {
      type: "string",
      description:
        "One or two sentences explaining the score. May be an empty string when the model returned no rationale.",
    },
  },
};

const auditFindingSchema: JsonSchema = {
  type: "object",
  required: ["dimension", "severity", "message"],
  properties: {
    dimension: auditDimensionSchema,
    severity: {
      type: "string",
      enum: ["info", "warning", "critical"],
      description:
        "A single `critical` finding forces the verdict to `red` regardless of the numeric scores. Treat `critical` as a hard stop before executing the skill.",
    },
    file: {
      type: "string",
      description:
        "Path of the offending file relative to the skill package root (e.g. `scripts/run.py`). Absent when the finding is about the package as a whole.",
    },
    line: {
      type: "integer",
      description: "1-indexed line number inside `file`. Absent when the model did not localise the finding.",
    },
    message: {
      type: "string",
      description: "Short description of what was found. Always non-empty.",
    },
  },
};

/** Mirrors `AuditRecord` in `domains/skills/audit/types.ts`. */
const auditRecordSchema: JsonSchema = {
  type: "object",
  required: [
    "_id",
    "skillGuid",
    "version",
    "skillHash",
    "status",
    "verdict",
    "overallScore",
    "scores",
    "findings",
    "model",
    "createdAt",
    "triggeredBy",
  ],
  description:
    "One audit run of one skill version. Rows are append-only: every trigger inserts a new record and updates it in place from `running` to a terminal state. Nothing is ever overwritten, so the history endpoint is a full audit trail.",
  properties: {
    _id: {
      type: "string",
      description: "UUID of this audit run. Stable; use it to correlate a poll with the run you triggered.",
    },
    skillGuid: { type: "string", description: "GUID of the audited skill (never the name)." },
    version: {
      type: "string",
      description: "The skill version this run scored, e.g. `1.2`. An audit is always version-specific.",
    },
    skillHash: {
      type: "string",
      description:
        "SHA-256 of the package bytes at audit time. The cache key: re-triggering with unchanged bytes inside the 30-day TTL returns this same record instead of spending another LLM call.",
    },
    status: {
      type: "string",
      enum: ["running", "completed", "failed"],
      description:
        "`running` — the LLM pipeline is still in flight and the result fields below are placeholders (verdict `yellow`, overallScore `0`, empty `scores`/`findings`). `completed` — every result field is final. `failed` — the pipeline errored; see `errorMessage`. Branch on this before reading `verdict`.",
    },
    verdict: {
      type: "string",
      enum: ["green", "yellow", "red"],
      description:
        "`green` — overall ≥ 7.5, every dimension ≥ 5, no critical findings. `yellow` — any dimension < 5 or overall < 7.5. `red` — any critical finding, or any dimension < 3. Meaningless unless `status === \"completed\"`.",
    },
    overallScore: {
      type: "number",
      minimum: 0,
      maximum: 10,
      description: "Weighted mean of the five dimension scores, rounded to one decimal. `0` while `status === \"running\"`.",
    },
    scores: {
      type: "array",
      items: auditScoreSchema,
      description: "Exactly five entries once completed, one per dimension, in the fixed dimension order. Empty while running.",
    },
    findings: {
      type: "array",
      items: auditFindingSchema,
      description: "Concrete issues the model flagged. May legitimately be empty on a clean `green` audit.",
    },
    model: {
      type: "string",
      description:
        "LLM model id used for this run, snapshotted at trigger time so historical records stay interpretable after an admin swaps providers. Empty string when no audit model is configured.",
    },
    createdAt: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC timestamp of when the run was queued.",
    },
    completedAt: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC timestamp of the transition to `completed` or `failed`. Absent while `running`.",
    },
    errorMessage: {
      type: "string",
      description: "Short failure cause, truncated to 500 characters. Present only when `status === \"failed\"`.",
    },
    triggeredBy: {
      type: "string",
      description:
        "NyxID user id of whoever started the run, or `system` when an automated pipeline did. Cache hits carry the id of the *original* triggerer, not yours.",
    },
  },
};

const AUDIT_RECORD_EXAMPLE = {
  _id: "3f5b1a0e-8c1a-4a52-9f4c-0c0a1c7b9d21",
  skillGuid: "550e8400-e29b-41d4-a716-446655440000",
  version: "1.2",
  skillHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  status: "completed",
  verdict: "yellow",
  overallScore: 7.2,
  scores: [
    { dimension: "security", score: 6, rationale: "Shells out to curl with an unvalidated URL argument." },
    { dimension: "code_quality", score: 8, rationale: "Small, readable, single-responsibility scripts." },
    { dimension: "documentation", score: 8, rationale: "SKILL.md documents every input and output." },
    { dimension: "reliability", score: 7, rationale: "No retry on the network call." },
    { dimension: "permission_scope", score: 7, rationale: "Requests network access it only sometimes uses." },
  ],
  findings: [
    {
      dimension: "security",
      severity: "warning",
      file: "scripts/fetch.sh",
      line: 12,
      message: "URL is interpolated into a shell command without quoting.",
    },
  ],
  model: "gpt-4.1-mini",
  createdAt: "2026-08-01T09:12:44.101Z",
  completedAt: "2026-08-01T09:13:02.884Z",
  triggeredBy: "usr_01J8Z4H9Q3N2",
};

/** A freshly queued run — every result field is still a placeholder. */
function runningAuditExample(id: string, createdAt: string, triggeredBy: string): Record<string, unknown> {
  return {
    _id: id,
    skillGuid: AUDIT_RECORD_EXAMPLE.skillGuid,
    version: AUDIT_RECORD_EXAMPLE.version,
    skillHash: AUDIT_RECORD_EXAMPLE.skillHash,
    status: "running",
    verdict: "yellow",
    overallScore: 0,
    scores: [],
    findings: [],
    model: AUDIT_RECORD_EXAMPLE.model,
    createdAt,
    triggeredBy,
  };
}

/**
 * `POST` body for both trigger endpoints. Hand-written because the
 * route module's `auditTriggerSchema` is a file-local `const` and is not
 * exported — importing it would not compile.
 */
const auditTriggerBodySchema: JsonSchema = {
  type: "object",
  properties: {
    force: {
      type: "boolean",
      default: false,
      description:
        "When `true`, skip the cache lookup and always start a fresh run. When `false` (default) a completed audit of the same package bytes younger than the 30-day TTL is returned as-is, spending no LLM budget.",
    },
  },
  // No `additionalProperties: false`: the route parses the body with a
  // non-strict Zod object, so unknown keys are stripped and the request
  // still succeeds. Documenting a rejection the server never performs
  // would make validating gateways refuse bodies the API accepts.
};

// ---------------------------------------------------------------------------
// Shared schema fragments — analytics
// ---------------------------------------------------------------------------

/** Mirrors `SkillAnalyticsSummary` in `domains/analytics/types.ts`. */
const analyticsSummarySchema: JsonSchema = {
  type: "object",
  required: [
    "skillGuid",
    "window",
    "executionCount",
    "successCount",
    "failureCount",
    "timeoutCount",
    "successRate",
    "latencyMs",
    "uniqueUsers",
    "topErrorCodes",
  ],
  properties: {
    skillGuid: {
      type: "string",
      description: "GUID of the skill the aggregate covers — resolved from the `idOrName` path parameter.",
    },
    window: {
      type: "string",
      enum: ["7d", "30d", "all"],
      description: "Echo of the `window` query parameter, so a cached response is self-describing.",
    },
    version: {
      type: "string",
      description: "Echo of the `version` query parameter. Absent when the aggregate spans every version.",
    },
    executionCount: {
      type: "integer",
      description: "Total execution events in the window. `0` means no data — not a failure.",
    },
    successCount: { type: "integer", description: "Executions with outcome `success`." },
    failureCount: { type: "integer", description: "Executions with outcome `failure`." },
    timeoutCount: { type: "integer", description: "Executions with outcome `timeout`." },
    successRate: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 1,
      description:
        "`successCount / executionCount` as a decimal in [0, 1], or `null` when `executionCount === 0`. Do not coerce `null` to `0` — they mean different things.",
    },
    latencyMs: {
      type: "object",
      required: ["p50", "p95", "p99"],
      description:
        "Wall-clock invocation latency percentiles, in milliseconds, computed server-side over the window. Every field is `null` when there were no executions.",
      properties: {
        p50: { type: ["integer", "null"], description: "Median latency in ms." },
        p95: { type: ["integer", "null"], description: "95th-percentile latency in ms." },
        p99: { type: ["integer", "null"], description: "99th-percentile latency in ms." },
      },
    },
    uniqueUsers: {
      type: "integer",
      description:
        "Count of distinct caller ids across the events in the window. The event log reserves the literal id `anonymous` for executions recorded off an unauthenticated path, so those collapse into one user rather than being dropped. `0` until an execution hook exists.",
    },
    topErrorCodes: {
      type: "array",
      maxItems: 5,
      description:
        "Up to five most frequent error codes across non-success executions, descending by count. Empty when nothing failed or when failures carried no error code.",
      items: {
        type: "object",
        required: ["code", "count"],
        properties: {
          code: { type: "string", description: "Free-form lowercase error code emitted by the execution hook." },
          count: { type: "integer", description: "Occurrences of this code in the window." },
        },
      },
    },
  },
};

/** Mirrors `PullBucketCount` in `domains/analytics/types.ts`. */
const pullBucketSchema: JsonSchema = {
  type: "object",
  required: ["bucket", "total", "bySource"],
  properties: {
    bucket: {
      type: "string",
      format: "date-time",
      description:
        "ISO-8601 UTC timestamp at the START of the bucket, truncated to the requested granularity (e.g. `2026-08-01T00:00:00.000Z` for `bucket=day`). Buckets are always UTC-pinned; the client's timezone is never consulted.",
    },
    total: { type: "integer", description: "Pull count in this bucket across all sources." },
    bySource: {
      type: "object",
      required: ["api", "web", "playground"],
      description:
        "Per-source split. All three keys are always present and zero-filled, so charts do not need null handling.",
      properties: {
        api: {
          type: "integer",
          description:
            "One per `GET /skills/{idOrName}/json` — the only source that actually hands back package contents. SDK, CLI, or an external agent consuming the skill programmatically; the closest signal to real machine adoption.",
        },
        web: {
          type: "integer",
          description:
            "One per `GET /skills/{idOrName}` metadata read by an authenticated caller. Not ornn-web-specific despite the name — any client that reads skill metadata increments it, and that endpoint transfers no package bytes.",
        },
        playground: {
          type: "integer",
          description:
            "One per `POST /playground/chat` request whose body carries a `skillId`. That route is stateless and receives the full message history each turn, so this counts chat turns, not playground sessions.",
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Reusable parameters
// ---------------------------------------------------------------------------

const skillIdOrNameParam = pathParam(
  "idOrName",
  "Skill GUID (e.g. `550e8400-e29b-41d4-a716-446655440000`) or the skill's unique name (e.g. `web-summarizer`). Both resolve to the same skill; the GUID is stable across renames, so prefer it for stored references.",
  { type: "string" },
  "web-summarizer",
);

// ---------------------------------------------------------------------------
// Path map
// ---------------------------------------------------------------------------

/**
 * Build the Audit + Analytics slice of the spec.
 *
 * @param prefix Mount prefix of the v1 API (`/api/v1`). Path keys must
 *   reproduce the Hono routes verbatim after this prefix — the contract
 *   test in `tests/contract/openapiRoutes.test.ts` reflects the booted
 *   router against these keys and fails on any drift, including a
 *   renamed path parameter.
 */
export function auditAnalyticsPaths(prefix: string): PathMap {
  return {
    [`${prefix}/skills/{idOrName}/audit`]: {
      get: {
        summary: "Get the latest audit for a skill version",
        description:
          "Read the **newest** audit row for one skill version, and only when that row's status is `completed`. This is a pure cache read — it never starts an audit and never spends LLM budget, so it is safe to call on every pull. Use it as the pre-flight safety check before installing or executing a third-party skill: gate on `verdict` (`red` means do not run) and inspect `findings` for the specifics.\n\n" +
          "Without `version` the audit of the skill's latest version is returned. With `version` the audit of that exact version is returned; the skill/version pair must exist or you get a 404 before any audit lookup happens.\n\n" +
          "Three different situations all surface as 404 and you must distinguish them by the `code` field: `skill_not_found` (no such skill, or a private skill you cannot read), `skill_version_not_found` (the skill exists but not at that version), and `audit_not_found` (the version's newest audit row is not `completed`).\n\n" +
          "`audit_not_found` is broader than \"never audited\": only the single newest row for the version is inspected, so a `running` or `failed` row **masks** an older completed audit. A previously published verdict therefore disappears for the whole duration of a re-audit, and stays hidden after a failed run until the next successful one. Treat `audit_not_found` as \"unknown risk\", never as a pass. When you need the last known-good verdict regardless of what is in flight, use `GET /skills/{idOrName}/audit/summary-by-version`, which genuinely selects the latest *completed* run per version; when you need to see the in-flight or failed row itself (and its `errorMessage`), use `GET /skills/{idOrName}/audit/history`.\n\n" +
          "Visibility matches `GET /skills/{idOrName}`: public skills are readable anonymously; a private skill requires a token whose bearer is the author, a grantee (direct or via a granted org), or a platform admin.",
        operationId: "getSkillAudit",
        tags: ["Audit"],
        security: optionalAuth(),
        parameters: [
          skillIdOrNameParam,
          queryParam(
            "version",
            "Version to read the audit for. Either a literal `<major>.<minor>` version (e.g. `1.2`) or an `@`-prefixed dist-tag (e.g. `@latest`, `@beta`) which is resolved server-side. Omit for the skill's current latest version. A malformed literal (`1.2.3`, `v1`) is a 400, not a 404.",
            { type: "string", examples: ["1.2", "@latest"] },
          ),
        ],
        responses: {
          ...jsonResponse(auditRecordSchema, "The resolved version's newest audit run — always `status: \"completed\"`.", {
            example: AUDIT_RECORD_EXAMPLE,
          }),
          ...problemResponses(
            {
              400: "Bad request — `version` is not a valid `<major>.<minor>` literal (`invalid_version`) or the `@` dist-tag name is empty (`invalid_dist_tag`).",
            },
            {
              404: "Not found — `skill_not_found` (unknown skill, or private and not visible to this caller), `skill_version_not_found` (unknown version or unset dist-tag), or `audit_not_found` (the version's newest audit row is not `completed` — never audited, a run is in flight, or the last run failed; an older completed run is NOT surfaced). Branch on `code`.",
            },
          ),
        },
      },
      post: {
        summary: "Start an audit of a skill (owner or platform admin)",
        description:
          "Queue an LLM audit of the skill's latest version. This is the \"Start Auditing\" action: audits are never implicit — publishing, sharing, and changing permissions all leave the audit state untouched — so an owner has to ask for one explicitly.\n\n" +
          "The call is **asynchronous and returns 200, not 201**. A row is inserted at `status: \"running\"` and returned immediately; the LLM pipeline (download package → bundle readable files → score → classify) then completes in the background and updates that same row to `completed` or `failed`. Poll `GET /skills/{idOrName}/audit/history` and match the returned `_id` — that is the only read that shows the run while it is `running` and the only one that shows an `errorMessage` if it ends `failed`. `GET /skills/{idOrName}/audit` answers 404 `audit_not_found` for both of those states, since it only ever returns the version's newest row and only when that row is `completed`. A typical run finishes in tens of seconds; poll no faster than every few seconds.\n\n" +
          "Cache semantics: with the default `force: false`, a completed audit of the *same package bytes* younger than the 30-day TTL short-circuits the pipeline and is returned verbatim — you will get a record with `status: \"completed\"` and a `triggeredBy` that is not you. That is the intended cheap path. Send `force: true` only when you specifically need a re-score (e.g. the audit model was upgraded); it always spends an LLM call. The request body is optional — an empty body is accepted and treated as `{}`.\n\n" +
          "Authorization is checked in the handler, not by a route scope: the caller must be the skill's author, or hold `ornn:admin:skill`. Anyone else gets 403 `not_skill_owner`. Platform admins may prefer `POST /admin/skills/{idOrName}/audit`, which skips the ownership lookup entirely.\n\n" +
          "Completion fans out notifications: the owner is always notified; users and org members the skill is shared with are notified only on a `yellow` or `red` verdict.",
        operationId: "triggerSkillAudit",
        tags: ["Audit"],
        security: bearerAuth(),
        parameters: [skillIdOrNameParam],
        requestBody: jsonBody(
          auditTriggerBodySchema,
          "Optional trigger options. Omit the body entirely to accept the defaults.",
          { required: false, example: { force: true } },
        ),
        responses: {
          ...jsonResponse(
            auditRecordSchema,
            "Audit accepted. Either a freshly inserted `running` record (poll for the verdict) or, on a cache hit, an existing `completed` record. Check `status` before reading `verdict`.",
            {
              example: runningAuditExample(
                "b81e0f66-2d43-4d2a-9a53-6c1f5b7f8a10",
                "2026-08-07T11:02:10.004Z",
                "usr_01J8Z4H9Q3N2",
              ),
            },
          ),
          ...problemResponses(
            { 400: "Bad request — the body is not valid JSON, or `force` is not a boolean (`invalid_audit_body`)." },
            401,
            { 403: "Forbidden — `not_skill_owner`. Only the skill's author or a holder of `ornn:admin:skill` may start an audit." },
            { 404: "Not found — `skill_not_found`: no such skill." },
            {
              500: "Internal server error — the audit defaults could not be resolved from platform settings, or the audit row could not be persisted. Retry with backoff.",
            },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/audit/summary-by-version`]: {
      get: {
        summary: "Latest completed audit per skill version",
        description:
          "One request that answers \"which versions of this skill have been audited, and how did each score?\". Returns a map keyed by version string, where each value is that version's most recent **completed** audit record.\n\n" +
          "Versions that have never completed an audit are simply absent from the map — there is no `null` placeholder. Treat a missing key as \"not audited yet\" (unknown risk), never as a passing grade. Running and failed runs are excluded too, so the map only ever contains records with `status: \"completed\"`.\n\n" +
          "Use this instead of N calls to `GET /skills/{idOrName}/audit?version=` when you are deciding which version of a skill to pin: it is a single round-trip over every version the skill has. When you need in-flight or failed runs, or multiple runs of the same version, use the history endpoint.\n\n" +
          "Visibility matches `GET /skills/{idOrName}` — a private skill the caller cannot read answers 404 `skill_not_found`.",
        operationId: "getSkillAuditSummaryByVersion",
        tags: ["Audit"],
        security: optionalAuth(),
        parameters: [skillIdOrNameParam],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["byVersion"],
              properties: {
                byVersion: {
                  type: "object",
                  description:
                    "Version string → that version's most recent completed audit. Keys are the literal version strings (e.g. `1.2`); unaudited versions are omitted. An empty object means no version of this skill has ever completed an audit.",
                  additionalProperties: auditRecordSchema,
                },
              },
            },
            "Per-version audit map. May be empty.",
            {
              example: {
                byVersion: {
                  "1.2": AUDIT_RECORD_EXAMPLE,
                },
              },
            },
          ),
          ...problemResponses({
            404: "Not found — `skill_not_found`: no such skill, or it is private and not visible to this caller.",
          }),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/audit/history`]: {
      get: {
        summary: "List every audit run for a skill",
        description:
          "Full audit trail for a skill, newest first, across every version. Unlike `GET /skills/{idOrName}/audit`, this returns **every** row regardless of status — `running`, `completed`, and `failed` — so it is the endpoint to poll after triggering an audit and the endpoint to read when you need to know *why* an audit did not produce a verdict (`status: \"failed\"` plus `errorMessage`).\n\n" +
          "Records are append-only: each trigger inserts a new row, so the same version can appear many times. Ordering is by `createdAt` descending, so `items[0]` is the most recent run of any version.\n\n" +
          "The optional `version` filter is an **exact string match on the stored record**, applied after retrieval — it does not resolve dist-tags. Passing `@latest` here returns an empty list; pass the concrete version (e.g. `1.2`).\n\n" +
          "There is no pagination: the response carries every stored record for the skill. Audit rows are low-cardinality (one per explicit trigger), but do not assume a bound if you are rendering them.\n\n" +
          "Visibility matches `GET /skills/{idOrName}`.",
        operationId: "listSkillAuditHistory",
        tags: ["Audit"],
        security: optionalAuth(),
        parameters: [
          skillIdOrNameParam,
          queryParam(
            "version",
            "Narrow the history to a single version. Exact literal match against the record's stored `version` (e.g. `1.2`) — dist-tags are NOT resolved here. Omit to get every version's runs.",
            { type: "string", examples: ["1.2"] },
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: auditRecordSchema,
                  description:
                    "Every stored audit run, newest first. Empty when the skill has never been audited (or when the `version` filter matched nothing).",
                },
              },
            },
            "Audit history, newest first. May be empty.",
            { example: { items: [AUDIT_RECORD_EXAMPLE] } },
          ),
          ...problemResponses({
            404: "Not found — `skill_not_found`: no such skill, or it is private and not visible to this caller.",
          }),
        },
      },
    },

    [`${prefix}/admin/skills/{idOrName}/audit`]: {
      post: {
        summary: "Force an audit as a platform admin",
        description:
          "Platform-admin twin of `POST /skills/{idOrName}/audit`. Identical semantics — asynchronous, returns **200** with the `running` row (or a cached `completed` row), same `force` body, same background pipeline, same notification fan-out — with the ownership check removed: it audits any skill on the platform, including ones the caller has no relationship to.\n\n" +
          "Requires the `ornn:admin:skill` request scope on the bearer token, enforced by `requirePermission` before the handler runs. A valid token without that scope is 403 `forbidden`; no token at all is 401.\n\n" +
          "Prefer this route for moderation and incident response (re-scoring a reported skill, back-filling audits after a model upgrade). Note that `force` still defaults to `false`, so a plain call can return a cached record without running anything — send `force: true` when you genuinely need fresh scores.\n\n" +
          "Poll `GET /skills/{idOrName}/audit/history` for the outcome; the admin path has no separate read endpoint.",
        operationId: "adminTriggerSkillAudit",
        tags: ["Audit"],
        security: bearerAuth(),
        parameters: [skillIdOrNameParam],
        requestBody: jsonBody(
          auditTriggerBodySchema,
          "Optional trigger options. Omit the body entirely to accept the defaults.",
          { required: false, example: { force: true } },
        ),
        responses: {
          ...jsonResponse(
            auditRecordSchema,
            "Audit accepted. A freshly inserted `running` record, or an existing `completed` record on a cache hit.",
            {
              example: runningAuditExample(
                "c02a7f31-5f9c-4e7d-8a1b-1d9e2f3a4b5c",
                "2026-08-07T11:05:41.772Z",
                "usr_01J9ADMIN0001",
              ),
            },
          ),
          ...problemResponses(
            { 400: "Bad request — the body is not valid JSON, or `force` is not a boolean (`invalid_audit_body`)." },
            401,
            { 403: "Forbidden — the token lacks the `ornn:admin:skill` permission." },
            { 404: "Not found — `skill_not_found`: no such skill." },
            {
              500: "Internal server error — the audit defaults could not be resolved from platform settings, or the audit row could not be persisted. Retry with backoff.",
            },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/analytics`]: {
      get: {
        summary: "Execution summary for a skill",
        description:
          "Aggregate health of a skill's executions over a rolling window: how often it ran, how often it succeeded, how slow it was, and what it failed with. Use it to decide whether a skill is dependable before wiring it into an agent, and to monitor a skill you own after publishing.\n\n" +
          "**No execution hook is wired in this build.** The aggregate reads an append-only execution log, and nothing in the API writes to it yet — the recording call is reserved for the SDK / CLI / agent-proxy hooks and has no caller today. (The playground records *pulls*, not executions; see `GET /skills/{idOrName}/analytics/pulls`.) Until a hook lands, every skill answers `executionCount: 0`, `successRate: null`, `latencyMs` all-`null`, `uniqueUsers: 0`, `topErrorCodes: []`, no matter how heavily it is used. Read a zero aggregate as \"no telemetry\", never as \"no usage\", and do not gate a skill on it. The response shape below is stable and starts carrying real numbers the moment a hook begins emitting.\n\n" +
          "`window` selects the lookback (`7d`, `30d` default, or `all` for the full retained history). `version` narrows to events recorded against one exact version string — it is a literal match on the event's `skillVersion` field, with no dist-tag resolution, and events stored without a pinned version (`skillVersion` is optional on the event) are excluded from a version-filtered aggregate.\n\n" +
          "Percentiles are computed server-side from raw latency samples in the window; `uniqueUsers` counts distinct caller ids on the stored events.\n\n" +
          "Visibility matches `GET /skills/{idOrName}` — a private skill the caller cannot read answers 404 `skill_not_found`. Note that `window` is validated *before* the visibility check, so an invalid window yields 400 even for a skill you cannot see.",
        operationId: "getSkillAnalyticsSummary",
        tags: ["Analytics"],
        security: optionalAuth(),
        parameters: [
          skillIdOrNameParam,
          queryParam(
            "window",
            "Rolling lookback for the aggregate. `7d` and `30d` are relative to now; `all` disables the time filter entirely. Defaults to `30d` when omitted or empty. Any other value is rejected with 400 `INVALID_WINDOW`.",
            { type: "string", enum: ["7d", "30d", "all"], default: "30d" },
          ),
          queryParam(
            "version",
            "Restrict the aggregate to executions of one exact version, e.g. `1.2`. Literal match — dist-tags such as `@latest` are not resolved and will simply match nothing. Omit to aggregate across all versions.",
            { type: "string", examples: ["1.2"] },
          ),
        ],
        responses: {
          ...jsonResponse(analyticsSummarySchema, "Execution aggregate for the requested window.", {
            example: {
              skillGuid: "550e8400-e29b-41d4-a716-446655440000",
              window: "30d",
              executionCount: 412,
              successCount: 389,
              failureCount: 19,
              timeoutCount: 4,
              successRate: 0.9442,
              latencyMs: { p50: 820, p95: 3140, p99: 7600 },
              uniqueUsers: 37,
              topErrorCodes: [
                { code: "sandbox_timeout", count: 4 },
                { code: "missing_input", count: 3 },
              ],
            },
          }),
          ...problemResponses(
            { 400: "Bad request — `INVALID_WINDOW`: `window` must be exactly `7d`, `30d`, or `all`." },
            { 404: "Not found — `skill_not_found`: no such skill, or it is private and not visible to this caller." },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/analytics/pulls`]: {
      get: {
        summary: "Pull time series for a skill",
        description:
          "Time-bucketed count of a skill's pull events — the adoption signal, as opposed to the reliability signal from `GET /skills/{idOrName}/analytics`. \"Pull\" covers three distinct emission points and only one of them hands out package bytes: `api` is one per `GET /skills/{idOrName}/json` (the package contents), `web` is one per `GET /skills/{idOrName}` metadata read from any client, and `playground` is one per `POST /playground/chat` request bound to a `skillId` — i.e. per chat turn. A caller that reads metadata and then pulls the package increments both `web` and `api`. For real machine adoption, read `bySource.api`.\n\n" +
          "Only authenticated callers are counted. `/skills/{idOrName}/json` and `/playground/chat` both require a token, and the metadata read records nothing when it is served anonymously — so on a public skill this series is a lower bound on actual traffic, not a complete count.\n\n" +
          "Buckets are UTC-truncated to the requested `bucket` granularity and returned ascending by time. **Empty buckets are omitted** — the series is sparse, so a client rendering a chart must zero-fill the gaps itself rather than assuming one entry per interval.\n\n" +
          "The range is `[from, to)` — `from` inclusive, `to` exclusive. Both default relative to now: `to` defaults to the current instant and `from` defaults to seven days before `to`, so an unparameterised call returns roughly the last week bucketed by day. There is no server-side cap on the range, so pairing `bucket=hour` with a multi-year range will produce a very large response; pick the granularity to match the span.\n\n" +
          "Visibility matches `GET /skills/{idOrName}`. All query-parameter validation happens before the visibility check, so malformed parameters yield 400 even for a skill you cannot see.",
        operationId: "getSkillPullsTimeSeries",
        tags: ["Analytics"],
        security: optionalAuth(),
        parameters: [
          skillIdOrNameParam,
          queryParam(
            "bucket",
            "Bucket granularity, truncated in UTC. Defaults to `day` when omitted or empty. Any other value is rejected with 400 `INVALID_BUCKET`.",
            { type: "string", enum: ["hour", "day", "month"], default: "day" },
          ),
          queryParam(
            "from",
            "Inclusive lower bound, any string `Date` can parse — send ISO-8601 UTC (e.g. `2026-07-01T00:00:00Z`). Defaults to seven days before `to`. Must be strictly earlier than `to`.",
            { type: "string", format: "date-time", examples: ["2026-07-01T00:00:00Z"] },
          ),
          queryParam(
            "to",
            "Exclusive upper bound, ISO-8601 UTC (e.g. `2026-08-01T00:00:00Z`). Defaults to now. Pulls landing exactly on this instant are excluded.",
            { type: "string", format: "date-time", examples: ["2026-08-01T00:00:00Z"] },
          ),
          queryParam(
            "version",
            "Restrict the series to pulls of one exact version, e.g. `1.2`. Literal match — dist-tags are not resolved. Omit to count pulls of every version.",
            { type: "string", examples: ["1.2"] },
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: pullBucketSchema,
                  description:
                    "Non-empty buckets only, ascending by `bucket`. An empty array means there were no pulls in the range — zero-fill client-side when charting.",
                },
              },
            },
            "Sparse pull time series for the requested range and granularity.",
            {
              example: {
                items: [
                  { bucket: "2026-07-30T00:00:00.000Z", total: 14, bySource: { api: 11, web: 2, playground: 1 } },
                  { bucket: "2026-07-31T00:00:00.000Z", total: 9, bySource: { api: 6, web: 3, playground: 0 } },
                ],
              },
            },
          ),
          ...problemResponses(
            {
              400: "Bad request — `INVALID_BUCKET` (`bucket` not one of `hour` / `day` / `month`) or `invalid_range` (`from` or `to` is not a parseable date, or `from` is not strictly earlier than `to`).",
            },
            { 404: "Not found — `skill_not_found`: no such skill, or it is private and not visible to this caller." },
          ),
        },
      },
    },
  };
}
