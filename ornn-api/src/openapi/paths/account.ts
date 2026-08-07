/**
 * Account domain — everything that describes *the caller* (#1214).
 *
 * Thirteen operations, all caller-scoped, all bearer-authenticated. An
 * agent integrating Ornn touches this domain in four situations:
 *
 *   1. **Identity bootstrap** — `GET /me` answers "who am I, and which
 *      permissions does my token carry", which decides whether the
 *      `/admin/*` surface is reachable at all. `GET /me/orgs` (+ the
 *      `GET /me/orgs/{orgId}` back-fill lookup) answers "which NyxID
 *      orgs can I share a skill with".
 *   2. **Budget** — `GET /me/quota` is the pre-flight check before any
 *      billed call (playground chat, skill generation, assistant chat).
 *      Those surfaces reserve a unit *before* the LLM call, so an agent
 *      that reads `remaining === 0` should stop rather than eat a 429.
 *   3. **Top-up** — `POST /me/redemption-codes/redeem` converts an
 *      admin-issued code into quota grants on the caller's current-month
 *      buckets; `GET /me/redemption-codes/history` and
 *      `GET /me/launch-promo` explain what has already been granted.
 *   4. **Execution parameters** — `GET /me/models` is the only
 *      non-admin way to discover which `model` values the playground /
 *      skill-gen / assistant surfaces will accept.
 *
 * Two ancillary aggregations (`/me/skills/grants-summary`,
 * `/me/shared-skills/sources-summary`) and two telemetry pings
 * (`/activity/login`, `/activity/logout`) round the domain out.
 *
 * Ornn is not the source of truth for identity: everything here is
 * derived from the NyxID identity token the proxy forwards, or proxied
 * to NyxID on the caller's behalf. Several reads fail **soft** — when
 * NyxID is unreachable they answer `[]` instead of 5xx — which is
 * called out per-operation because an agent must not read an empty list
 * as "the caller definitively has none".
 *
 * Response payloads here are hand-written JSON Schema because they have
 * no Zod source at all — these handlers project them inline
 * (`c.json({ data: {...} })`) off domain TypeScript interfaces
 * (`QuotaSnapshot`, `LaunchPromoStatus`, `OrgMembershipFact`, …). The one
 * request body that *does* have a Zod source — `redeemSchema` in
 * `domains/redemption-codes/types.ts` — is generated from it rather than
 * transcribed, so its bounds cannot drift from the validator.
 *
 * @module openapi/paths/account
 */

import {
  bearerAuth,
  headerParam,
  jsonBody,
  jsonResponse,
  pathParam,
  problemResponses,
  queryParam,
  toSchema,
  type JsonSchema,
  type PathMap,
} from "../helpers";
import { redeemSchema } from "../../domains/redemption-codes/types";

/**
 * Request body for the redeem endpoint, generated from the runtime
 * validator so `minLength` / `maxLength` cannot drift, then overlaid with
 * the prose the Zod schema has no room for.
 *
 * `redeemSchema` ends in a `.transform()`. That matters: under zod 4 a
 * transform is a `ZodPipe`, and only the **input** side has a JSON Schema
 * representation — `toSchema(redeemSchema, "output")` would yield `{}` for
 * `code`. `jsonBody` uses the input direction, which is both correct here
 * and the reason this works at all.
 */
const redeemBodySchema: JsonSchema = (() => {
  const generated = toSchema(redeemSchema, "input") as JsonSchema & {
    properties?: Record<string, JsonSchema>;
  };
  return {
    ...generated,
    properties: {
      ...generated.properties,
      code: {
        ...(generated.properties?.code ?? {}),
        description:
          "The redemption code. Trimmed and upper-cased server-side before lookup, so any casing is accepted. Minted codes are 16 characters drawn from the ambiguity-free alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0`, `O`, `1`, `I`, `L`), but the field accepts up to 64 characters so future formats do not break clients.",
        examples: ["K7M2QX9RTVBN4PZ3"],
      },
    },
  };
})();

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

const identitySchema: JsonSchema = {
  type: "object",
  required: ["userId", "email", "displayName", "roles", "permissions"],
  properties: {
    userId: {
      type: "string",
      description:
        "Stable NyxID user id (the identity token's `sub` claim). This is the value every ownership check, grant list, and `authorUserId` field in the rest of the API compares against.",
    },
    email: {
      type: "string",
      description:
        "Caller's email. Empty string when the identity token carried no `email` claim — do not assume it is populated.",
    },
    displayName: {
      type: "string",
      description:
        "Human label, from the token's `name` claim, falling back to `email`. **Can be an empty string** — when the token carries neither claim there is no further fallback (the `userId` fallback in the code is unreachable, because the missing email has already been normalised to `\"\"`). Render your own fallback to `userId` rather than trusting this field to be populated.",
    },
    roles: {
      type: "array",
      items: { type: "string" },
      description:
        "NyxID role names on the token. Informational only — authorization is decided by `permissions`, never by this list.",
    },
    permissions: {
      type: "array",
      items: { type: "string" },
      description:
        "Request scopes minted onto the token, formatted `ornn:<resource>:<action>` (e.g. `ornn:skill:create`, `ornn:admin:skill`). Check membership here before attempting a scoped operation; `ornn:admin:skill` is the platform-admin scope that unlocks `/admin/*`. Empty when the proxy authenticated via `X-NyxID-*` headers instead of an identity token — in that mode Ornn has no RBAC data and every scope-gated endpoint will answer 403.",
    },
  },
};

const successFlagSchema: JsonSchema = {
  type: "object",
  required: ["success"],
  properties: {
    success: {
      type: "boolean",
      description: "Always `true`. The event was handed to the analytics emitter.",
    },
  },
};

const orgMembershipSchema: JsonSchema = {
  type: "object",
  required: ["userId", "role", "displayName"],
  properties: {
    userId: {
      type: "string",
      description:
        "NyxID org id. This is the value to put in a skill's `sharedWithOrgs` grant list — orgs are addressed by the same id space as users, hence the field name.",
    },
    role: {
      type: "string",
      enum: ["admin", "member"],
      description:
        "Caller's role in this org. NyxID `viewer` memberships are filtered out upstream and never appear here.",
    },
    displayName: {
      type: "string",
      description: "Org display name, so a picker can be rendered without a second round-trip.",
    },
  },
};

const orgSummarySchema: JsonSchema = {
  type: "object",
  required: ["userId", "displayName", "avatarUrl"],
  properties: {
    userId: {
      type: "string",
      description: "The org id, echoed back. Equals the `orgId` path parameter unless NyxID reports a different canonical id.",
    },
    displayName: {
      type: "string",
      description: "Org display name. Falls back to the raw org id when NyxID returned no `display_name`.",
    },
    avatarUrl: {
      type: ["string", "null"],
      description: "Org avatar URL, or `null` when the org has none.",
    },
  },
};

const nyxidServiceSchema: JsonSchema = {
  type: "object",
  required: ["id", "slug", "label", "description", "tier"],
  properties: {
    id: {
      type: "string",
      description:
        "NyxID service id — pass this when tying a skill to a service. Synthetic platform entries use the reserved form `synthetic:<slug>` and never exist in NyxID's catalog.",
    },
    slug: { type: "string", description: "URL-safe service slug (e.g. `chrono-storage`)." },
    label: { type: "string", description: "Human-readable service name for a picker." },
    description: {
      type: ["string", "null"],
      description: "Service description from NyxID, `null` when unset. Synthetic entries carry an empty string.",
    },
    tier: {
      type: "string",
      enum: ["admin", "personal"],
      description:
        "`admin` — a NyxID public/platform service; tying a skill to it marks that skill as a **system skill** and forces it public. `personal` — a private service the caller created; tying to it leaves the skill's visibility untouched. Synthetic entries are always `admin`.",
    },
  },
};

const grantOrgBucketSchema: JsonSchema = {
  type: "object",
  required: ["id", "displayName", "skillCount"],
  properties: {
    id: { type: "string", description: "NyxID org id." },
    displayName: {
      type: "string",
      description:
        "Org display name resolved best-effort from NyxID. Falls back to the raw org id when the lookup fails or no caller token was forwarded — so a value equal to `id` means \"name unresolved\", not \"org literally named that\".",
    },
    skillCount: {
      type: "integer",
      description: "How many of the caller's skills are shared with this org.",
    },
  },
};

const grantUserBucketSchema: JsonSchema = {
  type: "object",
  required: ["userId", "email", "displayName", "skillCount"],
  properties: {
    userId: { type: "string", description: "NyxID user id of the grantee." },
    email: {
      type: "string",
      description:
        "Grantee email from Ornn's user directory. Empty string when that user has never signed into Ornn.",
    },
    displayName: {
      type: "string",
      description: "Grantee display name, falling back to email, then to the raw user id.",
    },
    skillCount: {
      type: "integer",
      description: "How many of the caller's skills are shared with this user.",
    },
  },
};

const sourceOrgBucketSchema: JsonSchema = {
  ...grantOrgBucketSchema,
  properties: {
    ...(grantOrgBucketSchema.properties as Record<string, JsonSchema>),
    skillCount: {
      type: "integer",
      description: "How many skills reach the caller through membership in this org.",
    },
  },
};

const sourceUserBucketSchema: JsonSchema = {
  ...grantUserBucketSchema,
  properties: {
    ...(grantUserBucketSchema.properties as Record<string, JsonSchema>),
    userId: { type: "string", description: "NyxID user id of the author who shared with the caller." },
    skillCount: {
      type: "integer",
      description: "How many skills this author has shared directly with the caller.",
    },
  },
};

const launchPromoStatusSchema: JsonSchema = {
  type: "object",
  required: ["promoEnabled", "claimed", "rank", "totalSlots", "slotsRemaining", "awardedAt"],
  properties: {
    promoEnabled: {
      type: "boolean",
      description:
        "Whether the launch promo is switched on in platform settings. When `false` every other field is still returned but no award can happen.",
    },
    claimed: {
      type: "boolean",
      description:
        "Whether this caller has already been awarded. Awards are one-per-user and idempotent; a claimed user never gets a second code.",
    },
    rank: {
      type: ["integer", "null"],
      description:
        "Caller's 1-based Ornn registration rank (1 = first ever user). `null` when the caller is not yet in Ornn's user directory. Eligibility requires `rank <= totalSlots`.",
    },
    totalSlots: { type: "integer", description: "Configured size of the promo cohort (e.g. 500)." },
    slotsRemaining: {
      type: "integer",
      description: "`totalSlots` minus the number of awards already handed out. Never negative.",
    },
    awardedAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "ISO-8601 UTC timestamp of the award, or `null` when `claimed` is `false`.",
    },
  },
};

const surfaceSnapshotSchema: JsonSchema = {
  type: "object",
  required: ["defaultAllotment", "adminGrant", "used", "remaining", "warningThreshold", "warning"],
  properties: {
    defaultAllotment: {
      type: "integer",
      description:
        "Effective monthly allotment for this surface — `max(the default snapshotted when the bucket was first touched, the current platform default)`. Raising the platform default mid-month grants headroom; lowering it never retroactively shrinks an existing bucket.",
    },
    adminGrant: {
      type: "integer",
      description:
        "Extra units added to this month's bucket by admin grants and redemption codes. Resets with the bucket at the UTC month rollover — grants do not carry over.",
    },
    used: {
      type: "integer",
      description:
        "Units consumed this month, including in-flight reservations. A unit is reserved before the LLM call and refunded if the run ends in a system error or client abort.",
    },
    remaining: {
      type: "integer",
      description:
        "`max(0, defaultAllotment + adminGrant - used)`. Already accounts for runs currently streaming, so it is the number an agent should gate on. `0` means the next billed call on this surface returns 429 `quota_exceeded`.",
    },
    warningThreshold: {
      type: "number",
      description:
        "Fraction of the cap at which the UI shows a soft warning (default `0.8`). Advisory only — nothing is blocked at this level.",
    },
    warning: {
      type: "boolean",
      description:
        "`true` once `cap > 0 && used >= floor(cap * warningThreshold)`, where `cap = defaultAllotment + adminGrant`. The `cap > 0` guard means a zero-cap bucket never warns even though `used >= 0` trivially holds. Advisory only.",
    },
  },
};

const quotaSnapshotSchema: JsonSchema = {
  type: "object",
  required: [
    "isAdmin",
    "monthMarker",
    "monthStart",
    "monthEnd",
    "nextMonthlyResetAt",
    "playground",
    "skillGen",
  ],
  properties: {
    isAdmin: {
      type: "boolean",
      description:
        "`true` when the caller holds `ornn:admin:skill`. Admins bypass quota entirely — their buckets are still reported but nothing is charged against them, so ignore `remaining` for these callers.",
    },
    monthMarker: {
      type: "string",
      description: "UTC calendar month this snapshot describes, formatted `YYYY-MM`.",
      examples: ["2026-08"],
    },
    monthStart: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC timestamp of the first instant of `monthMarker`.",
    },
    monthEnd: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC timestamp of the first instant of the *next* month (exclusive bound).",
    },
    nextMonthlyResetAt: {
      type: "string",
      format: "date-time",
      description:
        "When the buckets abandon and reset. Equal to `monthEnd`; exposed separately so a client can render a countdown without knowing the bucket model.",
    },
    playground: {
      ...surfaceSnapshotSchema,
      description: "Bucket for the playground chat surface (`POST /playground/chat`).",
    },
    skillGen: {
      ...surfaceSnapshotSchema,
      description: "Bucket for the AI skill-generation surface (`POST /skills/generate`).",
    },
  },
  description:
    "Per-surface monthly quota. The assistant surface (`POST /assistant/chat`) also reserves and charges, but it is not admin-grantable or redeemable in v1 and therefore is not reported here.",
};

const pickerModelSchema: JsonSchema = {
  type: "object",
  required: ["modelId", "displayName", "isDefault"],
  properties: {
    modelId: {
      type: "string",
      description:
        "The value to send as the `model` field on the corresponding surface's request body. Opaque — do not parse it or assume a provider prefix.",
      examples: ["claude-sonnet-4-6"],
    },
    displayName: {
      type: "string",
      description: "Human label for a picker. Not stable — never key off it.",
    },
    isDefault: {
      type: "boolean",
      description:
        "`true` for the model the server would pick if the request omits `model`. At most one item is marked, and it is always sorted first.",
    },
  },
};

const appliedGrantSchema: JsonSchema = {
  type: "object",
  required: ["surface", "amount", "monthMarker", "newAdminGrant"],
  properties: {
    surface: {
      type: "string",
      enum: ["playground", "skillGen"],
      description: "Which quota bucket received the grant.",
    },
    amount: { type: "integer", description: "Units added by this entry of the code." },
    monthMarker: {
      type: "string",
      description: "UTC month (`YYYY-MM`) whose bucket was credited — always the current month.",
      examples: ["2026-08"],
    },
    newAdminGrant: {
      type: "integer",
      description:
        "The bucket's `adminGrant` total *after* this grant was applied. Compare against the pre-redemption value from `GET /me/quota` to confirm the credit landed.",
    },
  },
};

const historyGrantSchema: JsonSchema = {
  type: "object",
  required: ["surface", "amount"],
  properties: {
    surface: {
      type: "string",
      enum: ["playground", "skillGen"],
      description: "Surface this entry of the code targeted.",
    },
    amount: { type: "integer", description: "Units the entry was worth." },
  },
};

const historyItemSchema: JsonSchema = {
  type: "object",
  required: ["id", "code", "grants", "note", "redeemedAt", "expiresAt", "createdAt"],
  properties: {
    id: { type: "string", description: "Redemption-code document id (24-char Mongo ObjectId hex)." },
    code: {
      type: "string",
      description:
        "The full code, unmasked. Safe here because the caller already redeemed it and it is single-use across the whole platform — it can never be redeemed again.",
    },
    grants: {
      type: "array",
      items: historyGrantSchema,
      description: "What the code was worth, one entry per surface. Never empty.",
    },
    note: {
      type: ["string", "null"],
      description: "Free-text note the issuing admin attached, or `null`.",
    },
    redeemedAt: {
      type: ["string", "null"],
      format: "date-time",
      description:
        "ISO-8601 UTC timestamp of redemption. Practically always populated in this listing — it only returns codes this caller redeemed.",
    },
    expiresAt: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC expiry the code carried when it was minted.",
    },
    createdAt: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC timestamp of when the admin minted the code.",
    },
  },
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function accountPaths(prefix: string): PathMap {
  return {
    [`${prefix}/me`]: {
      get: {
        summary: "Get the caller's identity and permission scopes",
        description:
          "Return the identity snapshot Ornn derived from the NyxID identity token on this request: user id, email, display name, roles, and — most importantly — the permission scopes the token carries. Call this once at the start of a session and cache it for the token's lifetime; nothing here changes without a new token. Agents should branch on `permissions` rather than probing endpoints and handling 403s: `ornn:admin:skill` unlocks every `/admin/*` route, `ornn:skill:create` is needed to upload, `ornn:skill:build` to generate, `ornn:playground:use` to run playground chat. This endpoint exists because some NyxID-created accounts ship an OAuth `id_token` that is missing `name`/`email` while the proxy-forwarded identity token is complete — so treat this response, not the id_token, as authoritative for display fields.",
        operationId: "getMe",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(identitySchema, "Identity snapshot for the bearer token on this request.", {
            example: {
              userId: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
              email: "agent@example.com",
              displayName: "Build Agent",
              roles: ["user"],
              permissions: ["ornn:skill:read", "ornn:skill:create", "ornn:skill:build"],
            },
          }),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/activity/login`]: {
      post: {
        summary: "Record a session-opened telemetry event",
        description:
          "Fire-and-forget server-side acknowledgement that the caller opened a session. The identity attached to the event is taken from the NyxID identity token — the request body is ignored entirely and no client-supplied identity is trusted. This is pure telemetry: it grants nothing, creates no session state, and is never required before any other call. Integrators only need it if they want their agent's sessions to show up alongside web sessions in platform analytics. Always answers `200` with `{ success: true }`, even if the analytics sink is down — never gate your flow on it, and never retry it.",
        operationId: "recordLoginActivity",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(successFlagSchema, "Event accepted for emission.", {
            example: { success: true },
          }),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/activity/logout`]: {
      post: {
        summary: "Record a session-closed telemetry event",
        description:
          "Mirror of `POST /activity/login` for session close. Fire-and-forget, identity taken from the NyxID identity token, no body read, nothing invalidated. Calling this does **not** revoke the bearer token — token lifecycle belongs to NyxID, and the token keeps working until it expires or NyxID revokes it. Always answers `200` with `{ success: true }`; do not retry.",
        operationId: "recordLogoutActivity",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(successFlagSchema, "Event accepted for emission.", {
            example: { success: true },
          }),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/orgs`]: {
      get: {
        summary: "List the caller's NyxID org memberships",
        description:
          "Return the orgs the caller belongs to as `admin` or `member` (NyxID `viewer` memberships are filtered out upstream and never appear). Use this to build the candidate list for a skill's `sharedWithOrgs` grants — an org id that is not in this list will be rejected by the share write-gate. **Fails soft:** if the NyxID proxy did not forward the caller's access token, or the org lookup errored, this returns an empty `items` array with a `200`. An empty list therefore means \"either the caller is in no org, or we could not ask\" — it is not proof of non-membership, so do not cache a negative result aggressively. Write paths that need an authoritative answer use a separate resolution-aware gate that answers `503 org_membership_unavailable` instead of guessing.",
        operationId: "listMyOrgs",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: orgMembershipSchema,
                  description:
                    "Org memberships, unordered. Empty when the caller has none *or* when the lookup could not be resolved.",
                },
              },
            },
            "The caller's org memberships (possibly empty — see the fail-soft note).",
            {
              example: {
                items: [
                  { userId: "org_01HQ8Z7Y6X5W4V3U2T1S", role: "admin", displayName: "Chrono AI" },
                  { userId: "org_01HQ9A0B1C2D3E4F5G6H", role: "member", displayName: "Platform Team" },
                ],
              },
            },
          ),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/orgs/{orgId}`]: {
      get: {
        summary: "Look up one org by id (display-name back-fill)",
        description:
          "Proxy a single-org read to NyxID using the caller's forwarded access token, and project it down to `{ userId, displayName, avatarUrl }`. This exists for back-fill: a skill's grant list stores bare org ids, and the caller may no longer be a member of an org that still appears there, so `GET /me/orgs` cannot resolve every name. Resolve one id at a time with this endpoint. NyxID decides visibility — an org the caller cannot see is reported as `404`, identically to an org that does not exist, so existence is never leaked. A `404` is also what you get when the proxy stripped the caller's access token, since Ornn then has no credential to act on their behalf; treat `404` as \"unknown org, render the raw id\" rather than as a hard error.",
        operationId: "getMyOrg",
        tags: ["Account"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "orgId",
            "NyxID org id, exactly as it appears in `GET /me/orgs` or in a skill's `sharedWithOrgs` list. Opaque string — URL-encode it and do not attempt to parse it.",
            { type: "string" },
            "org_01HQ8Z7Y6X5W4V3U2T1S",
          ),
        ],
        responses: {
          ...jsonResponse(orgSummarySchema, "Org summary as NyxID reports it to this caller.", {
            example: {
              userId: "org_01HQ8Z7Y6X5W4V3U2T1S",
              displayName: "Chrono AI",
              avatarUrl: null,
            },
          }),
          ...problemResponses(
            401,
            {
              404: "Not found (`org_not_found`) — no such org, the caller may not see it, or the proxy forwarded no access token so Ornn could not ask. The three cases are deliberately indistinguishable.",
            },
            {
              500: "Internal error, in one of two shapes. `NYXID_ORG_LOOKUP_FAILED` — NyxID answered with an unexpected non-2xx status (anything other than 403/404); the upstream status and the first 200 characters of its body are quoted in `detail`. `internal_error` — the call never completed a usable response: a transport-layer failure (DNS, connection refused, timeout) or a 2xx body that is not JSON; `detail` is the generic \"Internal server error\", so there is nothing to parse. Branch on both codes, not just the first — the transport case is the more common one. Both are retryable with backoff.",
            },
          ),
        },
      },
    },

    [`${prefix}/me/nyxid-services`]: {
      get: {
        summary: "List NyxID services the caller may tie a skill to",
        description:
          "Return the catalog of NyxID services eligible as a skill's service binding: every NyxID **public** service (`tier: \"admin\"`), plus the caller's own **private** services (`tier: \"personal\"`), plus any synthetic platform entries an admin configured (also `tier: \"admin\"`, id prefixed `synthetic:`). Read `tier` before binding, because it changes the skill: tying to an `admin`-tier service marks the skill a **system skill** and forces it public, whereas tying to a `personal` service leaves visibility untouched. Synthetic entries are appended last and exist only inside Ornn — they resolve to no NyxID record. **Fails soft:** when the caller's access token was not forwarded, or NyxID's catalog call fails, the NyxID-sourced rows are silently dropped and only synthetic entries come back, still with a `200`. A short list is therefore not proof the catalog is small.",
        operationId: "listMyNyxidServices",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: nyxidServiceSchema,
                  description:
                    "Eligible services. NyxID catalog entries first (unordered), synthetic platform entries appended last.",
                },
              },
            },
            "Services this caller may bind a skill to.",
            {
              example: {
                items: [
                  {
                    id: "svc_01HQ8Z7Y6X5W4V3U2T1S",
                    slug: "chrono-storage",
                    label: "Chrono Storage",
                    description: "Object storage for skill packages",
                    tier: "admin",
                  },
                  {
                    id: "synthetic:internal-tools",
                    slug: "internal-tools",
                    label: "Internal Tools",
                    description: "",
                    tier: "admin",
                  },
                ],
              },
            },
          ),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/skills/grants-summary`]: {
      get: {
        summary: "Summarise who the caller has shared their skills with",
        description:
          "Aggregate every skill the caller **owns** by grantee, and return two buckets — `orgs` and `users` — each carrying a display name and a skill count. This answers \"I have shared N skills with X\" in one round-trip, which is otherwise an N+1 walk over the caller's skills and their grant lists. Read-only and derived: it never lists the skills themselves, so use `GET /skill-search?scope=private` for that. Display names are resolved best-effort (orgs via NyxID, users via Ornn's directory) and silently fall back to the raw id on failure — a `displayName` equal to the id means the lookup did not resolve. For the mirror-image view (who has shared *with* the caller) use `GET /me/shared-skills/sources-summary`.",
        operationId: "getMySkillGrantsSummary",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["orgs", "users"],
              properties: {
                orgs: {
                  type: "array",
                  items: grantOrgBucketSchema,
                  description: "One entry per org that has been granted at least one of the caller's skills.",
                },
                users: {
                  type: "array",
                  items: grantUserBucketSchema,
                  description: "One entry per user who has been granted at least one of the caller's skills directly.",
                },
              },
            },
            "Grantee buckets for the caller's own skills.",
            {
              example: {
                orgs: [{ id: "org_01HQ8Z7Y6X5W4V3U2T1S", displayName: "Chrono AI", skillCount: 4 }],
                users: [
                  {
                    userId: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
                    email: "teammate@example.com",
                    displayName: "Teammate",
                    skillCount: 2,
                  },
                ],
              },
            },
          ),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/shared-skills/sources-summary`]: {
      get: {
        summary: "Summarise who has shared skills with the caller",
        description:
          "The mirror of `GET /me/skills/grants-summary`: aggregate the skills the caller can see *because someone granted them*, bucketed by where the access comes from. `orgs` are bridge memberships — orgs the caller belongs to where a member granted a private skill to the org; `users` are authors who granted directly. Skills the caller owns and public skills are excluded, so this is strictly the \"shared with me\" surface. Same best-effort name resolution and same id-fallback caveat as the grants summary. Note it depends on the caller's org membership lookup, which fails soft to \"no orgs\" — if NyxID is unreachable the `orgs` bucket can come back empty even though bridge shares exist.",
        operationId: "getMySharedSkillSourcesSummary",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["orgs", "users"],
              properties: {
                orgs: {
                  type: "array",
                  items: sourceOrgBucketSchema,
                  description:
                    "One entry per org through which skills reach the caller. Empty when the caller is in no org *or* the membership lookup failed soft.",
                },
                users: {
                  type: "array",
                  items: sourceUserBucketSchema,
                  description: "One entry per author who shared a skill with the caller directly.",
                },
              },
            },
            "Source buckets for skills shared with the caller.",
            {
              example: {
                orgs: [{ id: "org_01HQ8Z7Y6X5W4V3U2T1S", displayName: "Chrono AI", skillCount: 7 }],
                users: [
                  {
                    userId: "usr_01HAAA2K3M4N5P6Q7R8S9T",
                    email: "author@example.com",
                    displayName: "Skill Author",
                    skillCount: 1,
                  },
                ],
              },
            },
          ),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/launch-promo`]: {
      get: {
        summary: "Get the caller's launch-promo eligibility and claim status",
        description:
          "Report whether the launch promo is running, whether this caller has already been awarded, their 1-based Ornn registration rank, and how many cohort slots remain. Eligibility is `promoEnabled && !claimed && rank !== null && rank <= totalSlots && slotsRemaining > 0`. This endpoint is **read-only** — there is no self-serve claim route. Awards are handed out by a platform admin (or the stargazer cron), which mints a redemption code and delivers it as a notification; the resulting quota only lands once the caller redeems that code via `POST /me/redemption-codes/redeem`. So `claimed: true` means \"a code was issued to you\", not \"your quota already went up\" — cross-check `GET /me/redemption-codes/history`.",
        operationId: "getMyLaunchPromoStatus",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(launchPromoStatusSchema, "Launch-promo status for the caller.", {
            example: {
              promoEnabled: true,
              claimed: false,
              rank: 137,
              totalSlots: 500,
              slotsRemaining: 363,
              awardedAt: null,
            },
          }),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/quota`]: {
      get: {
        summary: "Get the caller's monthly quota snapshot",
        description:
          "Return the caller's current-month quota buckets for the two metered surfaces — `playground` and `skillGen`. This is the pre-flight check for any billed call: gate on `remaining > 0` before `POST /playground/chat` or `POST /skills/generate`, because those surfaces reserve a unit *before* the LLM call and answer `429 quota_exceeded` when the bucket is empty. `remaining` already reflects in-flight reservations, so it is safe to poll during a streaming run; a run that ends in a system error or client abort releases its unit and `remaining` goes back up. Buckets are per calendar month in UTC and reset by abandonment at `nextMonthlyResetAt` — nothing carries over. When `isAdmin` is `true` the caller bypasses charging entirely and the numbers are informational only. The assistant surface is metered too but is not reported here (it is neither admin-grantable nor redeemable in v1). To top up, redeem a code with `POST /me/redemption-codes/redeem`.",
        operationId: "getMyQuota",
        tags: ["Account"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(quotaSnapshotSchema, "Current-month quota snapshot for the caller.", {
            example: {
              isAdmin: false,
              monthMarker: "2026-08",
              monthStart: "2026-08-01T00:00:00.000Z",
              monthEnd: "2026-09-01T00:00:00.000Z",
              nextMonthlyResetAt: "2026-09-01T00:00:00.000Z",
              playground: {
                defaultAllotment: 100,
                adminGrant: 50,
                used: 122,
                remaining: 28,
                warningThreshold: 0.8,
                warning: true,
              },
              skillGen: {
                defaultAllotment: 20,
                adminGrant: 0,
                used: 3,
                remaining: 17,
                warningThreshold: 0.8,
                warning: false,
              },
            },
          }),
          ...problemResponses(401),
        },
      },
    },

    [`${prefix}/me/models`]: {
      get: {
        summary: "List the LLM models enabled for a surface",
        description:
          "Return the models an ordinary caller may select for one execution surface, plus the id the server will use when the request omits `model`. This is the only non-admin model-discovery route — the admin catalogue under `/admin/settings/llm-providers` is scope-gated. Results are the union across every configured provider, filtered to models that are enabled for the requested surface and not soft-removed, sorted with the default first. Feed `modelId` straight into the surface's request body; do not hard-code model ids, because an admin can enable or retire one at any time without a deploy. `defaultModelId` is `null` only when no model is enabled for that surface at all — in that state the surface itself answers `503 MODEL_UNAVAILABLE`, so treat `null` as \"do not attempt the call\".",
        operationId: "listMyModels",
        tags: ["Account"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "surface",
            "Which execution surface to list models for. Required — there is no default, and any other value (including omitting it) is rejected with `400 invalid_surface`. `playground` → `POST /playground/chat`; `skillGen` → `POST /skills/generate`; `assistant` → `POST /assistant/chat`.",
            {
              type: "string",
              enum: ["playground", "skillGen", "assistant"],
              examples: ["playground"],
            },
            true,
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items", "defaultModelId"],
              properties: {
                items: {
                  type: "array",
                  items: pickerModelSchema,
                  description:
                    "Selectable models, default first, then alphabetical by `displayName`. Empty when no model is enabled for this surface.",
                },
                defaultModelId: {
                  type: ["string", "null"],
                  description:
                    "Model used when a request omits `model`. Honours the platform's per-surface pin when one is configured, otherwise the per-model default flag, otherwise the first item. `null` when `items` is empty.",
                },
              },
            },
            "Models enabled for the requested surface.",
            {
              example: {
                items: [
                  { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", isDefault: true },
                  { modelId: "gpt-5.2", displayName: "GPT-5.2", isDefault: false },
                ],
                defaultModelId: "claude-sonnet-4-6",
              },
            },
          ),
          ...problemResponses(
            {
              400: "Bad request (`invalid_surface`) — the `surface` query parameter was missing or is not one of `playground`, `skillGen`, `assistant`.",
            },
            401,
          ),
        },
      },
    },

    [`${prefix}/me/redemption-codes/redeem`]: {
      post: {
        summary: "Redeem a code for quota credit",
        description:
          "Consume an admin-issued redemption code and apply its grants to the caller's **current-month** quota buckets. Codes are single-use across the entire platform — the first caller to redeem wins and every later attempt gets `409`. Any authenticated caller may redeem; no admin scope is involved. The code is normalised server-side (trimmed and upper-cased) before lookup, so casing and stray whitespace in user-pasted input are tolerated. Grants land as `adminGrant` on the current month's bucket and expire with it at the UTC month rollover — redeeming late in a month wastes the credit, so redeem when you intend to spend. Claiming the code is a destructive one-shot, so **send an `Idempotency-Key`**: with one, a retry after a lost response replays the original `200` verbatim instead of hitting the `409` a second attempt would otherwise earn. Without one the operation is genuinely not retryable — a network failure after the server claimed the code leaves the code consumed and a bare retry returns `409`; in that case reconcile with `GET /me/redemption-codes/history` before retrying. Confirm the new balance either way with `GET /me/quota`.",
        operationId: "redeemRedemptionCode",
        tags: ["Account"],
        security: bearerAuth(),
        parameters: [
          headerParam(
            "Idempotency-Key",
            "Optional client-generated retry key, at most 255 characters after trimming. The first response for a given `(caller, method, path, key)` tuple is cached for 24 hours; a retry with the same key replays that exact status and body and adds `Idempotency-Replay: true`, which is what makes a redeem whose response was lost in transit safe to repeat. Responses of `500` and above are never cached, so a retry after one re-executes the handler rather than replaying. A missing, empty, or over-long key is ignored silently — the request runs normally with no replay protection, and no `400` is raised.",
          ),
        ],
        requestBody: jsonBody(
          redeemBodySchema,
          "The code to consume. Generated from `redeemSchema` in `domains/redemption-codes/types.ts` — the schema the route's `validateBody` actually runs — so the published bounds cannot drift from the validator.",
          { example: { code: "K7M2QX9RTVBN4PZ3" } },
        ),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["codeId", "redeemedAt", "grants"],
              properties: {
                codeId: {
                  type: "string",
                  description: "Id of the redeemed code document — the same `id` it will carry in the history listing.",
                },
                redeemedAt: {
                  type: "string",
                  format: "date-time",
                  description: "ISO-8601 UTC timestamp of the redemption.",
                },
                grants: {
                  type: "array",
                  items: appliedGrantSchema,
                  description:
                    "One entry per surface the code credited, in the order they were applied. Never empty on success.",
                },
              },
            },
            "Code consumed and its grants applied to the caller's current-month buckets.",
            {
              example: {
                codeId: "665f1c2a9d4b7e3f10ab42c9",
                redeemedAt: "2026-08-07T09:14:22.118Z",
                grants: [
                  { surface: "playground", amount: 200, monthMarker: "2026-08", newAdminGrant: 250 },
                  { surface: "skillGen", amount: 25, monthMarker: "2026-08", newAdminGrant: 25 },
                ],
              },
            },
          ),
          ...problemResponses(
            {
              400: "Bad request (`INVALID_REDEEM_BODY`) — the body is not valid JSON, `code` is missing, or it is longer than 64 characters. `detail` carries the rejected fields as `<path>: <message>` pairs joined with `; `; there is no per-field `errors[]` array. Unparseable JSON reports the fixed detail `Request body must be valid JSON`.",
            },
            401,
            {
              404: "Not found (`redemption_code_not_found`) — no code matches after normalisation. Check for transcription errors between the visually similar glyphs the alphabet deliberately excludes.",
            },
            {
              409: "Conflict (`redemption_code_already_redeemed`) — this code was already consumed, by this caller or another. Codes are single-use; this is also what a retry of a request that actually succeeded returns.",
            },
            {
              410: "Gone — the code is no longer usable: `redemption_code_expired` (past its `expiresAt`) or `redemption_code_invalidated` (an admin revoked it before anyone redeemed it). Neither is retryable; ask for a new code.",
            },
            {
              500: "Internal error (`redemption_code_redeem_failed`) — the redemption failed, and the response alone does not say on which side of the atomic claim. Either it failed **before** the claim (the datastore lookup errored; nothing was consumed and the code is still `active`), or **after** it while applying one of the grants (the code is consumed, some grants may have landed, and there is deliberately no rollback). Distinguish the two with `GET /me/redemption-codes/history`: if the code is absent it was never consumed and retrying is correct; if it is present, do not retry — compare `GET /me/quota` against the code's grant bundle and ask an admin to top up whatever is missing.",
            },
          ),
        },
      },
    },

    [`${prefix}/me/redemption-codes/history`]: {
      get: {
        summary: "List redemption codes the caller has redeemed",
        description:
          "Offset-paginated listing of the codes this caller redeemed, newest first, with their full code string, grant bundle, and timestamps. Scoped to the caller — it never exposes codes redeemed by anyone else, nor unredeemed codes sitting in the admin pool. Use it to reconcile a redemption whose response was lost in transit (look for `codeId` before retrying a `POST .../redeem`, which would otherwise return `409`), or to audit where a month's `adminGrant` balance came from. Pagination is offset-based here rather than cursor-based like the skill listings, and both parameters are silently clamped instead of rejected — an out-of-range value never produces a `400`, so read `page` and `pageSize` back from the response rather than assuming your request was honoured.",
        operationId: "listMyRedemptionCodeHistory",
        tags: ["Account"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "page",
            "1-based page number. Defaults to `1`. Clamped into `[1, 10000]` — anything below, above, or unparseable is silently coerced rather than rejected. The upper bound exists to stop a huge offset driving an unbounded collection scan.",
            { type: "integer", minimum: 1, maximum: 10000, default: 1, examples: [1] },
          ),
          queryParam(
            "pageSize",
            "Items per page. Defaults to `20`, clamped into `[1, 100]`. Non-numeric or missing values fall back to the default rather than erroring.",
            { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] },
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items", "total", "page", "pageSize", "totalPages"],
              properties: {
                items: {
                  type: "array",
                  items: historyItemSchema,
                  description: "Redeemed codes for this page, newest first.",
                },
                total: {
                  type: "integer",
                  description: "Total number of codes this caller has ever redeemed, across all pages.",
                },
                page: {
                  type: "integer",
                  description: "The page actually served, after clamping. Compare against what you sent.",
                },
                pageSize: {
                  type: "integer",
                  description: "The page size actually applied, after clamping.",
                },
                totalPages: {
                  type: "integer",
                  description: "`ceil(total / pageSize)`, floored at `1` — so an empty history still reports `1`.",
                },
              },
            },
            "One page of the caller's redemption history.",
            {
              example: {
                items: [
                  {
                    id: "665f1c2a9d4b7e3f10ab42c9",
                    code: "K7M2QX9RTVBN4PZ3",
                    grants: [
                      { surface: "playground", amount: 200 },
                      { surface: "skillGen", amount: 25 },
                    ],
                    note: "Launch promo cohort",
                    redeemedAt: "2026-08-07T09:14:22.118Z",
                    expiresAt: "2026-12-31T23:59:59.000Z",
                    createdAt: "2026-08-01T12:00:00.000Z",
                  },
                ],
                total: 1,
                page: 1,
                pageSize: 20,
                totalPages: 1,
              },
            },
          ),
          ...problemResponses(401),
        },
      },
    },
  };
}
