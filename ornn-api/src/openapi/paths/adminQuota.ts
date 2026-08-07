/**
 * Admin quota administration and redemption codes (#1214).
 *
 * Nine operator-only operations across two collaborating domains:
 *
 *   - **Quota** (`/admin/quota/*`) — inspect what non-admin users have
 *     spent this calendar month, read one user's month-by-month history,
 *     and top a user (or 500 users) up with a direct grant. Every grant
 *     appends a row to an audit trail that is itself readable here.
 *   - **Redemption codes** (`/admin/redemption-codes/*`) — the *deferred*
 *     form of the same grant. Instead of crediting a known `userId`, an
 *     admin mints a single-use code carrying a bundle of per-surface
 *     grants and hands it out; whoever redeems it at
 *     `POST /api/v1/me/redemption-codes/redeem` credits themselves.
 *     Because minting is a grant with the recipient left blank, it sits
 *     behind the same permission as a direct grant.
 *
 * The bucket model these operations manipulate is defined in
 * `domains/quota/types.ts`: one bucket per (`userId`, `surface`,
 * `monthMarker`), where `remaining = defaultAllotment + adminGrant −
 * used`. Buckets are **calendar-month, UTC, no carry-over** — a grant
 * applied on the 30th evaporates at the rollover a day later. Every
 * write here therefore targets the *current* month and only the current
 * month; there is no API for pre-funding a future month.
 *
 * Only two surfaces are grantable: `playground` and `skillGen`. The
 * assistant surface (#970) is metered and charged like the others but is
 * neither admin-grantable nor redeemable in v1, so it is absent from
 * every enum in this module. That list comes from `SURFACES`, which is
 * imported rather than transcribed so the spec cannot drift from the
 * runtime enum.
 *
 * Schema provenance: the mint request body is generated from
 * `mintCodeSchema` — the same Zod schema `validateBody` runs — and then
 * decorated with per-field prose. Everything else is hand-written JSON
 * Schema, because it has no Zod source at all: the two grant bodies are
 * module-private consts inside `domains/admin/quota/routes.ts`, and every
 * response payload in this domain is projected inline by its handler off
 * TypeScript interfaces (`QuotaGrantAuditDoc`, `RedemptionCodeDoc`, the
 * `serializeCode()` mapper) with no schema behind it.
 *
 * @module openapi/paths/adminQuota
 */

import {
  bearerAuth,
  jsonBody,
  jsonResponse,
  pathParam,
  problemResponses,
  queryParam,
  toSchema,
  type JsonSchema,
  type PathMap,
} from "../helpers";
import { QUOTA_ADMIN_PERMISSION, SURFACES } from "../../domains/quota/types";
import { mintCodeSchema, REDEMPTION_CODE_STATUSES } from "../../domains/redemption-codes/types";

// ---------------------------------------------------------------------------
// Shared prose
// ---------------------------------------------------------------------------

/**
 * Appended to every description in this module. All nine operations are
 * gated by the identical `requirePermission(QUOTA_ADMIN_PERMISSION)`
 * middleware, so the sentence is written once and the scope string is
 * imported rather than typed out — the enum and the docs cannot drift.
 */
const SCOPE_NOTE =
  `Operator-only: the caller's NyxID identity token must carry the \`${QUOTA_ADMIN_PERMISSION}\` ` +
  "permission. A token without it answers `403 forbidden`, and no token at all answers " +
  "`401 auth_missing`. Check `permissions` on `GET /api/v1/me` before attempting any operation here.";

/** Surfaces a grant or a redemption code may target, straight from the runtime enum. */
const GRANTABLE_SURFACES: readonly string[] = [...SURFACES];

// ---------------------------------------------------------------------------
// Local schema helpers
// ---------------------------------------------------------------------------

/**
 * Overlay per-field documentation onto a generated JSON Schema.
 *
 * Constraints (`minItems`, `maximum`, `format`, …) stay owned by the Zod
 * schema the handler actually validates against; only the prose is added
 * here. Used for the mint body so the published contract carries both
 * the real bounds and an explanation of what each field means.
 */
function withFieldDocs(schema: JsonSchema, docs: Record<string, JsonSchema>): JsonSchema {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const merged: Record<string, JsonSchema> = { ...properties };
  for (const [field, extra] of Object.entries(docs)) {
    merged[field] = { ...(properties[field] ?? {}), ...extra };
  }
  return { ...schema, properties: merged };
}

// ---------------------------------------------------------------------------
// Quota payload schemas
// ---------------------------------------------------------------------------

const surfaceEnumSchema: JsonSchema = {
  type: "string",
  enum: GRANTABLE_SURFACES,
  description:
    "Metered surface the row applies to. `playground` meters `POST /api/v1/playground/chat`; `skillGen` meters `POST /api/v1/skills/generate` and its source/OpenAPI variants.",
};

const quotaUserRowSchema: JsonSchema = {
  type: "object",
  required: ["userId", "email", "displayName", "defaultAllotment", "adminGrant", "used", "remaining"],
  properties: {
    userId: {
      type: "string",
      description:
        "NyxID user id. This is the value to send as `userId` to `POST /api/v1/admin/quota/grant`, and the `{userId}` path segment of the lifetime endpoint.",
      examples: ["8f14e45fceea167a5a36dedd4bea2543"],
    },
    email: {
      type: "string",
      description:
        "Last-known email from the user directory mirror, which is refreshed opportunistically on each authenticated request. Always non-empty here: the directory query behind this listing skips users whose mirrored email is blank, so such users never surface in `items` at all — reach their buckets through `GET /api/v1/admin/quota/users/{userId}/lifetime` if you already know the id.",
      examples: ["ada@example.com"],
    },
    displayName: {
      type: "string",
      description: "Last-known human label (token `name` claim, falling back to email, then to the user id).",
      examples: ["Ada Lovelace"],
    },
    defaultAllotment: {
      type: "integer",
      description:
        "The *effective* platform default for this month, i.e. `max(the default snapshotted when the bucket was first touched, the default currently configured in platform settings)`. Raising the platform default hands existing buckets the headroom immediately; lowering it never retroactively shrinks a live bucket.",
      examples: [100],
    },
    adminGrant: {
      type: "integer",
      description:
        "Credits added on top of the default this month by direct grants and by redemptions. This is the only component an operator can move; it resets to 0 at the UTC month rollover.",
      examples: [50],
    },
    used: {
      type: "integer",
      description:
        "Units consumed this month, including in-flight reservations. A unit is taken *before* the LLM call and refunded if the run ends in a system error or client abort, so this number can go down as well as up.",
      examples: [122],
    },
    remaining: {
      type: "integer",
      description:
        "`max(0, defaultAllotment + adminGrant − used)`. When this hits 0 the user's next call to that surface is rejected with `429`; grant them credit to unblock without waiting for the rollover.",
      examples: [28],
    },
  },
};

const quotaUsersPageSchema: JsonSchema = {
  type: "object",
  required: ["items", "page", "pageSize", "total", "totalPages", "monthMarker", "monthStart", "monthEnd"],
  properties: {
    items: {
      type: "array",
      items: quotaUserRowSchema,
      description:
        "One row per non-admin user on this page, ordered by most-recently-seen first. Users holding the admin permission are filtered out entirely because they bypass quota and have no meaningful bucket.",
    },
    page: { type: "integer", description: "The 1-based page number that was served.", examples: [1] },
    pageSize: { type: "integer", description: "The page size actually applied after clamping into `[1, 100]`.", examples: [20] },
    total: {
      type: "integer",
      description:
        "Rows in the candidate pool this request fetched, after removing admins — **not** the platform-wide user count. The pool is capped at `pageSize × 5` directory rows, so `total` is a lower bound and `totalPages` never exceeds 5. Treat this listing as a recency-ordered typeahead, not as an exhaustive user export.",
      examples: [43],
    },
    totalPages: {
      type: "integer",
      description: "`ceil(total / pageSize)`, floored at 1. Bounded by the pool cap described on `total`; asking for a page beyond it returns an empty `items`.",
      examples: [3],
    },
    monthMarker: {
      type: "string",
      description: "The bucket month these figures belong to, as `YYYY-MM` in UTC. Always the current month — this endpoint has no historical mode; use the lifetime endpoint for that.",
      examples: ["2026-08"],
    },
    monthStart: {
      type: "string",
      format: "date-time",
      description: "Inclusive start of the bucket month (ISO-8601, UTC midnight on the 1st).",
      examples: ["2026-08-01T00:00:00.000Z"],
    },
    monthEnd: {
      type: "string",
      format: "date-time",
      description: "Exclusive end of the bucket month — equivalently, the instant every bucket in this response is abandoned and the next month's counters start from zero.",
      examples: ["2026-09-01T00:00:00.000Z"],
    },
  },
};

const lifetimeBucketSchema: JsonSchema = {
  type: "object",
  required: ["monthMarker", "monthStart", "monthEnd", "used", "defaultAllotment", "adminGrant", "usedByModel"],
  properties: {
    monthMarker: { type: "string", description: "Bucket month as `YYYY-MM` in UTC.", examples: ["2026-07"] },
    monthStart: { type: "string", format: "date-time", description: "Inclusive start of the month (ISO-8601, UTC)." },
    monthEnd: { type: "string", format: "date-time", description: "Exclusive end of the month (ISO-8601, UTC)." },
    used: { type: "integer", description: "Units consumed in that month. For the current month this includes in-flight reservations.", examples: [37] },
    defaultAllotment: {
      type: "integer",
      description:
        "The default snapshotted into this bucket at first touch. Unlike the current-month listing, historical rows are **not** re-maxed against today's platform default — they report what was stored.",
      examples: [100],
    },
    adminGrant: { type: "integer", description: "Credits granted into that month by admins or redemptions.", examples: [50] },
    usedByModel: {
      type: "object",
      additionalProperties: { type: "integer" },
      description:
        "Per-model breakdown of `used` for chargeable runs, as `{ modelId: count }`. Keys are model ids with `.` and `$` replaced by `_` (MongoDB path restriction), and runs whose model could not be determined are tallied under `__unknown__`. `{}` for months recorded before per-model tallying, and the sum of the values may be lower than `used` because reservations are counted at reserve time but tallied only on a chargeable outcome.",
      examples: [{ "claude-sonnet-4-6": 30, "gpt-5_2": 7 }],
    },
  },
};

const lifetimeSchema: JsonSchema = {
  type: "object",
  required: ["items", "currentMonth"],
  properties: {
    items: {
      type: "array",
      items: lifetimeBucketSchema,
      description:
        "Every month this user has a bucket for on the requested surface, oldest first. Months in which the user made no call have no bucket and are simply absent — the series is sparse, so do not index it positionally. Empty for an unknown or never-active user.",
    },
    currentMonth: {
      type: "string",
      description:
        "The server's current `YYYY-MM` marker in UTC. Compare against the last `items[].monthMarker` to tell whether the tail row is the live bucket (still moving) or a closed historical one.",
      examples: ["2026-08"],
    },
  },
};

const grantResultSchema: JsonSchema = {
  type: "object",
  required: ["auditId", "applied", "monthMarker", "newAdminGrant"],
  properties: {
    auditId: {
      type: "string",
      description:
        "Id of the audit row this grant appended, a server-generated UUID. Look it up as `_id` in `GET /api/v1/admin/quota/grants` — that is the only way to confirm, after a lost response, whether a grant actually landed.",
      examples: ["a3f1c2e4-9d4b-4e3f-90ab-42c9665f1c2a"],
    },
    applied: { type: "integer", enum: [1], description: "Always `1`. Present so the single-grant and bulk-grant responses can be read by the same client code." },
    monthMarker: {
      type: "string",
      description: "The bucket month the credit landed in, as `YYYY-MM` in UTC. Always the current month; the credit disappears at the rollover.",
      examples: ["2026-08"],
    },
    newAdminGrant: {
      type: "integer",
      description:
        "The target's total `adminGrant` for that month *after* this increment — not the amount granted. Compare against the value you expected to detect a duplicate submission.",
      examples: [250],
    },
  },
};

const bulkGrantRowSchema: JsonSchema = {
  type: "object",
  required: ["userId", "ok"],
  properties: {
    userId: { type: "string", description: "The target user id this row reports on.", examples: ["8f14e45fceea167a5a36dedd4bea2543"] },
    ok: { type: "boolean", description: "Whether the credit landed for this user. Rows are independent — a `false` row does not roll back the `true` rows before it." },
    auditId: { type: "string", description: "Audit row id (a server-generated UUID), present only when `ok` is `true`.", examples: ["a3f1c2e4-9d4b-4e3f-90ab-42c9665f1c2a"] },
    error: {
      type: "string",
      description:
        "Failure message, present only when `ok` is `false`. Free-form and intended for an operator to read — do not branch on its text. These are infrastructure failures (the bucket write or the audit insert did not go through), never input problems: `surface` and `amount` are single values shared by the whole batch and the body is validated before any row is attempted, so bad input rejects the entire call with a `400` rather than producing failed rows.",
    },
  },
};

const bulkGrantResultSchema: JsonSchema = {
  type: "object",
  required: ["applied", "requested", "monthMarker", "results"],
  properties: {
    applied: { type: "integer", description: "How many rows succeeded. Strictly less than `requested` on a partial failure — which is still reported as `200`.", examples: [498] },
    requested: {
      type: "integer",
      description:
        "How many *distinct* user ids were processed. The server de-duplicates `userIds` before granting, so this can be lower than the array length you sent; a duplicated id is credited once, not twice.",
      examples: [500],
    },
    monthMarker: { type: "string", description: "Bucket month every credit landed in, as `YYYY-MM` in UTC.", examples: ["2026-08"] },
    results: {
      type: "array",
      items: bulkGrantRowSchema,
      description: "One row per distinct user id, in submission order. Always inspect this — a `200` does not mean every row succeeded.",
    },
  },
};

const grantAuditRowSchema: JsonSchema = {
  type: "object",
  required: ["_id", "adminUserId", "adminEmail", "adminDisplayName", "targetUserId", "surface", "amount", "monthMarker", "createdAt"],
  properties: {
    _id: {
      type: "string",
      description:
        "Audit row id — the value returned as `auditId` by the grant endpoints. Note the underscore: this document is projected straight out of MongoDB, so unlike the rest of the API the identifier field is `_id`, not `id`. It is a UUID generated by the server, **not** an ObjectId hex — do not confuse it with `code.id` on the redemption-code operations, which is one.",
      examples: ["a3f1c2e4-9d4b-4e3f-90ab-42c9665f1c2a"],
    },
    adminUserId: {
      type: "string",
      description:
        "Who issued the grant. For rows generated by a redemption this equals `targetUserId`, because redeeming credits the redeemer to themselves — see `note`.",
    },
    adminEmail: { type: "string", description: "Issuer's email, snapshotted at grant time so rendering the audit needs no NyxID round-trip." },
    adminDisplayName: { type: "string", description: "Issuer's display name, snapshotted at grant time." },
    targetUserId: { type: "string", description: "Who received the credit." },
    surface: surfaceEnumSchema,
    amount: { type: "integer", description: "Credits added by this grant (always positive — negative grants are rejected).", examples: [200] },
    note: {
      type: "string",
      description:
        "Optional free-text reason supplied by the issuer. Redemption-generated rows carry a server-written note of the form `Redeemed code ABCD****`, where only the first four characters of the code are revealed — that prefix is how you tell a redemption apart from a hand-issued grant.",
      examples: ["Compensating for the 2026-08-03 outage"],
    },
    monthMarker: { type: "string", description: "Bucket month the credit landed in, as `YYYY-MM` in UTC.", examples: ["2026-08"] },
    createdAt: { type: "string", format: "date-time", description: "When the grant was issued (ISO-8601, UTC). Rows are returned newest-first by this field." },
  },
};

const grantAuditPageSchema: JsonSchema = {
  type: "object",
  required: ["items", "total", "page", "pageSize", "totalPages"],
  properties: {
    items: { type: "array", items: grantAuditRowSchema, description: "Audit rows for this page, newest first." },
    total: { type: "integer", description: "Total rows matching the filters across all pages. This one *is* an exact count.", examples: [1284] },
    page: { type: "integer", description: "The page actually served, after clamping into `[1, 10000]`.", examples: [1] },
    pageSize: { type: "integer", description: "The page size actually applied, after clamping into `[1, 200]`.", examples: [50] },
    totalPages: { type: "integer", description: "`ceil(total / pageSize)`, floored at 1 — so an empty audit trail still reports `1`.", examples: [26] },
  },
};

// ---------------------------------------------------------------------------
// Redemption-code payload schemas
// ---------------------------------------------------------------------------

const actorSchema: JsonSchema = {
  type: "object",
  required: ["userId", "email", "displayName"],
  properties: {
    userId: { type: "string", description: "NyxID user id of the actor." },
    email: { type: "string", description: "Actor's email, snapshotted at the moment they touched the code." },
    displayName: { type: "string", description: "Actor's display name, snapshotted at the moment they touched the code." },
  },
};

const codeGrantEntrySchema: JsonSchema = {
  type: "object",
  required: ["surface", "amount"],
  properties: {
    surface: surfaceEnumSchema,
    amount: { type: "integer", minimum: 1, maximum: 100000, description: "Credits this entry adds to the redeemer's current-month bucket for that surface.", examples: [200] },
  },
};

const redemptionCodeSchema: JsonSchema = {
  type: "object",
  required: [
    "id",
    "code",
    "grants",
    "note",
    "status",
    "createdAt",
    "createdBy",
    "expiresAt",
    "redeemedAt",
    "redeemedBy",
    "invalidatedAt",
    "invalidatedBy",
  ],
  properties: {
    id: {
      type: "string",
      description: "Code document id (MongoDB ObjectId hex). Use it as the `{id}` path segment for the detail and invalidate operations.",
      examples: ["665f1c2a9d4b7e3f10ab42c9"],
    },
    code: {
      type: "string",
      description:
        "The redemption token itself, in canonical upper case. Sixteen characters over the ambiguity-free alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0`, `O`, `1`, `I`, `L`), so it survives being read aloud or retyped from a screenshot. It is returned in full by mint, list, and detail alike — there is no one-time reveal, so treat any log or UI that renders this field as handling a bearer secret.",
      examples: ["K7M2QX9RTVBN4PZ3"],
    },
    grants: {
      type: "array",
      items: codeGrantEntrySchema,
      description: "The bundle this code applies on redemption — at most one entry per surface, never empty.",
    },
    note: { type: ["string", "null"], description: "Free-text label supplied at mint time, or `null`. Also matched (case-insensitively, as a substring) by the `search` filter on the list endpoint.", examples: ["Launch promo cohort"] },
    status: {
      type: "string",
      enum: [...REDEMPTION_CODE_STATUSES],
      description:
        "Lifecycle state. `active` — mintable value still on the table. `redeemed` — consumed by someone; terminal. `invalidated` — retired by an admin before anyone redeemed it; terminal. Note that expiry is **not** a status: an expired code stays `active` and is rejected only at redemption time, so filter on `expiresAt` yourself when hunting dead inventory.",
    },
    createdAt: { type: "string", format: "date-time", description: "When the code was minted (ISO-8601, UTC). Listings are ordered newest-first by this field." },
    createdBy: { ...actorSchema, description: "The admin who minted the code, snapshotted at mint time." },
    expiresAt: {
      type: "string",
      format: "date-time",
      description: "After this instant the code can no longer be redeemed (`410 redemption_code_expired`). Set at mint time and immutable thereafter.",
      examples: ["2026-12-31T23:59:59.000Z"],
    },
    redeemedAt: { type: ["string", "null"], format: "date-time", description: "When the code was consumed, or `null` while `status` is not `redeemed`." },
    redeemedBy: { oneOf: [actorSchema, { type: "null" }], description: "Who consumed the code, or `null` while it has not been redeemed." },
    invalidatedAt: { type: ["string", "null"], format: "date-time", description: "When an admin retired the code, or `null`." },
    invalidatedBy: { oneOf: [actorSchema, { type: "null" }], description: "The admin who retired the code, or `null`." },
  },
};

const codeEnvelopeSchema: JsonSchema = {
  type: "object",
  required: ["code"],
  properties: {
    code: { ...redemptionCodeSchema, description: "The full code document. Every single-code operation in this domain wraps its result under this key." },
  },
};

const codeListSchema: JsonSchema = {
  type: "object",
  required: ["items", "total", "page", "pageSize", "totalPages"],
  properties: {
    items: { type: "array", items: redemptionCodeSchema, description: "Codes on this page, newest-minted first. Includes the plaintext `code` of every row." },
    total: { type: "integer", description: "Total codes matching the filters across all pages.", examples: [312] },
    page: { type: "integer", description: "The page that was served. Not clamped from above — a page past the end returns an empty `items`.", examples: [1] },
    pageSize: { type: "integer", description: "The page size actually applied, after clamping into `[1, 100]`.", examples: [20] },
    totalPages: { type: "integer", description: "`ceil(total / pageSize)`, floored at 1.", examples: [16] },
  },
};

const CODE_EXAMPLE = {
  id: "665f1c2a9d4b7e3f10ab42c9",
  code: "K7M2QX9RTVBN4PZ3",
  grants: [
    { surface: "playground", amount: 200 },
    { surface: "skillGen", amount: 25 },
  ],
  note: "Launch promo cohort",
  status: "active",
  createdAt: "2026-08-01T12:00:00.000Z",
  createdBy: { userId: "8f14e45fceea167a5a36dedd4bea2543", email: "ops@example.com", displayName: "Ops Team" },
  expiresAt: "2026-12-31T23:59:59.000Z",
  redeemedAt: null,
  redeemedBy: null,
  invalidatedAt: null,
  invalidatedBy: null,
} as const;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const grantBodySchema: JsonSchema = {
  type: "object",
  required: ["userId", "surface", "amount"],
  properties: {
    userId: {
      type: "string",
      minLength: 1,
      description:
        "NyxID user id of the recipient — the `userId` from `GET /api/v1/admin/quota/users` or `GET /api/v1/users/search`, never an email. It is **not** validated against the directory: a typo silently creates an orphan bucket nobody can spend, so resolve the id first and check the audit trail afterwards.",
      examples: ["8f14e45fceea167a5a36dedd4bea2543"],
    },
    surface: {
      type: "string",
      enum: GRANTABLE_SURFACES,
      description:
        "Which bucket to credit. Only these two surfaces are grantable; `assistant` is metered but not admin-grantable in v1 and is rejected as a validation error.",
      examples: ["playground"],
    },
    amount: {
      type: "integer",
      minimum: 1,
      maximum: 100000,
      description: "Credits to add. Must be a positive integer no greater than 100000. Zero and negative amounts are rejected — there is no API for clawing credit back.",
      examples: [200],
    },
    note: {
      type: "string",
      maxLength: 500,
      description: "Optional reason, up to 500 characters, stored verbatim on the audit row. Write something an auditor reading it in six months can act on.",
      examples: ["Compensating for the 2026-08-03 outage"],
    },
  },
};

const bulkGrantBodySchema: JsonSchema = {
  type: "object",
  required: ["userIds", "surface", "amount"],
  properties: {
    userIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      maxItems: 500,
      description:
        "Recipients, 1–500 NyxID user ids. Duplicates are collapsed server-side before any credit is applied, so a repeated id is credited once. Ids are not validated against the directory. Batch larger cohorts across several calls — each call is one round of sequential grants.",
      examples: [["8f14e45fceea167a5a36dedd4bea2543", "c4ca4238a0b923820dcc509a6f75849b"]],
    },
    surface: {
      type: "string",
      enum: GRANTABLE_SURFACES,
      description: "Which bucket to credit for every recipient. One surface per call — crediting both surfaces takes two calls.",
      examples: ["playground"],
    },
    amount: {
      type: "integer",
      minimum: 1,
      maximum: 100000,
      description: "Credits to add to each recipient. Positive integer, at most 100000. The same amount goes to every id; there is no per-recipient amount.",
      examples: [50],
    },
    note: {
      type: "string",
      maxLength: 500,
      description: "Optional reason, up to 500 characters, copied onto every audit row this call appends.",
      examples: ["August beta cohort top-up"],
    },
  },
};

/**
 * Generated from `mintCodeSchema` (the exact schema `validateBody` runs
 * on this route) and then annotated. Bounds, the `date-time` format, and
 * the `maxItems` ceiling therefore track the runtime validator; only the
 * prose is authored here. The duplicate-surface `.refine()` on `grants`
 * has no JSON Schema equivalent and is documented in the field text.
 */
const mintBodySchema: JsonSchema = withFieldDocs(toSchema(mintCodeSchema, "input"), {
  grants: {
    description:
      "The grant bundle the code applies on redemption. One to two entries, at most one per surface — a duplicate surface is rejected with `400`, since the redeem path applies each entry independently.",
    items: codeGrantEntrySchema,
  },
  note: {
    description:
      "Optional label for the code, up to 500 characters. Visible to admins in the listing and searchable there as a case-insensitive substring; it is never shown to the person redeeming the code.",
    examples: ["Launch promo cohort"],
  },
  expiresAt: {
    description:
      "When the code stops being redeemable, as an ISO-8601 UTC timestamp. Must be strictly in the future at mint time. Independent of the credits themselves: a code redeemed on the last day of a month yields credit that expires hours later at the month rollover, so pick an expiry that lands well inside the month you want the credit spent in.",
    examples: ["2026-12-31T23:59:59.000Z"],
  },
});

// ---------------------------------------------------------------------------
// Shared parameters
// ---------------------------------------------------------------------------

function surfaceParam(purpose: string): Record<string, unknown> {
  return queryParam(
    "surface",
    `${purpose} Optional — defaults to \`playground\` when omitted. Only the two grantable surfaces are accepted; anything else, including the metered-but-not-grantable \`assistant\` surface, is rejected with \`400 invalid_surface\`.`,
    { type: "string", enum: GRANTABLE_SURFACES, default: "playground", examples: ["playground"] },
  );
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function adminQuotaPaths(prefix: string): PathMap {
  return {
    [`${prefix}/admin/quota/users`]: {
      get: {
        summary: "List per-user quota for the current month",
        description:
          "Browse what ordinary users have spent on one metered surface this calendar month, one row per user, with the default allotment, admin-granted top-ups, consumption, and remaining balance already reconciled. This is the operator's entry point before issuing a grant: find the user, read `remaining`, then call `POST /api/v1/admin/quota/grant` with the `userId` from the row. " +
          "Only the current UTC month is reported — there is no date range parameter; use `GET /api/v1/admin/quota/users/{userId}/lifetime` for history. Users holding the admin permission are excluded from the result entirely, because admins bypass quota and never accumulate a bucket. " +
          "Read the pagination semantics carefully, because they are not the usual ones. The handler first pulls a recency-ordered candidate pool of at most `pageSize × 5` directory rows matching `q`, removes admins, and then slices the requested page out of what is left — so `total` describes that pool and not the platform, `totalPages` never exceeds 5, and requesting a later page returns an empty `items` rather than an error. Narrow with `q` instead of paging deeply. " +
          "All three pagination-ish inputs are silently clamped rather than validated, so the only `400` this operation can produce comes from `surface`. " +
          SCOPE_NOTE,
        operationId: "adminListQuotaUsers",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          surfaceParam("Which metered surface's buckets to report."),
          queryParam(
            "q",
            "Case-insensitive **email prefix** filter (not a full-text search, and it does not match display names or user ids). Regex metacharacters are escaped, so a literal `+` or `.` in an address is safe to send. Omit or send an empty string to get the most-recently-seen users instead.",
            { type: "string", default: "", examples: ["ada@"] },
          ),
          queryParam(
            "page",
            "1-based page number within the candidate pool. Defaults to `1`; anything below 1 or unparseable is silently coerced to `1` rather than rejected. Because the pool is capped at five pages' worth of rows, values above 5 return an empty page.",
            { type: "integer", minimum: 1, default: 1, examples: [1] },
          ),
          queryParam(
            "pageSize",
            "Rows per page. Defaults to `20` and is clamped into `[1, 100]`. It also scales the candidate pool, which is fetched as `pageSize × 5` rows — raising it widens what is searchable as well as what is returned.",
            { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] },
          ),
        ],
        responses: {
          ...jsonResponse(quotaUsersPageSchema, "One page of current-month quota rows for non-admin users.", {
            example: {
              items: [
                {
                  userId: "8f14e45fceea167a5a36dedd4bea2543",
                  email: "ada@example.com",
                  displayName: "Ada Lovelace",
                  defaultAllotment: 100,
                  adminGrant: 50,
                  used: 122,
                  remaining: 28,
                },
              ],
              page: 1,
              pageSize: 20,
              total: 43,
              totalPages: 3,
              monthMarker: "2026-08",
              monthStart: "2026-08-01T00:00:00.000Z",
              monthEnd: "2026-09-01T00:00:00.000Z",
            },
          }),
          ...problemResponses(
            {
              400: "Bad request (`invalid_surface`) — `surface` was present but is not one of `playground` or `skillGen`. The pagination parameters cannot produce a 400; they are clamped.",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/quota/users/{userId}/lifetime`]: {
      get: {
        summary: "Get one user's month-by-month quota history",
        description:
          "Return every monthly bucket ever recorded for a single user on one metered surface, oldest first, including a per-model breakdown of what each month's consumption was spent on. Use it to answer \"is this user's request for more credit consistent with how they have actually been using the platform\" before granting, or to reconstruct spend after the fact. " +
          "The series is sparse: a month in which the user made no call has no bucket and simply does not appear, so iterate on `monthMarker` rather than assuming contiguous months. The final entry is the live current-month bucket only when its `monthMarker` equals the `currentMonth` field returned alongside the items — otherwise the user has not touched this surface yet this month. " +
          "An unknown, deleted, or never-active user is **not** an error: the response is `200` with `items: []`. There is consequently no way to distinguish \"no such user\" from \"user with no history\" here; resolve the id against `GET /api/v1/admin/quota/users` first if that distinction matters. " +
          SCOPE_NOTE,
        operationId: "adminGetUserQuotaLifetime",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "userId",
            "NyxID user id whose history to read — the opaque `sub` claim from the identity token, as surfaced by `GET /api/v1/admin/quota/users` or `GET /api/v1/users/search`. Not an email address. Unknown ids return an empty series rather than a 404.",
            { type: "string", minLength: 1 },
            "8f14e45fceea167a5a36dedd4bea2543",
          ),
          surfaceParam("Which metered surface's history to return. One surface per call — reading both takes two calls."),
        ],
        responses: {
          ...jsonResponse(lifetimeSchema, "The user's full bucket history for the requested surface, oldest month first.", {
            example: {
              items: [
                {
                  monthMarker: "2026-07",
                  monthStart: "2026-07-01T00:00:00.000Z",
                  monthEnd: "2026-08-01T00:00:00.000Z",
                  used: 37,
                  defaultAllotment: 100,
                  adminGrant: 0,
                  usedByModel: { "claude-sonnet-4-6": 30, "gpt-5_2": 7 },
                },
                {
                  monthMarker: "2026-08",
                  monthStart: "2026-08-01T00:00:00.000Z",
                  monthEnd: "2026-09-01T00:00:00.000Z",
                  used: 122,
                  defaultAllotment: 100,
                  adminGrant: 50,
                  usedByModel: { "claude-sonnet-4-6": 122 },
                },
              ],
              currentMonth: "2026-08",
            },
          }),
          ...problemResponses(
            {
              400: "Bad request — `surface` is not one of `playground` or `skillGen` (`invalid_surface`), or the `{userId}` segment resolved to an empty string (`invalid_user_id`).",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/quota/grant`]: {
      post: {
        summary: "Grant quota credit to one user",
        description:
          "Add credit to a single user's **current-month** bucket for one surface, and append a row to the grant audit trail. The amount is added to that bucket's `adminGrant` component, which unblocks the user immediately — they do not need to re-authenticate and nothing is queued. " +
          "Three properties matter before you call this. It is **additive, not absolute**: sending `amount: 200` twice leaves the user with 400 extra credits, so this operation is emphatically not idempotent and must not be blind-retried on a timeout — reconcile against `GET /api/v1/admin/quota/grants` first, matching on the `auditId` from the response. It targets **only the current UTC month**, and the credit is abandoned at the rollover, so granting late in a month gives the recipient very little time to spend it. And the recipient id is **not verified**: a mistyped `userId` succeeds and creates a bucket nobody owns. " +
          "Succeeds with `200`, not `201` — no addressable resource is created, and the audit row is retrievable only through the listing. To defer the grant to a recipient you cannot name up front, mint a redemption code instead. " +
          SCOPE_NOTE,
        operationId: "adminGrantQuota",
        tags: ["Admin"],
        security: bearerAuth(),
        requestBody: jsonBody(grantBodySchema, "The recipient, the surface to credit, the number of credits, and an optional audit note.", {
          example: {
            userId: "8f14e45fceea167a5a36dedd4bea2543",
            surface: "playground",
            amount: 200,
            note: "Compensating for the 2026-08-03 outage",
          },
        }),
        responses: {
          ...jsonResponse(grantResultSchema, "Credit applied to the target's current-month bucket and recorded in the audit trail.", {
            example: { auditId: "a3f1c2e4-9d4b-4e3f-90ab-42c9665f1c2a", applied: 1, monthMarker: "2026-08", newAdminGrant: 250 },
          }),
          ...problemResponses(
            {
              400: "Bad request. Either the body failed schema validation (`INVALID_GRANT_BODY` — missing `userId`, unknown `surface`, non-integer or out-of-range `amount`, `note` over 500 characters; `detail` names the field), or the grant itself was refused (`invalid_grant_amount`). Note that the handler wraps **every** failure raised while applying the grant into this second 400, including a datastore outage — so a `400 invalid_grant_amount` whose `detail` does not mention the amount should be read as an internal failure and retried after checking the audit trail, not as a malformed request.",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/quota/grant/bulk`]: {
      post: {
        summary: "Grant the same quota credit to many users",
        description:
          "Apply one surface/amount grant to up to 500 users in a single call — the cohort form of `POST /api/v1/admin/quota/grant`, with identical semantics per recipient: additive, current-month only, unverified ids, and an audit row each. Duplicate ids in `userIds` are collapsed before anything is applied, so `requested` in the response is the distinct count and may be smaller than the array you sent. " +
          "This operation is **partially fallible and still answers `200`**. Recipients are processed sequentially and independently; a failure on one does not abort the run or roll back the ones already applied. Always read `applied` against `requested` and walk `results[]` for `ok: false` rows — treating a `200` as \"everything landed\" is the mistake this shape is designed to prevent. Re-driving only the failed ids is safe; re-sending the whole batch double-credits everyone who already succeeded. " +
          "One surface per call. Crediting both `playground` and `skillGen` for the same cohort is two calls, and there is no per-recipient amount — split the cohort if amounts differ. " +
          SCOPE_NOTE,
        operationId: "adminBulkGrantQuota",
        tags: ["Admin"],
        security: bearerAuth(),
        requestBody: jsonBody(bulkGrantBodySchema, "The recipient cohort, the surface to credit, the per-recipient amount, and an optional audit note copied onto every row.", {
          example: {
            userIds: ["8f14e45fceea167a5a36dedd4bea2543", "c4ca4238a0b923820dcc509a6f75849b"],
            surface: "playground",
            amount: 50,
            note: "August beta cohort top-up",
          },
        }),
        responses: {
          ...jsonResponse(bulkGrantResultSchema, "The batch ran to completion. Per-recipient outcomes are in `results` — success is not implied by this status.", {
            example: {
              applied: 1,
              requested: 2,
              monthMarker: "2026-08",
              results: [
                { userId: "8f14e45fceea167a5a36dedd4bea2543", ok: true, auditId: "a3f1c2e4-9d4b-4e3f-90ab-42c9665f1c2a" },
                { userId: "c4ca4238a0b923820dcc509a6f75849b", ok: false, error: "MongoServerError: connection timed out" },
              ],
            },
          }),
          ...problemResponses(
            {
              400: "Bad request (`INVALID_BULK_GRANT_BODY`) — the body failed schema validation: `userIds` empty, longer than 500, or containing an empty string; unknown `surface`; non-integer, non-positive, or over-100000 `amount`; `note` longer than 500 characters. `detail` names the offending field. Per-recipient failures are **not** reported here — they come back as `ok: false` rows inside a `200`.",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/quota/grants`]: {
      get: {
        summary: "List the quota-grant audit trail",
        description:
          "Offset-paginated, newest-first log of every credit ever added to any bucket, with the issuer and the recipient both snapshotted on the row so rendering it needs no identity lookups. This is the authoritative record for two questions an operator asks constantly: \"did my grant actually land\" (filter by `userId` and match the `auditId` the grant returned) and \"where did this user's balance come from\" (the sum of `amount` for a `userId` in one `monthMarker` is exactly that month's `adminGrant`). " +
          "It is also the reconciliation step before retrying any grant, because the grant endpoints are additive and a blind retry double-credits. " +
          "Redemptions appear here too, as self-grants: `adminUserId` equals `targetUserId` and `note` reads `Redeemed code ABCD****`, revealing only the first four characters of the consumed code. Filter those out by comparing the two id fields if you want hand-issued grants alone. " +
          "Both pagination inputs are silently clamped rather than rejected, so this operation has no `400` at all — read `page` and `pageSize` back from the response instead of assuming your request was honoured. The `page` ceiling of 10000 is a deliberate guard against a huge offset driving an unbounded collection scan. " +
          SCOPE_NOTE,
        operationId: "adminListQuotaGrantAudit",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "userId",
            "Filter to grants **received** by this NyxID user id (exact match on the audit row's `targetUserId`). Omit for all recipients. An empty string is treated as omitted.",
            { type: "string", examples: ["8f14e45fceea167a5a36dedd4bea2543"] },
          ),
          queryParam(
            "adminUserId",
            "Filter to grants **issued** by this NyxID user id (exact match on `adminUserId`). Combine with `userId` to isolate one operator's grants to one recipient; on a redemption-generated row the two ids are equal.",
            { type: "string", examples: ["c4ca4238a0b923820dcc509a6f75849b"] },
          ),
          queryParam(
            "page",
            "1-based page number. Defaults to `1` and is clamped into `[1, 10000]` — out-of-range and unparseable values are coerced, never rejected.",
            { type: "integer", minimum: 1, maximum: 10000, default: 1, examples: [1] },
          ),
          queryParam(
            "pageSize",
            "Rows per page. Defaults to `50` and is clamped into `[1, 200]`. Note this differs from the other listings in this domain, which default to 20 and cap at 100.",
            { type: "integer", minimum: 1, maximum: 200, default: 50, examples: [50] },
          ),
        ],
        responses: {
          ...jsonResponse(grantAuditPageSchema, "One page of grant-audit rows, newest first.", {
            example: {
              items: [
                {
                  _id: "a3f1c2e4-9d4b-4e3f-90ab-42c9665f1c2a",
                  adminUserId: "c4ca4238a0b923820dcc509a6f75849b",
                  adminEmail: "ops@example.com",
                  adminDisplayName: "Ops Team",
                  targetUserId: "8f14e45fceea167a5a36dedd4bea2543",
                  surface: "playground",
                  amount: 200,
                  note: "Compensating for the 2026-08-03 outage",
                  monthMarker: "2026-08",
                  createdAt: "2026-08-04T09:14:22.118Z",
                },
              ],
              total: 1284,
              page: 1,
              pageSize: 50,
              totalPages: 26,
            },
          }),
          ...problemResponses(401, 403),
        },
      },
    },

    [`${prefix}/admin/redemption-codes`]: {
      post: {
        summary: "Mint a redemption code",
        description:
          "Create a single-use code carrying a bundle of per-surface quota grants, to hand to a recipient you cannot or do not want to name up front. It is the deferred twin of `POST /api/v1/admin/quota/grant`: whoever redeems it at `POST /api/v1/me/redemption-codes/redeem` credits their **own** current-month buckets, and the resulting grants land in the same audit trail as hand-issued ones (as self-grants noted `Redeemed code ABCD****`). Because minting is a grant with the recipient left blank, it requires the same permission. " +
          "A code is consumable exactly once **platform-wide**, not once per user — the first redeemer wins and everyone else gets a `409`. The generated token is returned in full in the response, and remains readable through the list and detail operations forever after; there is no one-time reveal, so anything that logs or renders this response is handling a bearer secret. " +
          "`expiresAt` bounds redeemability, not the credit. Credit granted by a redemption still expires at the UTC month rollover like any other grant, so a code redeemed on the 31st is nearly worthless — set an expiry that lands well inside the month you want the credit spent in, and say so when you hand the code out. " +
          "Succeeds with `200`, not `201`, and sets no `Location` header, even though it creates a resource. Retrying a request whose response you lost mints a **second, distinct** code rather than returning the first — search the listing by `note` before re-minting. " +
          SCOPE_NOTE,
        operationId: "adminMintRedemptionCode",
        tags: ["Admin"],
        security: bearerAuth(),
        requestBody: jsonBody(mintBodySchema, "The grant bundle the code will apply, an optional admin-facing label, and the instant the code stops being redeemable. Generated from `mintCodeSchema` in `domains/redemption-codes/types.ts`, which is the runtime validator.", {
          example: {
            grants: [
              { surface: "playground", amount: 200 },
              { surface: "skillGen", amount: 25 },
            ],
            note: "Launch promo cohort",
            expiresAt: "2026-12-31T23:59:59.000Z",
          },
        }),
        responses: {
          ...jsonResponse(codeEnvelopeSchema, "Code minted. The plaintext token is in `code.code`.", { example: { code: CODE_EXAMPLE } }),
          ...problemResponses(
            {
              400: "Bad request (`invalid_redemption_code_body`) — the body failed validation or the service refused it. Causes: `grants` empty or holding more than one entry for the same surface; an `amount` that is not a positive integer at most 100000; an unknown `surface`; `note` over 500 characters; `expiresAt` absent, not an ISO-8601 UTC timestamp, or not strictly in the future. `detail` names the field for schema failures.",
            },
            401,
            403,
            {
              500: "Internal error (`redemption_code_mint_failed`) — the datastore rejected the insert, or five consecutive generated tokens collided with existing codes. No code was created; retrying is safe.",
            },
          ),
        },
      },

      get: {
        summary: "List redemption codes",
        description:
          "Offset-paginated inventory of every code ever minted, newest first, with the plaintext token, grant bundle, lifecycle state, and the actors who created, redeemed, or retired each one. Use it to find a code to invalidate, to confirm whether a code you handed out has been used and by whom, or to recover the token from a mint response you lost. " +
          "Two filters, and they compose. `status` narrows to `active` / `redeemed` / `invalidated`; note that **expiry is not a status** — an expired code stays `active` and is refused only at redemption time, so to find dead inventory filter `status=active` and compare `expiresAt` against now yourself. `search` matches either a **prefix** of the code (case-insensitively — the value is upper-cased before matching, mirroring how codes are stored) or a **substring** of the admin note; the two are OR'd, so a partial token pasted from a support ticket and a campaign label both work. " +
          "`search` is the current parameter name; `q` is accepted as a legacy alias and is used only when `search` is absent. Prefer `search`. " +
          "`pageSize` is clamped into `[1, 100]` and `page` is floored at 1 but has no ceiling, so a large page simply returns an empty `items`. The only `400` this operation produces comes from an unrecognised `status`. " +
          SCOPE_NOTE,
        operationId: "adminListRedemptionCodes",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "status",
            "Lifecycle filter. Omit for all states. Unlike every other parameter here an unrecognised value is rejected rather than ignored. Remember that expiry is not a status — expired codes are still `active`.",
            { type: "string", enum: [...REDEMPTION_CODE_STATUSES], examples: ["active"] },
          ),
          queryParam(
            "search",
            "Matches a case-insensitive **prefix** of the code (the value is upper-cased first, since codes are stored canonical-uppercase) OR a case-insensitive **substring** of the admin `note`. Trimmed; an empty or whitespace-only value is treated as absent.",
            { type: "string", examples: ["K7M2"] },
          ),
          queryParam(
            "q",
            "Legacy alias for `search`, kept for older clients. Consulted **only** when `search` is absent — sending both silently ignores this one. New integrations should use `search`.",
            { type: "string", examples: ["Launch promo"] },
          ),
          queryParam(
            "page",
            "1-based page number. Defaults to `1`; values below 1 and unparseable values are coerced to `1`. There is no upper clamp — a page past the end returns an empty `items` rather than an error.",
            { type: "integer", minimum: 1, default: 1, examples: [1] },
          ),
          queryParam(
            "pageSize",
            "Codes per page. Defaults to `20` and is clamped into `[1, 100]`; out-of-range values are coerced, never rejected.",
            { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] },
          ),
        ],
        responses: {
          ...jsonResponse(codeListSchema, "One page of redemption codes, newest-minted first.", {
            example: { items: [CODE_EXAMPLE], total: 312, page: 1, pageSize: 20, totalPages: 16 },
          }),
          ...problemResponses(
            {
              400: "Bad request (`INVALID_STATUS`) — `status` was present but is not one of `active`, `redeemed`, `invalidated`. No other parameter on this operation can produce a 400; the rest are clamped or ignored.",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/redemption-codes/{id}`]: {
      get: {
        summary: "Get a redemption code by id",
        description:
          "Fetch one code's full record: the plaintext token, its grant bundle, its lifecycle state, and the actor snapshots for whoever minted, redeemed, or retired it. Addressed by the document id (`code.id`), **not** by the token string — there is no admin lookup-by-code endpoint, so resolve a token a user quoted you through `GET /api/v1/admin/redemption-codes?search=<prefix>` first, then come here with the `id`. " +
          "The natural use is confirming outcome before acting: check `status` and `redeemedBy` before telling a user their code was already used, and re-read after an invalidate to confirm the transition. Note again that expiry is not reflected in `status` — a code past `expiresAt` still reads `active` even though redemption will refuse it. " +
          SCOPE_NOTE,
        operationId: "adminGetRedemptionCode",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Code document id — the `id` field from the mint or list response, a 24-character MongoDB ObjectId hex string. This is not the redemption token itself; passing a token here returns `404`.",
            { type: "string", minLength: 1, examples: ["665f1c2a9d4b7e3f10ab42c9"] },
            "665f1c2a9d4b7e3f10ab42c9",
          ),
        ],
        responses: {
          ...jsonResponse(codeEnvelopeSchema, "The code document.", { example: { code: CODE_EXAMPLE } }),
          ...problemResponses(
            { 400: "Bad request (`invalid_redemption_code_id`) — the `{id}` segment resolved to an empty string." },
            401,
            403,
            {
              404: "Not found (`redemption_code_not_found`) — no code carries this id. Also what you get for a malformed id or for passing the redemption token instead of the document id.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/redemption-codes/{id}/invalidate`]: {
      post: {
        summary: "Invalidate an unredeemed redemption code",
        description:
          "Retire an `active` code so it can never be redeemed, moving it to the terminal `invalidated` state and stamping the acting admin onto the record. Use it when a code leaks, is sent to the wrong recipient, or a campaign is cancelled — it is the only way to take minted value off the table before it expires. " +
          "The transition is one-way and only from `active`. A code that has already been redeemed **cannot** be invalidated (`409`), because the credit is already spent into the redeemer's bucket; this operation never claws grants back, and there is no reverse operation to un-invalidate. It is also **not idempotent in its status codes**: the first call answers `200`, and a repeat on the same code answers `409 redemption_code_already_invalidated` even though the desired end state already holds — treat that specific 409 as success when reconciling a retry. " +
          "The request takes no body. On success the full updated document is returned, so there is no need to re-read it. " +
          SCOPE_NOTE,
        operationId: "adminInvalidateRedemptionCode",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Code document id — the `id` field from the mint or list response, a 24-character MongoDB ObjectId hex string, not the redemption token. Resolve a user-quoted token through the list endpoint's `search` filter first.",
            { type: "string", minLength: 1, examples: ["665f1c2a9d4b7e3f10ab42c9"] },
            "665f1c2a9d4b7e3f10ab42c9",
          ),
        ],
        responses: {
          ...jsonResponse(codeEnvelopeSchema, "The code is now `invalidated`. The returned document carries `invalidatedAt` and `invalidatedBy`.", {
            example: {
              code: {
                ...CODE_EXAMPLE,
                status: "invalidated",
                invalidatedAt: "2026-08-07T09:14:22.118Z",
                invalidatedBy: { userId: "c4ca4238a0b923820dcc509a6f75849b", email: "ops@example.com", displayName: "Ops Team" },
              },
            },
          }),
          ...problemResponses(
            { 400: "Bad request (`invalid_redemption_code_id`) — the `{id}` segment resolved to an empty string." },
            401,
            403,
            { 404: "Not found (`redemption_code_not_found`) — no code carries this id." },
            {
              409: "Conflict — the code is not in the `active` state. `redemption_code_already_redeemed`: someone consumed it, the credit is spent, and invalidation is impossible. `redemption_code_already_invalidated`: it was already retired — the end state you wanted already holds, so this is a safe outcome for a retried request.",
            },
            {
              500: "Internal error (`redemption_code_invalidate_failed`) — the state pivot failed for a reason other than the conflicts above (typically a datastore failure). The code's state is unchanged; re-read it with `GET /api/v1/admin/redemption-codes/{id}` before retrying.",
            },
          ),
        },
      },
    },
  };
}
