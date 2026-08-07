/**
 * OpenAPI operations for the **skillsets** domain (#969, #1214).
 *
 * A skillset is a named, versioned, owned meta-package that references
 * N member skills (2..100) plus a REQUIRED master prompt (`instructions`,
 * #978) telling an agent how to operate the set. It is the "bundle" unit of
 * Ornn's skill lifecycle: one `GET /skillsets/{idOrName}/closure` call
 * resolves every member AND each member's transitive dependency closure
 * (#968) into a single deps-first topo-sorted list an agent can install as-is.
 *
 * Three things about this domain surprise integrators, so they are repeated
 * on every operation that they touch:
 *
 *   1. **Visibility is DERIVED, never set** (#1136). A skillset has no
 *      owner-controlled privacy switch and there is deliberately NO
 *      `PUT /skillsets/{id}/permissions`. A caller may read a skillset iff
 *      they can read *every* one of its members; the moment one member is
 *      unreadable a non-owner gets a flat `404`, never a `403` and never a
 *      hint about which member. To widen a skillset's reach you widen its
 *      member skills. `memberVisibilityState` is the authoritative READ
 *      signal; `isPrivate` and `sharedWith*` are inert legacy back-compat.
 *      `grants` is inert for READ as well — but NOT for writes: a `write`
 *      entry there is the object-tier WRITE ACL that `PUT /skillsets/{id}`
 *      and `PUT /skillsets/{id}/plugin-export` consult, and it is the only
 *      way a caller who is neither the owner nor a platform admin gets
 *      through them.
 *   2. **Versions are system-assigned** (#1162). Callers never type a
 *      version. Create seeds `1.0`; every publish bumps the MINOR (`1.0 →
 *      1.1 → 1.2`), and a *member* skill moving version or flipping
 *      visibility auto-bumps the revision in the background. Treat
 *      `latestVersion` as a change signal, not something you control.
 *   3. **Route scopes are the SKILL scopes.** Skillsets reuse
 *      `ornn:skill:{create,update,delete}` verbatim (CONVENTIONS.md §5.2);
 *      there is no `ornn:skillset:*` scope in v1. That reuse is explicitly
 *      not promised to be permanent.
 *
 * Two auth layers stack on the write paths: the NyxID *request scope*
 * decides whether the caller may reach the handler at all (401/403), and the
 * *object tier* (CONVENTIONS.md §5.4 — WRITE for publish/plugin-export,
 * ADMIN for delete/transfer) decides whether they may act on this particular
 * skillset (403).
 *
 * @module openapi/paths/skillsets
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
import { MAX_PAGE } from "../../shared/cursor";
import {
  SKILLSET_INITIAL_REVISION,
  SKILLSET_INSTRUCTIONS_MAX,
  SKILLSET_KINDS,
  SKILLSET_MAX_MEMBERS,
  SKILLSET_MIN_MEMBERS,
  SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS,
  createSkillsetSchema,
  publishSkillsetSchema,
  pluginExportSchema,
} from "../../domains/skillsets/types";

// ---------------------------------------------------------------------------
// Shared payload schemas
//
// The skillset domain serializes hand-written TypeScript interfaces
// (`SkillsetDetailResponse`, `SkillsetSearchItem`, `ClosureNode`) rather than
// Zod schemas, so the RESPONSE shapes below are hand-written JSON Schema.
// Every REQUEST body that has a Zod schema uses it directly.
// ---------------------------------------------------------------------------

const KIND_ENUM = [...SKILLSET_KINDS];

const kindSchema: JsonSchema = {
  type: "string",
  enum: KIND_ENUM,
  description:
    "`generic` — a plain curated bundle. `consensus-supported` — the author's CLAIM that the members are independent and comparable enough to run agent-side consensus over. The claim is metadata, not a guarantee Ornn verifies: Ornn packages and delivers the set, your runtime decides what to do with it.",
};

const memberVisibilityStateSchema: JsonSchema = {
  type: "string",
  enum: ["all-public", "restricted", "unresolvable"],
  description:
    "Derived visibility of this version's members (#1136) — the AUTHORITATIVE reach signal for a skillset. `all-public`: every member skill is public, so anyone can read and resolve the set. `restricted`: at least one member is private/shared, so only callers who can read every member see it at all. `unresolvable`: at least one member ref no longer resolves (deleted skill or version) — only the owner and platform admins see it, and closure resolution will fail until it is repaired by publishing a version without the broken ref.",
};

const grantSchema: JsonSchema = {
  type: "object",
  required: ["type", "id", "level"],
  description:
    "Typed access grant (#1123). Inert for READ on a skillset (#1136): readability is member-derived, so a `read` entry here confers no visibility at all — read `memberVisibilityState` instead. It is NOT inert for WRITES: a `write` entry is the object-tier WRITE ACL consulted by `PUT /skillsets/{id}` (publish) and `PUT /skillsets/{id}/plugin-export`, and it is the only way a caller who is neither the owner nor a platform admin gets through them; a `read` entry gets a 403 there. v1 exposes no endpoint that adds a skillset grant — create starts the array empty, and transfer-ownership only ever adds a `read` entry for the prior owner — so a `write` entry can only originate from pre-#1136 data.",
  properties: {
    type: { type: "string", enum: ["user", "org"], description: "Principal kind." },
    id: { type: "string", description: "NyxID person or org user_id." },
    level: { type: "string", enum: ["read", "write"], description: "Granted permission level." },
  },
};

const pluginConfigSchema: JsonSchema = {
  type: "object",
  description:
    "Owner-supplied listing overrides for the exported Claude Code plugin (#1157). Absent when the owner never set overrides — the mirror then falls back to the skillset's own `name` / `description` / `tags`. The install NAME and the plugin VERSION are never overridable: they are the skillset's name and its system-managed revision.",
  properties: {
    displayName: { type: "string", description: "Overrides the plugin's display name (defaults to the skillset `name`)." },
    description: { type: "string", description: "Overrides the plugin's description (defaults to the skillset `description`)." },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "Overrides the plugin's keywords (defaults to the skillset `tags`). Kebab-case, ≤ 20 entries.",
    },
  },
};

/**
 * `SkillsetDetailResponse` — the payload returned by create, read, publish,
 * plugin-export, and (nested under `skillset`) transfer-ownership.
 */
const skillsetDetailSchema: JsonSchema = {
  type: "object",
  description:
    "Full skillset detail AT ONE VERSION. `description` / `instructions` / `kind` / `tags` / `members` come from the returned version document; `guid` / `name` / `latestVersion` / ownership come from the skillset identity document. Compare `version` with `latestVersion` to tell whether you are looking at the head revision.",
  required: [
    "guid",
    "name",
    "description",
    "instructions",
    "kind",
    "tags",
    "members",
    "version",
    "latestVersion",
    "isPrivate",
    "createdBy",
    "sharedWithUsers",
    "sharedWithOrgs",
    "memberVisibilityState",
    "exportAsPlugin",
    "publicMemberCount",
    "unreadableMembers",
    "createdOn",
    "updatedOn",
  ],
  properties: {
    guid: {
      type: "string",
      format: "uuid",
      description: "Stable skillset id. Never changes, including across ownership transfer. Use this — not `name` — as your durable key.",
    },
    name: {
      type: "string",
      description: "Globally unique kebab-case handle, e.g. `pdf-review-set`. Fixed at create; a publish can never rename a skillset.",
    },
    description: { type: "string", description: "Short human-readable summary of this version (≤ 1024 chars)." },
    instructions: {
      type: "string",
      description: `The master prompt (#978) for THIS version — up to ${SKILLSET_INSTRUCTIONS_MAX} chars of markdown telling an agent how to orchestrate the members (ordering, which member to pick when, how to combine outputs). Stored and returned verbatim: Ornn never renders, sanitizes, templates, lints, or search-indexes it. Feed it to your model as-is alongside the resolved closure.`,
    },
    kind: kindSchema,
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Kebab-case discovery tags for this version, e.g. `[\"review\", \"pdf\"]`. Filterable via `GET /skillset-search?tags=`.",
    },
    members: {
      type: "array",
      items: { type: "string" },
      description: `The AUTHORED member refs of this version, e.g. \`["pdf-tools@1.0", "csv-tools@latest"]\`. Each is \`<name-or-guid>@<major.minor>\` or \`<name>@<dist-tag>\` — the same grammar skill \`depends-on\` uses. ${SKILLSET_MIN_MEMBERS}..${SKILLSET_MAX_MEMBERS} entries. These are refs, not resolved packages: call \`/closure\` to turn them into concrete versions plus their transitive dependencies.`,
    },
    version: {
      type: "string",
      description: "The revision this response describes, `<major>.<minor>` (e.g. `1.3`). Echoes the `version` query param when one was supplied, otherwise the latest.",
    },
    latestVersion: {
      type: "string",
      description: "The skillset's current head revision. System-assigned (#1162): it advances on every publish AND whenever a member skill's resolved version or visibility moves, so a change here is your signal to re-resolve the closure.",
    },
    isPrivate: {
      type: "boolean",
      description: "INERT legacy field (#1136). A skillset's real reach is `memberVisibilityState`; do not gate UI or client logic on this.",
    },
    createdBy: { type: "string", description: "Owner's NyxID person user_id. Changes only via transfer-ownership." },
    createdByEmail: { type: "string", description: "Owner's email, when the directory knows it." },
    createdByDisplayName: { type: "string", description: "Owner's human-readable name, when the directory knows it." },
    sharedWithUsers: {
      type: "array",
      items: { type: "string" },
      description: "INERT legacy per-user allow-list (#1136). Retained for back-compat only.",
    },
    sharedWithOrgs: {
      type: "array",
      items: { type: "string" },
      description: "INERT legacy per-org allow-list (#1136). Retained for back-compat only.",
    },
    grants: {
      type: "array",
      items: grantSchema,
      description:
        "The effective typed ACL (#1123). Inert for READ (#1136) — visibility is member-derived — but still load-bearing for writes: a `write` entry is what lets a caller who is neither the owner nor a platform admin publish a revision or toggle plugin export. Normally `[]`; see the item schema for where a non-empty array can come from.",
    },
    memberVisibilityState: memberVisibilityStateSchema,
    exportAsPlugin: {
      type: "boolean",
      description: "Whether the owner opted this skillset into export as a curated multi-skill Claude Code plugin in the public mirror (#1155). Toggle it with `PUT /skillsets/{id}/plugin-export`; create always starts it `false`.",
    },
    publicMemberCount: {
      type: "integer",
      description: `How many of THIS version's members are currently public AND resolvable, counted under the system actor and de-duplicated by skill name (#1161). Only this public subset is ever bundled into the exported plugin, so \`members.length - publicMemberCount\` is the number of members the export drops. Enabling plugin export requires this to be ≥ ${SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS}.`,
    },
    pluginConfig: pluginConfigSchema,
    unreadableMembers: {
      type: "array",
      items: { type: "string" },
      description: "Member refs THIS caller cannot read at this version (#1136). Request-scoped, never stored. Always `[]` for non-owners — they receive a 404 instead of a partial set — so a non-empty array means you are the owner or a platform admin and the set is broken for you: re-grant access on the listed skills, or publish a version without them.",
    },
    createdOn: { type: "string", format: "date-time", description: "ISO-8601 timestamp the skillset was created." },
    updatedOn: { type: "string", format: "date-time", description: "ISO-8601 timestamp of the last owner-driven change to the identity document." },
  },
};

/** One entry of `GET /skillsets/{idOrName}/versions`. */
const skillsetVersionItemSchema: JsonSchema = {
  type: "object",
  required: ["version", "kind", "memberCount", "createdBy", "createdOn"],
  properties: {
    version: { type: "string", description: "Revision string, `<major>.<minor>` (e.g. `1.2`). Pass it back as the `version` query param on the read or closure endpoints." },
    kind: kindSchema,
    memberCount: { type: "integer", description: "Number of authored member refs in this revision." },
    createdBy: { type: "string", description: "NyxID person user_id that cut this revision. For a system auto-bump (#1162) this carries the prior revision's author forward." },
    createdByEmail: { type: "string", description: "Author's email, when known." },
    createdByDisplayName: { type: "string", description: "Author's display name, when known." },
    createdOn: { type: "string", format: "date-time", description: "ISO-8601 timestamp this revision was cut." },
  },
};

/** One node of the resolved delivery closure (the shared #968 `ClosureNode`). */
const closureNodeSchema: JsonSchema = {
  type: "object",
  required: ["ref", "name", "version", "depth"],
  properties: {
    ref: { type: "string", description: "Canonical `<name>@<version>` for this node, e.g. `pdf-tools@1.0`. Dist-tags and aliases are already resolved, so equivalent refs collapse onto one node." },
    name: { type: "string", description: "Skill name. Unique across the closure — one name resolves to exactly one version, otherwise the request fails with `dependency_conflict`." },
    version: { type: "string", description: "Concrete `<major>.<minor>` version to install." },
    guid: { type: "string", format: "uuid", description: "Stable skill GUID, when the loader knew it. Prefer it over `name` when downloading." },
    skillHash: { type: "string", description: "Package content hash for the resolved version, when known. Use it to skip re-downloading a package you already hold." },
    depth: { type: "integer", description: "Maximum distance from any root member: `0` for the skillset's own members, `1+` for transitive dependencies. Informational only — the array order is already install-safe." },
  },
};

/** One row of `GET /skillset-search`. */
const skillsetSearchItemSchema: JsonSchema = {
  type: "object",
  required: [
    "guid",
    "name",
    "description",
    "kind",
    "tags",
    "memberCount",
    "latestVersion",
    "isPrivate",
    "memberVisibilityState",
    "createdBy",
    "createdOn",
    "updatedOn",
  ],
  properties: {
    guid: { type: "string", format: "uuid", description: "Stable skillset id — feed it to the read / closure endpoints." },
    name: { type: "string", description: "Unique kebab-case handle." },
    description: { type: "string", description: "Short summary, taken from the skillset identity document (i.e. the latest revision's description)." },
    kind: kindSchema,
    tags: { type: "array", items: { type: "string" }, description: "Discovery tags of the latest revision." },
    memberCount: {
      type: "integer",
      description: "ALWAYS `0` on search results. Member lists live on the version document and search deliberately avoids a per-row extra read; fetch `GET /skillsets/{idOrName}` (or `/closure`) for the real member set. Do not render this value.",
    },
    latestVersion: { type: "string", description: "Head revision, `<major>.<minor>`." },
    isPrivate: { type: "boolean", description: "INERT legacy field (#1136) — read `memberVisibilityState` instead." },
    memberVisibilityState: memberVisibilityStateSchema,
    createdBy: { type: "string", description: "Owner's NyxID person user_id." },
    createdByEmail: { type: "string", description: "Owner's email, when known." },
    createdByDisplayName: { type: "string", description: "Owner's display name, when known." },
    createdOn: { type: "string", format: "date-time", description: "ISO-8601 creation timestamp." },
    updatedOn: { type: "string", format: "date-time", description: "ISO-8601 timestamp of the last identity-document change." },
  },
};

const skillsetSearchPayloadSchema: JsonSchema = {
  type: "object",
  required: ["items", "total", "page", "pageSize", "totalPages", "meta"],
  description:
    "A page of discovery results. Both pagination styles are present: `page` / `pageSize` / `total` / `totalPages` for offset paging, and `meta.nextCursor` for the cursor style CONVENTIONS.md §4.3 prescribes. Prefer the cursor — it is the forward-compatible one.",
  properties: {
    items: { type: "array", items: skillsetSearchItemSchema, description: "Matching skillsets, newest first." },
    total: {
      type: "integer",
      description: "Total matches. Exact for `scope=public` / `scope=mine` (counted in MongoDB); for the live-filtered scopes (`private`, `mixed`, `shared-with-me`) it is the size of the post-filter candidate set, which is capped at 500 candidates per request — treat it as a lower bound there.",
    },
    page: { type: "integer", description: "1-indexed page actually served — the decoded `cursor` page when a cursor was supplied, otherwise `page`." },
    pageSize: { type: "integer", description: "Effective page size: `limit` when supplied, otherwise `pageSize`." },
    totalPages: { type: "integer", description: "`ceil(total / pageSize)`." },
    meta: {
      type: "object",
      required: ["limit", "hasMore"],
      description: "Cursor-pagination metadata per CONVENTIONS.md §4.3.",
      properties: {
        limit: { type: "integer", description: "Effective page size for this response." },
        hasMore: { type: "boolean", description: "Whether at least one more page exists." },
        nextCursor: {
          type: "string",
          description: "Opaque token for the next page — pass it back as `?cursor=`. Omitted on the last page. NEVER parse or construct it; the encoding is server-internal and will change.",
        },
      },
    },
  },
};

/**
 * RFC 9239 headers `middleware/rateLimit` emits on EVERY `/skillset-search`
 * response, success or 429. The limiter is mounted with a fixed 60-request /
 * 60-second window under the `skillset-search` label, keyed per authenticated
 * user and otherwise per trusted proxy hop.
 */
const rateLimitHeaders: Record<string, unknown> = {
  "RateLimit-Limit": {
    description: "Requests allowed in the current window — 60 per 60 seconds for this endpoint.",
    schema: { type: "integer", examples: [60] },
  },
  "RateLimit-Remaining": {
    description: "Requests left in the current window for this caller. Self-throttle as it approaches 0.",
    schema: { type: "integer", examples: [59] },
  },
  "RateLimit-Reset": {
    description: "Seconds until the window resets and `RateLimit-Remaining` returns to `RateLimit-Limit`.",
    schema: { type: "integer", examples: [42] },
  },
};

/** The same three headers, plus the `Retry-After` only a 429 carries. */
const rateLimitedHeaders: Record<string, unknown> = {
  ...rateLimitHeaders,
  "Retry-After": {
    description: "Seconds to wait before retrying — the same value as `RateLimit-Reset`. Sent only on the 429.",
    schema: { type: "integer", examples: [42] },
  },
};

/**
 * Attach response headers to the RFC 7807 responses `problemResponses` built.
 * The problem body stays exactly as the shared helper declares it; only the
 * `headers` map is added, so an error response is never hand-rolled here.
 */
function withHeaders(
  responses: Record<string, unknown>,
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => [
      status,
      { ...(response as Record<string, unknown>), headers },
    ]),
  );
}

/**
 * Body for `POST /skillsets/{id}/transfer-ownership`. Hand-written: the
 * route's Zod schema is a module-private const inside
 * `domains/skillsets/routes.ts` and is not exported.
 */
const transferOwnershipBodySchema: JsonSchema = {
  type: "object",
  required: ["newOwnerUserId"],
  properties: {
    newOwnerUserId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "NyxID person user_id of the new owner. Must be a user who has signed in to Ornn at least once (Ornn resolves them against its own user directory, not NyxID directly) and must differ from the current owner.",
    },
  },
};

const SKILLSET_ID_EXAMPLE = "3f1c0a4e-9c2b-4a1e-9e3a-6b5d2f7c8a10";

const detailExample = {
  guid: SKILLSET_ID_EXAMPLE,
  name: "pdf-review-set",
  description: "Extract, diff, and summarise PDF contracts.",
  instructions:
    "Run `pdf-tools` first to extract text, feed its output to `contract-diff`, then summarise with `report-writer`. Never call `report-writer` on raw PDF bytes.",
  kind: "consensus-supported",
  tags: ["review", "pdf"],
  members: ["pdf-tools@1.0", "contract-diff@2.1", "report-writer@latest"],
  version: "1.0",
  latestVersion: "1.0",
  isPrivate: true,
  createdBy: "usr_01HQ8F3K2N",
  sharedWithUsers: [],
  sharedWithOrgs: [],
  grants: [],
  memberVisibilityState: "all-public",
  exportAsPlugin: false,
  publicMemberCount: 3,
  unreadableMembers: [],
  createdOn: "2026-07-14T09:31:02.481Z",
  updatedOn: "2026-07-14T09:31:02.481Z",
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Build the `/skillsets/*` + `/skillset-search` path map.
 *
 * @param prefix API mount prefix — always `/api/v1` (see `buildSpec`).
 */
export function skillsetsPaths(prefix: string): PathMap {
  return {
    [`${prefix}/skillsets`]: {
      post: {
        summary: "Create a skillset",
        description: [
          "Create a new skillset — a curated bundle of 2..100 member skills plus the master prompt that explains how to use them together.",
          `Every member ref is validated BEFORE anything is written: each must resolve to an existing skill version, and the union of all members' dependency closures must be conflict-free and acyclic. A bad ref therefore fails the whole request with \`skill_dependency_not_found\` (404) rather than creating a half-broken set. Validation runs as the system actor, so you may legitimately bundle a private skill you own or were granted — the closure READ is scoped to the caller separately.`,
          `You do NOT choose a version: the system seeds \`${SKILLSET_INITIAL_REVISION}\` and auto-bumps the minor from then on (#1162). You also do not choose visibility — a skillset's reach is derived from its members (#1136), so a set of public skills is immediately public and a set containing one private skill is \`restricted\`. Plugin export always starts OFF; enable it afterwards via \`PUT /skillsets/{id}/plugin-export\`.`,
          "Names are globally unique and reserved verbs are rejected, so treat 409 as \"pick another name\" and the `reserved_name` 400 as \"this word is taken by the routing grammar\". The response body is the same detail object `GET /skillsets/{idOrName}` returns, and `Location` points at the canonical URL of the new skillset.",
          "Requires the `ornn:skill:create` request scope — skillsets reuse the skill scopes verbatim (CONVENTIONS.md §5.2).",
        ].join("\n\n"),
        operationId: "createSkillset",
        tags: ["Skillsets"],
        security: bearerAuth(),
        requestBody: jsonBody(
          createSkillsetSchema,
          [
            "The skillset to create. `instructions` (the master prompt) is REQUIRED. `kind` defaults to `generic` and `tags` to `[]`.",
            `Each entry of \`members\` must be \`<name-or-guid>@<major.minor>\` (e.g. \`pdf-tools@1.0\`) or \`<name>@<dist-tag>\` (e.g. \`pdf-tools@latest\`) — the same grammar skill \`depends-on\` uses. Semver ranges (\`^1.0\`) and patch digits (\`1.2.3\`) are rejected, as is a \`skillset:\`-prefixed ref: v1 has no nested skillsets, members are skills only. That grammar is enforced by refinements that do not survive into this JSON Schema, so validate it client-side rather than trusting \`maxLength\` alone.`,
            "There is deliberately no `version` and no visibility field in this body; both are system-derived. Unknown properties are stripped rather than rejected.",
          ].join(" "),
          {
            example: {
              name: "pdf-review-set",
              description: "Extract, diff, and summarise PDF contracts.",
              instructions:
                "Run `pdf-tools` first to extract text, feed its output to `contract-diff`, then summarise with `report-writer`.",
              kind: "consensus-supported",
              tags: ["review", "pdf"],
              members: ["pdf-tools@1.0", "contract-diff@2.1", "report-writer@latest"],
            },
          },
        ),
        responses: {
          ...jsonResponse(skillsetDetailSchema, `Skillset created at revision ${SKILLSET_INITIAL_REVISION}.`, {
            status: 201,
            example: detailExample,
            headers: {
              Location: {
                description: "Canonical URL of the created skillset, e.g. `/api/v1/skillsets/3f1c0a4e-9c2b-4a1e-9e3a-6b5d2f7c8a10`.",
                schema: { type: "string" },
              },
            },
          }),
          ...problemResponses(
            {
              400: "Bad request — the body failed validation (`invalid_skillset`; see `detail`), or the requested name is a reserved routing verb (`reserved_name`).",
            },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:create` request scope." },
            {
              404: "Not found — a member ref does not resolve to an existing, readable skill version (`skill_dependency_not_found`). The offending ref is named in `detail`. Nothing was created.",
            },
            {
              409: "Conflict — the name is already taken (`skillset_name_exists`), two members pin different versions of the same skill (`dependency_conflict`), the closure exceeds 500 nodes (`dependency_conflict`), or the member graph contains a cycle (`dependency_cycle`).",
            },
          ),
        },
      },
    },

    [`${prefix}/skillset-search`]: {
      get: {
        summary: "Discover skillsets by kind, tags, keyword, or scope",
        description: [
          "Filter-based discovery over the skillset registry. Deliberately plain: exact `kind` equality, an ALL-match on `tags`, and a case-insensitive substring match on name + description. There is no semantic/LLM ranking, no facets, and no popularity signal — use `GET /skill-search` when you want semantic retrieval over individual skills.",
          "Visibility is enforced live, not cached. `scope=public` and `scope=mine` are answered straight from MongoDB using the denormalized `memberVisibilityState`, so they paginate exactly. `private`, `mixed`, and `shared-with-me` instead fetch up to 500 candidates and then re-check, per candidate, whether YOU can read every member — restricted skillsets are never leaked, but `total` becomes a lower bound and deep pages may be incomplete on a very large registry.",
          "Anonymous calls are allowed and are silently forced to `scope=public`; sending any other scope without a token does not error, it just returns public results.",
          "Rate limited to 60 requests per minute per user (per source IP when anonymous). Responses always carry `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`; a 429 additionally carries `Retry-After`.",
        ].join("\n\n"),
        operationId: "searchSkillsets",
        tags: ["Skillsets"],
        security: optionalAuth(),
        parameters: [
          queryParam(
            "q",
            "Free-text keyword. Case-insensitive substring match against name and description only — not tags, not instructions, not member names. Max 200 characters. Omit to match everything in scope.",
            { type: "string", maxLength: 200, examples: ["pdf"] },
          ),
          queryParam(
            "kind",
            "Exact match on skillset kind. Omit to match both kinds.",
            { type: "string", enum: KIND_ENUM },
          ),
          queryParam(
            "tags",
            "Comma-separated tag list; a skillset matches only if it carries ALL listed tags (AND, not OR). Whitespace around entries is trimmed and empty entries are dropped. Note this is the one CSV-shaped parameter in the API — repeated keys are NOT supported here.",
            { type: "string", examples: ["review,pdf"] },
          ),
          queryParam(
            "scope",
            "Visibility slice to search. `public` (default) — skillsets whose members are all public. `mine` — skillsets you own, any state. `shared-with-me` / `private` / `mixed` — live-checked slices that additionally include restricted skillsets you can read every member of. Anonymous callers are forced to `public` regardless of what they send.",
            {
              type: "string",
              enum: ["public", "private", "mixed", "shared-with-me", "mine"],
              default: "public",
            },
          ),
          queryParam(
            "cursor",
            "Opaque pagination token from a previous response's `meta.nextCursor`. When present it OVERRIDES `page`. Never parse or construct it — a malformed or stale-format token is rejected with 400 `invalid_cursor` rather than silently restarting at page 1. Max 2048 characters.",
            { type: "string", maxLength: 2048 },
          ),
          queryParam(
            "limit",
            "Page size, 1..100. Takes precedence over `pageSize` when both are sent. This is the CONVENTIONS.md §4.3 spelling — prefer it.",
            { type: "integer", minimum: 1, maximum: 100 },
          ),
          queryParam(
            "pageSize",
            "Legacy page-size spelling, 1..100, default 20. Used only when `limit` is absent.",
            { type: "integer", minimum: 1, maximum: 100, default: 20 },
          ),
          queryParam(
            "page",
            `Legacy 1-indexed offset page, 1..${MAX_PAGE}, default 1. Ignored when \`cursor\` is supplied. The upper bound exists so a forged deep page cannot drive an unbounded collection scan.`,
            { type: "integer", minimum: 1, maximum: MAX_PAGE, default: 1 },
          ),
        ],
        responses: {
          ...jsonResponse(skillsetSearchPayloadSchema, "A page of matching skillsets.", {
            headers: rateLimitHeaders,
          }),
          ...problemResponses({
            400: "Bad request — a query parameter failed validation (`invalid_query`; see `detail`), or `cursor` is malformed / from a previous API version (`invalid_cursor`).",
          }),
          ...withHeaders(
            problemResponses({
              429: "Rate limited (`rate_limited`) — more than 60 searches in the last minute for this caller. Back off for `Retry-After` seconds; `RateLimit-Reset` carries the same number.",
            }),
            rateLimitedHeaders,
          ),
        },
      },
    },

    [`${prefix}/skillsets/{idOrName}/closure`]: {
      get: {
        summary: "Resolve a skillset's full delivery closure",
        description: [
          "The one call an agent needs to install a skillset. Returns the version's master prompt plus the union of every member skill AND each member's transitive dependency closure (#968) — deduplicated by canonical `<name>@<version>` and topologically sorted so dependencies always precede the nodes that pin them. Install `items` in array order and you can never install a dependent before its dependency.",
          "`instructions` is a ROOT sibling of `items`, not a node property: it is the version's master prompt, returned verbatim, and it is what you put in your agent's system context before executing anything from the set.",
          "Resolution is scoped to the CALLER, node by node. Anonymous callers can resolve a fully public skillset; the moment any node — a member or one of its transitive dependencies — is not readable by you, the whole request fails with `skill_dependency_not_found` (404) naming that ref. Existence is never leaked as a 403, and a partial closure is never returned.",
          "This endpoint does not download packages. Take each node's `name`/`guid` and `version` and fetch `GET /skills/{idOrName}/versions/{version}/download`, or `GET /skills/{idOrName}/json` when you want file contents rather than a ZIP. Use `GET /skillsets/{idOrName}` first if you only need metadata — this call is heavier because it walks the whole graph.",
        ].join("\n\n"),
        operationId: "getSkillsetClosure",
        tags: ["Skillsets"],
        security: optionalAuth(),
        parameters: [
          pathParam(
            "idOrName",
            "Skillset GUID or unique kebab-case name. GUID is tried first, then name — so a name that looks like a UUID resolves as a GUID.",
            { type: "string" },
            "pdf-review-set",
          ),
          queryParam(
            "version",
            "Revision to resolve, `<major>.<minor>` (e.g. `1.2`). Defaults to the skillset's `latestVersion`. An empty value is treated as absent. Unlike the read endpoint, this one PARSES the version, so a syntactically invalid value (e.g. `1.2.3`, `^1.0`, or `01.2` — both parts must be non-negative integers with no leading zeroes) is a 400, not a 404.",
            { type: "string", pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$", examples: ["1.2"] },
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["instructions", "items"],
              properties: {
                instructions: {
                  type: "string",
                  description: "The resolved version's master prompt (#978), verbatim. Load this into agent context before running any member.",
                },
                items: {
                  type: "array",
                  items: closureNodeSchema,
                  description: "The deduplicated closure in deps-first topological order. Members appear at `depth: 0`; their transitive dependencies at `depth >= 1`.",
                },
              },
            },
            "The resolved delivery closure plus the version's master prompt.",
            {
              example: {
                instructions: "Run `pdf-tools` first, then feed its output to `contract-diff`.",
                items: [
                  { ref: "text-utils@1.4", name: "text-utils", version: "1.4", guid: "8c2e1b90-77aa-4d1e-b6f4-1c0d9a3e2f55", depth: 1 },
                  { ref: "pdf-tools@1.0", name: "pdf-tools", version: "1.0", guid: "b1f4a7c2-2d55-4c8e-9a01-7f3e5c6d8b11", depth: 0 },
                  { ref: "contract-diff@2.1", name: "contract-diff", version: "2.1", guid: "d9e0c3a6-5b41-4f27-8a3d-2e6b9c4f1a77", depth: 0 },
                ],
              },
            },
          ),
          ...problemResponses(
            { 400: "Bad request — the `version` query parameter is not a valid `<major>.<minor>` string (`invalid_version`). Semver ranges, patch digits, and leading zeroes (`01.2`, `1.02`) are all rejected." },
            {
              404: "Not found — no such skillset (`skillset_not_found`), the requested revision does not exist (`skillset_version_not_found`), or some node of the closure does not exist or is not readable by you (`skill_dependency_not_found`). All three are flat 404s: a private member is never distinguished from a missing one.",
            },
            {
              409: "Conflict — the member graph cannot be delivered: two nodes pin different versions of the same skill (`dependency_conflict`), the closure exceeds 500 nodes (`dependency_conflict`), or there is a cycle (`dependency_cycle`). Only the skillset owner can fix this, by publishing a revision with a compatible member set.",
            },
          ),
        },
      },
    },

    [`${prefix}/skillsets/{idOrName}/versions`]: {
      get: {
        summary: "List a skillset's published revisions",
        description: [
          "List every published revision of a skillset, newest first. Each entry is a light summary (revision string, kind, member count, author, timestamp) — fetch `GET /skillsets/{idOrName}?version=<v>` for a revision's full member list and master prompt.",
          "Expect more revisions than you published. Revisions are system-assigned (#1162): the minor auto-bumps on every owner publish AND whenever a member skill's resolved version moves or its visibility flips, so a set you publish once may accumulate revisions on its own. That is the mechanism that makes downstream consumers (e.g. an exported Claude Code plugin) see an update signal.",
          "The same member-derived read gate as the read endpoint applies, evaluated against the LATEST revision: if you cannot read every current member, you get a flat 404 — identical to a missing skillset — even for older revisions you once could read.",
        ].join("\n\n"),
        operationId: "listSkillsetVersions",
        tags: ["Skillsets"],
        security: optionalAuth(),
        parameters: [
          pathParam(
            "idOrName",
            "Skillset GUID or unique kebab-case name. GUID is tried first, then name.",
            { type: "string" },
            "pdf-review-set",
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
                  items: skillsetVersionItemSchema,
                  description: "Published revisions, newest first. Never empty for a readable skillset — every skillset has at least its create revision.",
                },
              },
            },
            "The skillset's published revisions, newest first.",
            {
              example: {
                items: [
                  { version: "1.1", kind: "consensus-supported", memberCount: 3, createdBy: "usr_01HQ8F3K2N", createdByDisplayName: "Ada Lovelace", createdOn: "2026-07-20T11:04:55.002Z" },
                  { version: "1.0", kind: "generic", memberCount: 2, createdBy: "usr_01HQ8F3K2N", createdByDisplayName: "Ada Lovelace", createdOn: "2026-07-14T09:31:02.481Z" },
                ],
              },
            },
          ),
          ...problemResponses({
            404: "Not found — no such skillset, its latest revision is missing, or you cannot read every member of that revision (`skillset_not_found` / `skillset_version_not_found`). Restricted skillsets are indistinguishable from missing ones by design.",
          }),
        },
      },
    },

    [`${prefix}/skillsets/{idOrName}`]: {
      get: {
        summary: "Read a skillset by GUID or name",
        description: [
          "Fetch a skillset's metadata at one revision: the master prompt, the authored member refs, the derived visibility state, and the plugin-export status. This is the cheap metadata read — it does NOT resolve members into concrete versions or walk their dependencies. Call `GET /skillsets/{idOrName}/closure` when you actually need to install the set.",
          "Access is member-derived (#1136), not owner-set. You may read a skillset iff you may read every one of its members at the requested revision. Non-owners who fail that test get a flat 404 — never a 403, and never a partial member list — so the existence of a private member is not leaked. Owners and platform admins always see the skillset and additionally get `unreadableMembers` populated with the refs THEY have lost access to, which is the repair signal.",
          "Both a GUID and the unique kebab-case name work as `idOrName`; the GUID lookup is tried first. Ask for a historical revision with `?version=`; anything unrecognised is a 404 rather than a validation error on this endpoint.",
        ].join("\n\n"),
        operationId: "getSkillset",
        tags: ["Skillsets"],
        security: optionalAuth(),
        parameters: [
          pathParam(
            "idOrName",
            "Skillset GUID or unique kebab-case name. GUID is tried first, then name.",
            { type: "string" },
            "pdf-review-set",
          ),
          queryParam(
            "version",
            "Revision to read, `<major>.<minor>` (e.g. `1.2`). Defaults to the skillset's `latestVersion`; an empty value is treated as absent. This endpoint does not validate the shape — an unknown or malformed revision simply yields 404 `skillset_version_not_found`.",
            { type: "string", examples: ["1.2"] },
          ),
        ],
        responses: {
          ...jsonResponse(skillsetDetailSchema, "The skillset at the requested (or latest) revision.", { example: detailExample }),
          ...problemResponses({
            404: "Not found — no such skillset (`skillset_not_found`), the requested revision does not exist (`skillset_version_not_found`), or you cannot read every member at that revision. All three are the same flat 404 on purpose.",
          }),
        },
      },
    },

    [`${prefix}/skillsets/{id}`]: {
      put: {
        summary: "Publish a new skillset revision",
        description: [
          "Append a new immutable revision. Published revisions are never mutated — this writes a new version document and advances the skillset's `latestVersion`, leaving every prior revision byte-identical for anyone who pinned it.",
          "The revision number is NOT yours to choose (#1162): the system bumps the minor off the current latest (`1.0 → 1.1 → 1.2`; the major never auto-bumps). Any `version` field you send is ignored by validation.",
          "`instructions` and `members` are REQUIRED on every publish. `instructions` has no carry-forward — each revision must state its own master prompt explicitly — whereas `description`, `kind`, and `tags` inherit the previous values when omitted. `name` is immutable and cannot be published over. Members are re-validated exactly as at create: every ref must resolve, and the union closure must be conflict-free and acyclic, checked BEFORE any write.",
          "Publishing does not touch plugin export — `exportAsPlugin` and `pluginConfig` are only ever changed by `PUT /skillsets/{id}/plugin-export`. It does, however, re-derive the visibility state from the new member set, so swapping in a private member can flip a public skillset to `restricted` and drop it out of other people's search results.",
          "Requires the `ornn:skill:update` request scope PLUS the object WRITE tier (CONVENTIONS.md §5.4): the owner, a platform admin, or a `write` grantee. A `read` grantee gets 403.",
        ].join("\n\n"),
        operationId: "publishSkillsetVersion",
        tags: ["Skillsets"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Skillset GUID. Unlike the read endpoints, the write paths accept the GUID only — a name is not resolved here.",
            { type: "string", format: "uuid" },
            SKILLSET_ID_EXAMPLE,
          ),
        ],
        requestBody: jsonBody(
          publishSkillsetSchema,
          [
            "The new revision's content. `instructions` and `members` are required; `description`, `kind`, and `tags` inherit from the previous revision when omitted.",
            `Each entry of \`members\` must be \`<name-or-guid>@<major.minor>\` or \`<name>@<dist-tag>\`; semver ranges, patch digits, and \`skillset:\`-prefixed refs are rejected. That grammar comes from refinements that do not survive into this JSON Schema, so validate it client-side.`,
            "Sending `name` or `version` has no effect — the name is immutable and the revision is system-assigned. Unknown properties are stripped rather than rejected.",
          ].join(" "),
          {
            example: {
              description: "Extract, diff, and summarise PDF contracts.",
              instructions: "Run `pdf-tools`, then `contract-diff`, then `report-writer`. Stop after `contract-diff` when no differences are found.",
              kind: "consensus-supported",
              tags: ["review", "pdf"],
              members: ["pdf-tools@1.1", "contract-diff@2.1", "report-writer@latest"],
            },
          },
        ),
        responses: {
          ...jsonResponse(skillsetDetailSchema, "The skillset at its newly published revision.", {
            example: { ...detailExample, version: "1.1", latestVersion: "1.1" },
          }),
          ...problemResponses(
            { 400: "Bad request — the body failed validation (`invalid_skillset`; see `detail`), e.g. a missing `instructions`, fewer than 2 members, or a member ref using a semver range." },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:update` scope, or you hold only READ on this skillset (`forbidden`). Publishing needs the WRITE tier." },
            { 404: "Not found — no skillset with this GUID (`skillset_not_found`), or a member ref does not resolve to an existing skill version (`skill_dependency_not_found`). Nothing was written." },
            {
              409: "Conflict — the member graph is undeliverable (`dependency_conflict` / `dependency_cycle`), or a concurrent publish already claimed the next revision (`skillset_version_exists`). Re-read `latestVersion` and retry.",
            },
          ),
        },
      },
      delete: {
        summary: "Delete a skillset and all its revisions",
        description: [
          "Permanently delete the skillset identity document and cascade-delete every published revision. This is irreversible and there is no soft-delete or restore.",
          "Member skills are NOT touched — a skillset is pure metadata over refs, so deleting it removes the bundle and its master prompt, never any skill package. Anyone who had pinned a revision loses the ability to resolve it; re-creating a skillset with the same name produces a fresh GUID starting at revision `1.0`.",
          `If the skillset was exported as a Claude Code plugin it drops out of the public mirror shortly after this call (the reconcile is fire-and-forget, so the removal is not synchronous with this response).`,
          "Returns 200 with `{ success: true }`, not 204. Requires the `ornn:skill:delete` request scope PLUS the object ADMIN tier (CONVENTIONS.md §5.4): only the owner or a platform admin. A `write` grantee is deliberately not enough.",
        ].join("\n\n"),
        operationId: "deleteSkillset",
        tags: ["Skillsets"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Skillset GUID. The write paths do not resolve names.",
            { type: "string", format: "uuid" },
            SKILLSET_ID_EXAMPLE,
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["success"],
              properties: { success: { type: "boolean", description: "Always `true`. A failure arrives as an RFC 7807 problem body instead." } },
            },
            "Skillset and all of its revisions were deleted.",
            { example: { success: true } },
          ),
          ...problemResponses(
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:delete` scope, or you are neither the owner nor a platform admin (`forbidden`). Deletion is ADMIN-tier; a `write` grant does not qualify." },
            { 404: "Not found — no skillset with this GUID (`skillset_not_found`). Deletion is not idempotent: a second call on the same GUID returns 404." },
          ),
        },
      },
    },

    [`${prefix}/skillsets/{id}/plugin-export`]: {
      put: {
        summary: "Enable or disable Claude Code plugin export",
        description: [
          "Toggle whether this skillset is published into Ornn's public mirror as ONE curated multi-skill Claude Code plugin (#1155), and persist the owner's listing overrides (#1157).",
          `Only the PUBLIC, resolvable subset of the members is ever bundled — private or broken members are silently dropped from the export, so a \`restricted\` skillset can still export its public part. Because a bundle below the floor is not a meaningful set, enabling requires at least ${SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS} public resolvable members in the latest revision; check \`publicMemberCount\` on the detail response before calling with \`enabled: true\`. Disabling is always permitted and additionally clears any stored overrides.`,
          "`displayName`, `description`, and `keywords` are OPTIONAL listing overrides. Omit them (or send blank strings) and the mirror falls back to the skillset's own `name` / `description` / `tags`. Two fields are deliberately NOT overridable: the install name (always the skillset name, which is what makes `/plugin install <name>@<repo>` collision-free) and the plugin version (always the system-managed skillset revision, which is what gives Claude Code its update signal).",
          "This is a separate endpoint from publish on purpose — a publish never flips the opt-in, and this call never cuts a revision. The mirror reconcile it triggers is fire-and-forget, so the plugin appears or disappears shortly AFTER this response, not with it.",
          "Requires the `ornn:skill:update` request scope PLUS the object WRITE tier (CONVENTIONS.md §5.4).",
        ].join("\n\n"),
        operationId: "setSkillsetPluginExport",
        tags: ["Skillsets"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Skillset GUID. The write paths do not resolve names.",
            { type: "string", format: "uuid" },
            SKILLSET_ID_EXAMPLE,
          ),
        ],
        requestBody: jsonBody(
          pluginExportSchema,
          "`enabled` is required; the three override fields are optional and only meaningful when enabling. Sending `enabled: false` clears any stored overrides.",
          {
            example: {
              enabled: true,
              displayName: "PDF Review Set",
              description: "Extract, diff, and summarise PDF contracts.",
              keywords: ["pdf", "review", "contracts"],
            },
          },
        ),
        responses: {
          ...jsonResponse(skillsetDetailSchema, "The skillset detail with the updated `exportAsPlugin` flag and `pluginConfig` overrides.", {
            example: {
              ...detailExample,
              exportAsPlugin: true,
              pluginConfig: { displayName: "PDF Review Set", description: "Extract, diff, and summarise PDF contracts.", keywords: ["pdf", "review", "contracts"] },
            },
          }),
          ...problemResponses(
            { 400: "Bad request — the body failed validation (`invalid_plugin_export`; see `detail`), e.g. a missing `enabled`, or a keyword that is not kebab-case." },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:update` scope, or you hold only READ on this skillset (`forbidden`)." },
            { 404: "Not found — no skillset with this GUID (`skillset_not_found`)." },
            {
              409: `Conflict — \`skillset_too_few_public_members\`: enabling was refused because the latest revision has fewer than ${SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS} public, resolvable members. Make more members public (or publish a revision that includes them) and retry.`,
            },
          ),
        },
      },
    },

    [`${prefix}/skillsets/{id}/transfer-ownership`]: {
      post: {
        summary: "Transfer skillset ownership to another user",
        description: [
          "Hand a skillset to another Ornn user (#1123). The transfer is immediate and irreversible from the caller's side — only the NEW owner (or a platform admin) can transfer it back.",
          "After the transfer: `createdBy` and the owner labels point at the target; the prior owner is recorded as an explicit READ grantee, for parity with the skill transfer path; and any pre-existing grant held by the new owner is dropped, since implicit ownership supersedes it. The skillset's GUID, name, revisions, and member set are all unchanged, and no new revision is cut.",
          "Do not read that READ grant as preserved access: a skillset's readability is member-derived (#1136) and never consults grants, so the prior owner keeps visibility only for as long as they can read every member skill — and they lose the owner-only view (`unreadableMembers`, plus seeing the set at all while a member is unreadable) immediately.",
          "The target must be a known Ornn user — someone who has signed in at least once, so Ornn's own user directory has a row for them. The lookup happens INSIDE the authorization boundary: a caller who is not the owner gets 403 before any lookup runs, so this endpoint cannot be used to probe whether a given user id exists.",
          "Requires the `ornn:skill:update` request scope PLUS the object ADMIN tier (CONVENTIONS.md §5.4): owner or platform admin only. A `write` grantee gets 403 — matching the equivalent skill endpoint.",
        ].join("\n\n"),
        operationId: "transferSkillsetOwnership",
        tags: ["Skillsets"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Skillset GUID. The write paths do not resolve names.",
            { type: "string", format: "uuid" },
            SKILLSET_ID_EXAMPLE,
          ),
        ],
        requestBody: jsonBody(transferOwnershipBodySchema, "The new owner's NyxID person user_id.", {
          example: { newOwnerUserId: "usr_01HQ9M7B4T" },
        }),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["skillset"],
              properties: {
                skillset: skillsetDetailSchema,
              },
            },
            "Ownership transferred. The payload nests the updated skillset detail under `skillset` — note this differs from the other write endpoints, which return the detail object directly.",
            { example: { skillset: { ...detailExample, createdBy: "usr_01HQ9M7B4T" } } },
          ),
          ...problemResponses(
            {
              400: "Bad request — the body failed validation (`invalid_transfer`; `newOwnerUserId` must be a 1..128-char string), or the target is not a known Ornn user (`invalid_transfer_target`) because they have never signed in to Ornn.",
            },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:update` scope, or you are neither the owner nor a platform admin (`forbidden`). Transfer is ADMIN-tier." },
            { 404: "Not found — no skillset with this GUID (`skillset_not_found`)." },
            { 409: "Conflict — `ownership_conflict`: the target already owns this skillset. Nothing was changed." },
          ),
        },
      },
    },
  };
}
