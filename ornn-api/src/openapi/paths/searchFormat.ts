/**
 * OpenAPI path definitions for the **search, facets, and skill-format**
 * surface (#1214).
 *
 * Two related but distinct groups live here:
 *
 *  - **Search** (`tags: ["Search"]`) — the registry discovery surface.
 *    `GET /skill-search` is the one endpoint an agent uses to *find*
 *    skills (keyword or LLM-ranked semantic). The three
 *    `/skill-facets/*` endpoints return the distinct filter values
 *    (tags, authors, NyxID system services) that are actually present
 *    inside the caller's visibility, so a client can build filter UI /
 *    filter arguments without guessing. `GET /skill-counts` returns the
 *    per-scope totals in one round-trip.
 *
 *  - **Format** (`tags: ["Format"]`) — the SKILL.md package contract.
 *    `GET /skill-format/rules` is the human/LLM-readable rulebook,
 *    `GET /skill-manifest-schema.json` is the machine-readable JSON
 *    Schema for the same contract, and `POST /skill-format/validate` is
 *    the pre-flight check an agent SHOULD run against a freshly built
 *    ZIP before spending an upload round-trip on `POST /skills`.
 *
 * Path keys are built from the caller-supplied `prefix` (`/api/v1`) —
 * every route below is mounted flat under that prefix by
 * `bootstrap.ts` (`apiApp.route("/", searchRoutes | formatRoutes)`),
 * so the segment after the prefix matches the Hono registration
 * verbatim.
 *
 * @module openapi/paths/searchFormat
 */

import type { JsonSchema, PathMap } from "../helpers";
import {
  bearerAuth,
  jsonResponse,
  optionalAuth,
  problemResponses,
  publicAuth,
  queryParam,
  rawJsonResponse,
} from "../helpers";

// ---------------------------------------------------------------------------
// Response payload schemas
//
// These are hand-written rather than derived from Zod: the search /
// facet / format handlers assemble their response objects inline
// (`c.json({ data: { ... } })`) from repository aggregation rows and
// `SkillSearchResponse`, and no Zod schema in the tree describes those
// exact wire shapes. The old hand-mirrored `openapi/schemas.ts` carried
// close relatives, but they were pre-#457/#715/#720 snapshots (no `meta`,
// no enrichment fields, narrower `scope` enum) that documented a contract
// the server no longer emits — which is precisely why #1214 deleted it.
// ---------------------------------------------------------------------------

/**
 * One row of `data.items` on `GET /skill-search`. Mirrors
 * `SkillSearchItem` in `shared/types/index.ts` *after* the per-caller
 * enrichment pass in `search/service.ts` (`enrichItem`). Fields that
 * enrichment leaves `undefined` are omitted from the JSON body
 * entirely, so they are documented as optional.
 */
const skillSearchItemSchema: JsonSchema = {
  type: "object",
  required: [
    "guid",
    "name",
    "description",
    "createdBy",
    "createdOn",
    "updatedOn",
    "isPrivate",
    "tags",
    "isSystemForMe",
    "permissionSummary",
    "nyxidServiceId",
    "nyxidServiceSlug",
    "nyxidServiceLabel",
    "isSystemSkill",
    "hasGithubSource",
  ],
  properties: {
    guid: {
      type: "string",
      description:
        "Stable skill identifier (UUID v4). Use this — not `name` — as the key in any client-side cache; names can be re-used after a skill is deleted.",
    },
    name: {
      type: "string",
      description:
        "Kebab-case skill name, unique across the platform. Accepted anywhere `{idOrName}` appears (e.g. `GET /skills/{idOrName}`).",
    },
    description: {
      type: "string",
      description: "Short summary of what the skill does, taken from the SKILL.md frontmatter.",
    },
    createdBy: {
      type: "string",
      description:
        "NyxID user_id of the author. Feed this value back as a `createdByAny` filter to narrow a subsequent search to the same author.",
    },
    createdByEmail: {
      type: "string",
      description: "Cached author email. Omitted when the platform never resolved one for this author.",
    },
    createdByDisplayName: {
      type: "string",
      description: "Cached author display name. Omitted when unknown — fall back to `createdByEmail`, then `createdBy`.",
    },
    createdOn: { type: "string", format: "date-time", description: "ISO 8601 creation timestamp." },
    updatedOn: { type: "string", format: "date-time", description: "ISO 8601 timestamp of the most recent publish/update." },
    isPrivate: {
      type: "boolean",
      description: "`true` when the skill is not publicly listed. A private skill in your results means you hold a grant on it.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags declared in `metadata.tag`. These are the values `GET /skill-facets/tags` aggregates.",
    },
    myAccessReason: {
      type: "string",
      enum: ["owner", "public", "shared-direct", "shared-via-org"],
      description:
        "Why THIS caller can see this skill, in precedence order: `owner` (you authored it) > `public` > `shared-direct` (granted to your user_id) > `shared-via-org` (granted to one of your orgs). A public result always carries `public`, authenticated or not — only the `owner` branch needs an identity. The field is omitted solely when no reason applies at all (a private skill with no owner, direct, or org match), which the visibility filter makes effectively unreachable in search results.",
    },
    sharedViaOrgId: {
      type: "string",
      description: "Present only when `myAccessReason` is `shared-via-org` — the org user_id that carries the grant.",
    },
    isSystemForMe: {
      type: "boolean",
      description:
        "`true` when the skill is a platform system skill (tied to an admin-tier NyxID service). Despite the name it is caller-independent — system ties force the skill public.",
    },
    systemForService: {
      type: "object",
      required: ["id", "slug", "label"],
      properties: {
        id: { type: "string", description: "NyxID service id." },
        slug: { type: "string", description: "NyxID service slug." },
        label: { type: "string", description: "Human-readable service label; falls back to the slug." },
      },
      description: "The NyxID service this system skill belongs to. Omitted for non-system skills.",
    },
    permissionSummary: {
      type: "object",
      required: ["isPrivate", "sharedUserCount", "sharedOrgCount"],
      properties: {
        isPrivate: { type: "boolean", description: "Same value as the sibling `isPrivate`." },
        sharedUserCount: { type: "integer", description: "How many individual users hold a direct grant." },
        sharedOrgCount: { type: "integer", description: "How many orgs hold a grant." },
      },
      description:
        "Counts only — grantee identities are never exposed in search results. Read `GET /skills/{id}/permissions` (requires ADMIN tier on the skill) for the actual grant list.",
    },
    nyxidServiceId: {
      type: ["string", "null"],
      description: "NyxID service the skill is bound to, or `null` when unbound. Pass back as the `nyxidServiceId` search filter.",
    },
    nyxidServiceSlug: { type: ["string", "null"], description: "Cached slug of the bound NyxID service, or `null`." },
    nyxidServiceLabel: { type: ["string", "null"], description: "Cached label of the bound NyxID service, or `null`." },
    isSystemSkill: {
      type: "boolean",
      description: "Cached flag: the skill is tied to an admin/platform-wide NyxID service. Drives the `systemFilter` query param.",
    },
    hasGithubSource: {
      type: "boolean",
      description:
        "`true` when the skill was imported from / is synced with a GitHub repository. The repo URL itself is deliberately NOT exposed here — read the skill detail endpoint for it.",
    },
  },
};

/** `data` payload of `GET /skill-search`. */
const skillSearchPayloadSchema: JsonSchema = {
  type: "object",
  required: ["searchMode", "searchScope", "total", "totalPages", "page", "pageSize", "items", "meta"],
  properties: {
    searchMode: {
      type: "string",
      enum: ["keyword", "semantic"],
      description: "The mode that actually ran. Echoed back so a client can confirm a fallback did not happen.",
    },
    searchScope: {
      type: "string",
      enum: ["public", "private", "mixed", "shared-with-me", "mine"],
      description:
        "The visibility scope that was applied. NOTE: for anonymous callers this is always `public` — the server silently collapses any other requested scope rather than erroring.",
    },
    total: { type: "integer", description: "Total matches across all pages within the applied scope + filters." },
    totalPages: { type: "integer", description: "`ceil(total / pageSize)`. Legacy offset-pagination field." },
    page: { type: "integer", description: "1-indexed page that was served (after cursor resolution)." },
    pageSize: { type: "integer", description: "Effective page size — `limit` when supplied, otherwise `pageSize`." },
    items: {
      type: "array",
      items: skillSearchItemSchema,
      description: "The page of results, ordered by relevance in semantic mode and by the repository's default order in keyword mode.",
    },
    meta: {
      type: "object",
      required: ["limit", "hasMore"],
      properties: {
        limit: { type: "integer", description: "Effective page size for this response — same value as `pageSize`." },
        hasMore: {
          type: "boolean",
          description: "`true` when at least one more page exists. Stop paginating when this is `false`.",
        },
        nextCursor: {
          type: "string",
          description:
            "Opaque base64url token. Pass it back verbatim as `?cursor=` to fetch the next page. MUST NOT be parsed — the payload is server-internal and will change. Emitted whenever this page came back full, which includes an exactly-full *final* page — so it can be present while `hasMore` is `false`. It is omitted only on a short page. Stop on `meta.hasMore`, not on the absence of this token; a `while (nextCursor)` loop costs one extra empty request.",
        },
      },
      description:
        "Cursor-pagination envelope per CONVENTIONS.md §4.3 (#457). Prefer `meta.nextCursor` over incrementing `page`; the offset fields are retained for backward compatibility and will be sunset.",
    },
  },
};

/** `data` payload of `GET /skill-facets/tags`. */
const tagFacetPayloadSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "Distinct tags, sorted by descending count then ascending tag name. Capped at 200 rows server-side.",
      items: {
        type: "object",
        required: ["name", "count"],
        properties: {
          name: { type: "string", description: "The tag value, exactly as it must be passed to `GET /skill-search?tags=`." },
          count: { type: "integer", description: "How many skills in this scope carry the tag." },
        },
      },
    },
  },
};

/** `data` payload of `GET /skill-facets/authors`. */
const authorFacetPayloadSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "Distinct authors, sorted by descending skill count then ascending user_id. Capped at 200 rows server-side.",
      items: {
        type: "object",
        required: ["userId", "email", "displayName", "count"],
        properties: {
          userId: {
            type: "string",
            description: "NyxID user_id of the author. This is the value to pass to `GET /skill-search?createdByAny=`.",
          },
          email: { type: "string", description: "Cached author email. Empty string when the platform has none cached." },
          displayName: { type: "string", description: "Cached display name. Empty string when unknown — fall back to `email`, then `userId`." },
          count: { type: "integer", description: "How many skills in this scope this author owns." },
        },
      },
    },
  },
};

/** `data` payload of `GET /skill-facets/system-services`. */
const systemServiceFacetPayloadSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "NyxID services with at least one live system skill, sorted by descending count then ascending id. Capped at 100 rows server-side.",
      items: {
        type: "object",
        required: ["id", "slug", "label", "count"],
        properties: {
          id: {
            type: "string",
            description: "NyxID service id. Pass to `GET /skill-search?nyxidServiceId=` to restrict results to this service.",
          },
          slug: { type: "string", description: "Cached NyxID service slug. Empty string when the tie predates slug caching." },
          label: { type: "string", description: "Human-readable service label; falls back to the slug when unset." },
          count: { type: "integer", description: "Number of system skills tied to this service." },
        },
      },
    },
  },
};

/** `data` payload of `GET /skill-counts`. */
const skillCountsPayloadSchema: JsonSchema = {
  type: "object",
  required: ["public", "mine", "sharedWithMe"],
  properties: {
    public: { type: "integer", description: "Skills with `isPrivate: false`. Always populated, including for anonymous callers." },
    mine: { type: "integer", description: "Skills authored by the caller, private or public. Always `0` for anonymous callers." },
    sharedWithMe: {
      type: "integer",
      description:
        "Private skills the caller can read but did NOT author — granted directly to their user_id or via one of their orgs. Always `0` for anonymous callers.",
    },
  },
};

/** `data` payload of `GET /skill-format/rules`. */
const formatRulesPayloadSchema: JsonSchema = {
  type: "object",
  required: ["rules"],
  properties: {
    rules: {
      type: "string",
      description:
        "The full format rulebook as a Markdown document. Stable for a given server build. Suitable for pasting verbatim into an LLM system prompt when generating a skill package.",
    },
  },
};

/** `data` payload of `POST /skill-format/validate`. */
const formatValidationPayloadSchema: JsonSchema = {
  type: "object",
  required: ["valid", "violations"],
  properties: {
    valid: {
      type: "boolean",
      description: "`true` only when `violations` is empty. Do not infer validity from the HTTP status — a rejected package still returns 200.",
    },
    violations: {
      type: "array",
      description: "Every rule the package breaks, in one shot — the endpoint does not stop at the first failure. Empty array when `valid` is `true`.",
      items: {
        type: "object",
        required: ["rule", "message"],
        properties: {
          rule: {
            type: "string",
            description:
              "Stable machine-readable rule id (e.g. `skill-md-exists`, `skill-md-exact-case`, `folder-name-kebab-case`, `no-readme-md`, `valid-zip`, `unexpected-error`). Branch on this, not on `message`.",
          },
          message: { type: "string", description: "Human-readable explanation of what to fix, naming the offending file where applicable." },
        },
      },
    },
  },
};

/**
 * Response body of `GET /skill-manifest-schema.json`. The body IS a
 * JSON Schema document (draft 2020-12) — this describes the envelope of
 * that document, not the frontmatter it validates.
 */
const manifestSchemaDocumentSchema: JsonSchema = {
  type: "object",
  description:
    "A JSON Schema (draft 2020-12) document describing SKILL.md YAML frontmatter. Generated at server boot from the same Zod schema the upload path validates against, so it cannot drift from the runtime validator.",
  properties: {
    $schema: { type: "string", description: "Dialect identifier — `https://json-schema.org/draft/2020-12/schema`." },
    type: { type: "string", description: "Always `object` — frontmatter is a YAML mapping." },
    properties: {
      type: "object",
      description:
        "Top-level frontmatter fields: `name`, `description`, `version`, `metadata` (with `category`, `output-type`, `runtime`, `runtime-dependency`, `runtime-env-var`, `tool-list`, `tag`, `depends-on`), the optional `license` and `compatibility`, and the optional Claude-ecosystem fields `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `context`, `agent`, `argument-hint`, and `hooks`. The served document is the authoritative list — read it, not this summary, when generating tooling.",
    },
    required: { type: "array", items: { type: "string" }, description: "Names of the mandatory frontmatter fields." },
  },
};

// ---------------------------------------------------------------------------
// Shared response header documentation
// ---------------------------------------------------------------------------

/** RFC 9239 rate-limit headers emitted by `middleware/rateLimit.ts`. */
const rateLimitHeaders: Record<string, unknown> = {
  "RateLimit-Limit": {
    description: "Requests allowed in the current window (60 per 60s for search).",
    schema: { type: "integer" },
  },
  "RateLimit-Remaining": {
    description: "Requests left in the current window. Self-throttle when this approaches 0.",
    schema: { type: "integer" },
  },
  "RateLimit-Reset": {
    description: "Seconds until the window resets and `RateLimit-Remaining` returns to `RateLimit-Limit`.",
    schema: { type: "integer" },
  },
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function skillSearchPath(): PathMap[string] {
  return {
    get: {
      summary: "Search skills by keyword or LLM-ranked semantic relevance",
      description: [
        "The single discovery entry point for the registry. Two modes:",
        "",
        "- `mode=keyword` (default) — a MongoDB text/regex match over name, description, and tags. Cheap, deterministic, and the only mode available to anonymous callers. An empty `q` returns everything in the requested scope, which makes this the correct way to *list* skills, not just to search them.",
        "- `mode=semantic` — loads every skill in scope (after the cheap filters below are applied) and asks an LLM to score each one against `q` from 0–10, returning only positives, ranked. Slower and paid, so reach for it only when keyword matching genuinely fails. Requires a bearer token AND a non-empty `q`; both are rejected with **400** (not 401) when missing.",
        "",
        "**Visibility.** An anonymous caller is silently collapsed to `scope=public` regardless of what was requested — the response's `searchScope` tells you what actually ran, so read it rather than assuming. An authenticated caller sees exactly what they may read: skills they authored, public skills, and private skills granted to them directly or through one of their NyxID orgs.",
        "",
        "**Pagination.** Prefer the cursor envelope: read `data.meta.nextCursor` and send it back as `?cursor=`, stopping when `data.meta.hasMore` is `false`. `page`/`totalPages` still work and are still returned, but they are the legacy offset shape and will be sunset. `cursor` wins over `page` when both are sent; `limit` wins over `pageSize`.",
        "",
        "**Filters.** `tags`, `sharedWithOrgs`, `sharedWithUsers`, and `createdByAny` are comma-separated lists on this endpoint (a deliberate exception to the repeated-key convention elsewhere in the API). Discover legal values for them from `GET /skill-facets/tags`, `GET /skill-facets/authors`, and `GET /skill-facets/system-services` rather than guessing.",
        "",
        "**Cost control.** Rate limited to 60 requests / 60 seconds, keyed per user (or per trusted proxy hop when anonymous). Every response — success or 429 — carries the RFC 9239 `RateLimit-*` headers, and the 429 additionally carries `Retry-After` (whole seconds until the window resets); a well-behaved agent reads them instead of retrying blind. Only the 200 enumerates the header block below; the 429 emits the same three headers plus `Retry-After`, described on that response.",
      ].join("\n"),
      operationId: "searchSkills",
      tags: ["Search"],
      security: optionalAuth(),
      parameters: [
        {
          ...queryParam(
            "q",
            "Free-text query. Matched against name, description, and tags in keyword mode; used as the LLM ranking prompt in semantic mode. Omit or leave empty in keyword mode to list everything in scope. Max 2000 characters. Required (non-empty) when `mode=semantic`.",
            { type: "string", maxLength: 2000 },
          ),
          example: "pdf extraction",
        },
        {
          ...queryParam(
            "query",
            "DEPRECATED legacy alias for `q`, kept for un-upgraded SDK clients during the alpha grace window (#586). Ignored whenever `q` is present. New integrations MUST send `q`.",
            { type: "string", maxLength: 2000 },
          ),
          deprecated: true,
        },
        queryParam(
          "mode",
          "Search strategy. `keyword` (default) is a fast database match. `semantic` runs an LLM re-rank over the whole in-scope corpus — authenticated callers only, non-empty `q` required, and materially slower/costlier.",
          { type: "string", enum: ["keyword", "semantic"], default: "keyword" },
        ),
        queryParam(
          "scope",
          "Visibility slice to search. `public` = published skills; `private` = private skills you may read (authored or granted); `mixed` = the union of those two; `mine` = skills you authored regardless of visibility; `shared-with-me` = private skills granted to you that you did NOT author. Defaults to `private`. Anonymous callers are forced to `public`.",
          {
            type: "string",
            enum: ["public", "private", "mixed", "shared-with-me", "mine"],
            default: "private",
          },
        ),
        queryParam(
          "page",
          "1-indexed page number for legacy offset pagination. Hard-capped at 10000 to bound the underlying `skip()`; anything above that is a 400. Ignored when `cursor` is supplied.",
          { type: "integer", minimum: 1, maximum: 10000, default: 1 },
        ),
        queryParam(
          "pageSize",
          "Results per page, 1–100. Defaults to 9 (the registry grid size), which is smaller than most agents want — set it explicitly. Overridden by `limit` when both are present.",
          { type: "integer", minimum: 1, maximum: 100, default: 9 },
        ),
        {
          ...queryParam(
            "cursor",
            "Opaque pagination token echoed from a previous response's `data.meta.nextCursor`. Takes precedence over `page`; `pageSize`/`limit` still apply and SHOULD be kept identical across a pagination run. A malformed or stale-format token is rejected with 400 `invalid_cursor` rather than silently restarting at page 1. Max 2048 characters.",
            { type: "string", maxLength: 2048 },
          ),
          example: "eyJwYWdlIjoyfQ",
        },
        queryParam(
          "limit",
          "Canonical alias for `pageSize` per CONVENTIONS.md §4.3, 1–100. When present it overrides `pageSize`. No default — omit it and `pageSize` applies.",
          { type: "integer", minimum: 1, maximum: 100 },
        ),
        {
          ...queryParam(
            "model",
            "LLM model id used to rank results in `mode=semantic`. Ignored in keyword mode. Omit to use the platform's default playground model; pass an id from `GET /me/models` to pin a specific one.",
            { type: "string" },
          ),
          example: "gpt-4o-mini",
        },
        queryParam(
          "systemFilter",
          "Tri-state filter on platform system skills (skills tied to an admin-tier NyxID service). `any` (default) keeps both kinds, `only` returns just system skills, `exclude` drops them.",
          { type: "string", enum: ["any", "only", "exclude"], default: "any" },
        ),
        {
          ...queryParam(
            "sharedWithOrgs",
            "Comma-separated NyxID org user_ids. Keeps only skills granted to at least one of the listed orgs (OR match). Most useful together with `scope=shared-with-me`.",
            { type: "string" },
          ),
          example: "org_7f3a,org_91bc",
        },
        {
          ...queryParam(
            "sharedWithUsers",
            "Comma-separated NyxID user_ids. Keeps only skills carrying a direct grant to at least one of the listed users (OR match).",
            { type: "string" },
          ),
          example: "usr_2b91,usr_5d40",
        },
        {
          ...queryParam(
            "createdByAny",
            "Comma-separated NyxID user_ids. Keeps only skills authored by one of them (OR match). Values come from `GET /skill-facets/authors` → `items[].userId`.",
            { type: "string" },
          ),
          example: "usr_2b91",
        },
        {
          ...queryParam(
            "nyxidServiceId",
            "Restrict to skills bound to this NyxID service. A SINGLE id — this one is not comma-separated. Values come from `GET /skill-facets/system-services` → `items[].id`.",
            { type: "string" },
          ),
          example: "svc_ornn_core",
        },
        {
          ...queryParam(
            "tags",
            "Comma-separated tag list. AND semantics — a skill must carry EVERY listed tag to match (unlike the other CSV filters, which are OR). Values come from `GET /skill-facets/tags` → `items[].name`.",
            { type: "string" },
          ),
          example: "pdf,extraction",
        },
      ],
      responses: {
        ...jsonResponse(skillSearchPayloadSchema, "A page of matching skills plus the cursor envelope.", {
          headers: rateLimitHeaders,
          example: {
            searchMode: "keyword",
            searchScope: "public",
            total: 42,
            totalPages: 5,
            page: 1,
            pageSize: 9,
            items: [
              {
                guid: "550e8400-e29b-41d4-a716-446655440000",
                name: "pdf-extract",
                description: "Extract text and tables from PDF documents.",
                createdBy: "usr_2b91",
                createdByEmail: "author@example.com",
                createdByDisplayName: "Ada L.",
                createdOn: "2026-04-22T10:00:00.000Z",
                updatedOn: "2026-07-01T08:12:00.000Z",
                isPrivate: false,
                tags: ["pdf", "extraction"],
                myAccessReason: "public",
                isSystemForMe: false,
                permissionSummary: { isPrivate: false, sharedUserCount: 0, sharedOrgCount: 0 },
                nyxidServiceId: null,
                nyxidServiceSlug: null,
                nyxidServiceLabel: null,
                isSystemSkill: false,
                hasGithubSource: true,
              },
            ],
            meta: { limit: 9, hasMore: true, nextCursor: "eyJwYWdlIjoyfQ" },
          },
        }),
        ...problemResponses(
          {
            400:
              "Bad request. `invalid_query` — a query parameter failed validation (e.g. `page` above 10000, `pageSize` above 100), with the offending fields named in `detail`. `invalid_cursor` — the `cursor` token is malformed or from an older API revision; restart pagination without it. `QUERY_REQUIRED` — `mode=semantic` was sent without a non-empty `q`. `AUTH_REQUIRED` — `mode=semantic` was sent without a bearer token (deliberately a 400, not a 401: keyword search on the same path is anonymous-friendly).",
          },
          {
            429:
              "`rate_limited` — more than 60 requests inside the 60-second window for this key (per user, or per trusted proxy hop when anonymous). The response carries the same `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers as a success, plus `Retry-After` — an integer count of seconds until the window resets. Wait that long rather than retrying immediately.",
          },
          {
            500:
              "Internal error. Reachable when the datastore or, in semantic mode, the default-model/settings lookup behind the LLM re-rank fails. Retry with backoff; falling back to `mode=keyword` is usually the better recovery.",
          },
        ),
      },
    },
  };
}

function skillFacetTagsPath(): PathMap[string] {
  return {
    get: {
      summary: "List distinct skill tags visible in a scope",
      description: [
        "Returns every tag that appears on at least one skill the caller can see in the given scope, with a per-tag skill count. Use it to populate a filter UI, or — for an agent — to learn the vocabulary the registry actually uses before issuing `GET /skill-search?tags=`; guessing tag names is the most common cause of an empty result set.",
        "",
        "The values in `items[].name` are exactly what the search endpoint's `tags` filter expects (comma-separated, AND semantics). Rows are ordered by descending count then alphabetically, and the server caps the response at 200 tags — treat it as a popularity-ranked head, not an exhaustive dictionary.",
        "",
        "Auth is optional but scope-dependent: `public` and `system` work anonymously, while `mine` and `shared-with-me` require a bearer token and return **401** without one. `private` and `mixed` are accepted anonymously and degrade rather than error, but differently: `private` matches nothing, because its whole match is the private-visibility branch and that branch needs an identity; `mixed` returns exactly the `public` result, because its public branch is unconditional and only the private half drops out.",
      ].join("\n"),
      operationId: "listSkillTagFacets",
      tags: ["Search"],
      security: optionalAuth(),
      parameters: [
        queryParam(
          "scope",
          "Visibility slice to aggregate over. `public` (default) = published skills; `system` = platform system skills only; `mine` = skills you authored; `shared-with-me` = private skills granted to you that you did not author; `private` / `mixed` = private-you-can-read / the union. Any other value is a 400.",
          {
            type: "string",
            enum: ["public", "private", "mixed", "shared-with-me", "mine", "system"],
            default: "public",
          },
        ),
      ],
      responses: {
        ...jsonResponse(tagFacetPayloadSchema, "Distinct tags with per-tag skill counts.", {
          example: {
            items: [
              { name: "pdf", count: 17 },
              { name: "extraction", count: 9 },
              { name: "web-scraping", count: 4 },
            ],
          },
        }),
        ...problemResponses(
          { 400: "`invalid_scope` — the `scope` value is not one of the six accepted values." },
          { 401: "`AUTH_REQUIRED` — `scope=mine` or `scope=shared-with-me` was requested without a bearer token." },
        ),
      },
    },
  };
}

function skillFacetAuthorsPath(): PathMap[string] {
  return {
    get: {
      summary: "List distinct skill authors visible in a scope",
      description: [
        "Returns every author who owns at least one skill the caller can see in the given scope, with a per-author skill count and their cached email / display name for labelling. Feed `items[].userId` back into `GET /skill-search?createdByAny=` to narrow a search to one or more authors.",
        "",
        "`email` and `displayName` are best-effort caches written when the skill was last published — either may be an empty string for older or externally-imported skills, so render with a fallback chain of `displayName` → `email` → `userId`. Rows are ordered by descending count then by user_id, capped at 200.",
        "",
        "Accepts a narrower scope set than the tags facet: only `public`, `system`, `mixed`, and `shared-with-me`. `mine` is deliberately absent — every skill in that scope has the same author, so the facet would be a single row. Anything else is a 400. `shared-with-me` requires a bearer token (**401** without one); the rest work anonymously.",
      ].join("\n"),
      operationId: "listSkillAuthorFacets",
      tags: ["Search"],
      security: optionalAuth(),
      parameters: [
        queryParam(
          "scope",
          "Visibility slice to aggregate over. `public` (default) = published skills; `system` = platform system skills only; `mixed` = public plus the private skills you may read; `shared-with-me` = private skills granted to you that you did not author. `mine` and `private` are NOT supported here and return 400.",
          {
            type: "string",
            enum: ["public", "shared-with-me", "system", "mixed"],
            default: "public",
          },
        ),
      ],
      responses: {
        ...jsonResponse(authorFacetPayloadSchema, "Distinct authors with per-author skill counts.", {
          example: {
            items: [
              { userId: "usr_2b91", email: "author@example.com", displayName: "Ada L.", count: 12 },
              { userId: "usr_5d40", email: "", displayName: "", count: 3 },
            ],
          },
        }),
        ...problemResponses(
          { 400: "`invalid_scope` — the `scope` value is unknown or is one of the values this facet does not support (`mine`, `private`)." },
          { 401: "`AUTH_REQUIRED` — `scope=shared-with-me` was requested without a bearer token." },
        ),
      },
    },
  };
}

function skillFacetSystemServicesPath(): PathMap[string] {
  return {
    get: {
      summary: "List NyxID services that own platform system skills",
      description: [
        "Returns every NyxID service that has at least one system skill bound to it, with a per-service skill count plus the cached slug and label. `items[].id` is exactly what `GET /skill-search?nyxidServiceId=` expects, so this endpoint is the discovery step before filtering search by service.",
        "",
        "There is no `scope` parameter: system skills are always public, so the aggregation is caller-independent and identical for anonymous and authenticated callers. Auth is accepted but changes nothing.",
        "",
        "The counts come from a cached snapshot on each skill document, so the server cross-checks the aggregation against NyxID's live active-service set and drops services NyxID has since deactivated (#715). That cross-check is fail-soft: if NyxID is unreachable or the platform token cannot be minted, the endpoint still returns 200 with the *unfiltered* aggregation rather than erroring — so a stale, deactivated service can occasionally appear. Rows are ordered by descending count then by id, capped at 100.",
      ].join("\n"),
      operationId: "listSystemServiceFacets",
      tags: ["Search"],
      security: optionalAuth(),
      parameters: [],
      responses: {
        ...jsonResponse(
          systemServiceFacetPayloadSchema,
          "NyxID services owning system skills, with per-service counts.",
          {
            example: {
              items: [
                { id: "svc_ornn_core", slug: "ornn-core", label: "Ornn Core", count: 8 },
                { id: "svc_nyxid", slug: "nyxid", label: "NyxID", count: 2 },
              ],
            },
          },
        ),
        // The NyxID cross-check degrades gracefully, but the underlying
        // aggregation is a database call and can still fail.
        ...problemResponses(500),
      },
    },
  };
}

function skillCountsPath(): PathMap[string] {
  return {
    get: {
      summary: "Per-scope skill counts for the current caller",
      description: [
        "Returns `{ public, mine, sharedWithMe }` in one round-trip — the three registry tab counts — so a client does not have to fire three `GET /skill-search?pageSize=1` calls just to read totals. This is the sanctioned way to get counts: CONVENTIONS.md §4.3 keeps totals out of cursor pagination, and this is the sibling endpoint that carries them.",
        "",
        "It lives at `/skill-counts` rather than `/skills/counts` on purpose: the latter would be captured by the `GET /skills/{idOrName}` route and resolve `counts` as a skill name.",
        "",
        "Auth is optional. Anonymous callers get a real `public` count and hard zeros for `mine` and `sharedWithMe` — an identity is required for either to be meaningful, and the server does not error on its absence. The counts use exactly the same visibility rules as `GET /skill-search`, so `public` here always matches `total` from a `scope=public` search with no filters.",
      ].join("\n"),
      operationId: "getSkillCounts",
      tags: ["Search"],
      security: optionalAuth(),
      parameters: [],
      responses: {
        ...jsonResponse(skillCountsPayloadSchema, "Skill counts for the three registry scopes.", {
          example: { public: 128, mine: 7, sharedWithMe: 3 },
        }),
        // Three concurrent aggregate counts against MongoDB.
        ...problemResponses(500),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

function formatRulesPath(): PathMap[string] {
  return {
    get: {
      summary: "Get the SKILL.md package format rulebook (Markdown)",
      description: [
        "Returns the canonical Ornn skill-package format rules as a single Markdown document: the required folder layout, the case-sensitive `SKILL.md` filename rule, the allowed root entries, and every frontmatter field with its constraints (`name`, `description`, `metadata.category`, `output-type`, `runtime`, `tool-list`, `tag`, `depends-on`, `license`, `compatibility`).",
        "",
        "This is the prose form of the contract, intended to be dropped verbatim into an LLM system prompt when an agent is *authoring* a package. For programmatic validation of an already-built manifest, use `GET /skill-manifest-schema.json` (machine-readable JSON Schema) instead; to check a finished ZIP, use `POST /skill-format/validate`.",
        "",
        "Public, no auth, and the content is static for a given server build — cache it per deployment rather than fetching it before every generation.",
      ].join("\n"),
      operationId: "getFormatRules",
      tags: ["Format"],
      security: publicAuth(),
      parameters: [],
      responses: {
        ...jsonResponse(formatRulesPayloadSchema, "The format rulebook as Markdown.", {
          example: { rules: "# Ornn Skill Package Format Rules\n\n## Package Structure\n..." },
        }),
      },
    },
  };
}

function manifestSchemaPath(): PathMap[string] {
  return {
    get: {
      summary: "Get the JSON Schema for SKILL.md frontmatter",
      description: [
        "Publishes the canonical JSON Schema (draft 2020-12) for `SKILL.md` YAML frontmatter, generated at server boot from the same Zod schema the upload path validates against — so the published schema cannot drift from the runtime validator.",
        "",
        "**This response is NOT enveloped.** The schema document sits at the body root with `Content-Type: application/schema+json`, because the consumers (VS Code, Cursor, JetBrains, schemastore.org) expect a bare JSON Schema. Every other endpoint in this API returns `{ data, error }`; this one deliberately does not. Do not send it through your generic envelope-unwrapping client.",
        "",
        "Public, no auth, and served with `Cache-Control: public, max-age=3600`. Skill authors should point their YAML language server at this URL with a `# yaml-language-server: $schema=...` comment to get autocomplete and inline validation while writing SKILL.md. The frontmatter contract carries a manually-bumped revision (`SKILL_MANIFEST_SCHEMA_VERSION`, currently `1`) that is not yet encoded in the URL — re-fetch on a finite TTL rather than pinning forever.",
      ].join("\n"),
      operationId: "getFormatSchema",
      tags: ["Format"],
      security: publicAuth(),
      parameters: [],
      responses: {
        ...rawJsonResponse(manifestSchemaDocumentSchema, "The SKILL.md frontmatter JSON Schema document, un-enveloped.", {
          mediaType: "application/schema+json",
          headers: {
            "Cache-Control": {
              description: "Always `public, max-age=3600`. Honour it — the document only changes on deploy.",
              schema: { type: "string" },
            },
          },
        }),
      },
    },
  };
}

function formatValidatePath(): PathMap[string] {
  return {
    post: {
      summary: "Validate a skill package ZIP against the format rules",
      description: [
        "Pre-flight check for a built skill package. POST the raw ZIP bytes and get back every format rule the package breaks, in one round-trip — the validator does not stop at the first failure, so an agent can fix the whole list before retrying. Run this before `POST /skills`; the upload path applies the identical rules and will reject the package with a 400 otherwise.",
        "",
        "**Read `data.valid`, not the HTTP status.** A package that fails validation still returns **200** with `valid: false` and a populated `violations[]` — validation failure is a successful validation *call*, and the 4xx responses below are about the *request*, never about the package contents. An internal error while walking the archive is likewise reported in-band as a single `unexpected-error` violation on a 200.",
        "",
        "**Body.** Raw binary ZIP — not multipart, not base64, no form field wrapper. `Content-Type` must be `application/zip` or `application/octet-stream`; anything else is rejected with a 400 (`invalid_content_type`) before the body is read, and an empty body is a 400 (`empty_body`).",
        "",
        "**Limits.** The same zip-bomb guards as the publish path run before any format checking: cumulative uncompressed size, per-entry uncompressed size, entry count, and compression ratio (defaults 50 MiB / 25 MiB / 1000 entries / 100×, all env-tunable per deployment). Tripping one is a **413**. Because the guard opens the archive first, a buffer that is not a parseable ZIP fails there with a **400** `invalid_zip` — only a ZIP that *parses* can reach the 200-with-violations path.",
        "",
        "Requires a bearer token carrying the `ornn:skill:read` NyxID scope.",
      ].join("\n"),
      operationId: "validateFormat",
      tags: ["Format"],
      security: bearerAuth(),
      parameters: [],
      requestBody: {
        required: true,
        description:
          "Raw ZIP bytes of the skill package. Send as `application/zip` (preferred) or `application/octet-stream`. The archive may be either the package folder at the root or its contents at the root — the validator resolves both.",
        content: {
          "application/zip": { schema: { type: "string", format: "binary" } },
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      responses: {
        ...jsonResponse(
          formatValidationPayloadSchema,
          "Validation ran. Inspect `data.valid` — a rejected package is reported here, not as an error status.",
          {
            example: {
              valid: false,
              violations: [
                { rule: "skill-md-exact-case", message: 'Found "skill.md" but the file must be exactly "SKILL.md".' },
                { rule: "no-readme-md", message: "The package root must not contain README.md." },
              ],
            },
          },
        ),
        ...problemResponses(
          {
            400:
              "Bad request. `invalid_content_type` — `Content-Type` was neither `application/zip` nor `application/octet-stream`. `empty_body` — a zero-length body was sent. `invalid_zip` — the bytes are not a parseable ZIP archive (raised by the zip-bomb guard before format checking).",
          },
          401,
          { 403: "`forbidden` — the token is valid but lacks the `ornn:skill:read` scope." },
          {
            413:
              "The archive trips a zip-bomb guard: `uncompressed_too_large` (cumulative or per-entry uncompressed size, or a compression ratio above the cap) or `too_many_files` (entry count above the cap). Caps are deployment-configured; the `detail` field states the actual limit that was hit.",
          },
        ),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * All search / facet / format paths, keyed by full path including the
 * `/api/v1` prefix.
 */
export function searchFormatPaths(prefix: string): PathMap {
  return {
    [`${prefix}/skill-search`]: skillSearchPath(),
    [`${prefix}/skill-facets/tags`]: skillFacetTagsPath(),
    [`${prefix}/skill-facets/authors`]: skillFacetAuthorsPath(),
    [`${prefix}/skill-facets/system-services`]: skillFacetSystemServicesPath(),
    [`${prefix}/skill-counts`]: skillCountsPath(),
    [`${prefix}/skill-format/rules`]: formatRulesPath(),
    [`${prefix}/skill-manifest-schema.json`]: manifestSchemaPath(),
    [`${prefix}/skill-format/validate`]: formatValidatePath(),
  };
}
