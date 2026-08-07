/**
 * OpenAPI paths for the **Skills CRUD & versioning** domain (#1214).
 *
 * Covers everything an agent needs to own a skill's life-cycle on the
 * registry, mirroring `domains/skills/crud/routes.ts` one-for-one:
 *
 *   - **Publish** — `POST /skills` (ZIP upload) and `POST /skills/pull`
 *     (create straight from a public GitHub folder, keeping a one-way
 *     GitHub → Ornn link).
 *   - **Source link** — `PUT /skills/{id}/source` attaches or clears that
 *     link on an already-uploaded skill; `POST /skills/{id}/refresh`
 *     re-pulls it (with a `dryRun` preview mode).
 *   - **Read** — `GET /skills/{idOrName}` (metadata),
 *     `GET /skills/{idOrName}/json` (every file's text content — the
 *     agent-preferred read), `.../versions/{version}/download` (raw ZIP
 *     bytes), and `GET /skills/{idOrName}/closure` (transitive dependency
 *     graph, deps-first topological order).
 *   - **Versioning** — immutable `<major>.<minor>` versions: list, diff two
 *     of them, deprecate one, delete a non-latest one, and move npm-style
 *     dist-tags (`stable`, `beta`, …) around. `latest` is auto-managed.
 *   - **Governance** — replace the typed grant ACL, transfer ownership,
 *     bind the skill to a NyxID catalog service, delete the skill.
 *
 * Two identifier rules run through the whole domain and are worth learning
 * once (CONVENTIONS.md §2.2):
 *
 *   - **Reads** accept `{idOrName}` — either the stable GUID or the
 *     globally-unique skill name.
 *   - **Writes** accept `{id}` only — the stable GUID. There is no
 *     polymorphic name resolution on a mutation, so resolve the name via a
 *     read first if all you have is a name.
 *
 * That split is why this module emits `` `/skills/{idOrName}` `` (get) and
 * `` `/skills/{id}` `` (put, delete) as two separate path items. It is a
 * deliberate deviation, not an oversight: OAS 3.1's Paths Object says two
 * templated paths of the same hierarchy that differ only in the template
 * variable's *name* are identical and MUST NOT both exist, so strict
 * validators and some generators flag the pair as a duplicate entry for
 * `/api/v1/skills/{*}`. The collision is inherited from the router — Hono
 * registers `/skills/:idOrName` for the read and `/skills/:id` for the two
 * writes (`domains/skills/crud/routes.ts`) — and
 * `tests/contract/openapiRoutes.test.ts` reflects the booted router against
 * this table by rewriting `{x}` to `:x`, so the spec cannot rename the
 * variable on its own. Merging the two path items is therefore a router
 * change, not a documentation one. `openapi/paths/skillsets.ts` carries the
 * same pair for the same reason.
 *
 * Visibility is uniform too: a private skill the caller cannot read answers
 * **404, never 403**, so existence is never leaked.
 *
 * @module openapi/paths/skillsCrud
 */

import {
  bearerAuth,
  binaryResponse,
  jsonBody,
  jsonResponse,
  optionalAuth,
  pathParam,
  problemResponses,
  queryParam,
  toSchema,
  type JsonSchema,
  type PathMap,
} from "../helpers";
import { skillGrantSchema } from "../../domains/skills/crud/grants";

// ---------------------------------------------------------------------------
// Shared schema fragments
//
// The skill-detail wire shape lives in `shared/types/index.ts` as a
// TypeScript interface, not a Zod schema — nothing validates it at runtime,
// so there is no Zod source to reuse here and these are hand-written to
// match `SkillService.buildDetailResponse` field-for-field. The one shape
// that DOES have a canonical Zod schema (`skillGrantSchema`) is imported.
// ---------------------------------------------------------------------------

/** One typed ACL entry. Canonical Zod schema, reused verbatim (#1123). */
const grantSchema: JsonSchema = {
  ...toSchema(skillGrantSchema),
  description:
    "One access grant. `type: \"user\"` targets a NyxID person user_id; `type: \"org\"` targets a NyxID org user_id and every admin/member of that org inherits the grant. `level: \"read\"` allows view/pull/execute; `level: \"write\"` additionally allows publishing new versions. `write` never confers admin rights (permissions, transfer, delete) — those stay with the owner and platform admins.",
};

/** `metadata` block parsed out of SKILL.md frontmatter. */
const skillMetadataSchema: JsonSchema = {
  type: "object",
  description:
    "Structured metadata extracted from the resolved version's SKILL.md YAML frontmatter. Additional keys may appear over time — treat this object as open.",
  properties: {
    category: {
      type: "string",
      description:
        "Execution model: `plain` (prompt only), `tool-based` (calls MCP/builtin tools), `runtime-based` (runs code in a sandbox), or `mixed`.",
      example: "runtime-based",
    },
    outputType: {
      type: "string",
      enum: ["text", "file"],
      description: "`text` returns stdout; `file` returns generated files collected from the sandbox.",
    },
    runtimes: {
      type: "array",
      description: "Sandbox runtimes this skill needs, with their dependencies and required env vars.",
      items: {
        type: "object",
        properties: {
          runtime: { type: "string", description: "Runtime id — `node` or `python`.", example: "python" },
          dependencies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                library: { type: "string", description: "Package name.", example: "pypdf" },
                version: { type: "string", description: "Version constraint, `*` when unpinned.", example: "*" },
              },
            },
          },
          envs: {
            type: "array",
            description: "Environment variables the caller must supply at execution time.",
            items: {
              type: "object",
              properties: {
                var: { type: "string", description: "Variable name.", example: "OPENAI_API_KEY" },
                description: { type: "string", description: "What the value is used for." },
              },
            },
          },
        },
      },
    },
    tools: {
      type: "array",
      description: "External tools the skill invokes during LLM execution.",
      items: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Tool identifier as referenced in the prompt." },
          type: { type: "string", description: "`builtin` (platform-provided) or `mcp` (from an MCP server)." },
          "mcp-servers": {
            type: "array",
            items: {
              type: "object",
              properties: {
                mcp: { type: "string", description: "MCP server package name." },
                version: { type: "string", description: "MCP server version." },
              },
            },
          },
        },
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Classification tags, also surfaced as the top-level `tags` array.",
    },
    dependsOn: {
      type: "array",
      items: { type: "string" },
      description:
        "Direct skill dependencies (#968), each `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`. No semver ranges. Resolve the full transitive set with `GET /skills/{idOrName}/closure`.",
      example: ["pdf-tools@1.0"],
    },
  },
};

/** GitHub origin pointer carried by pulled / linked skills. */
const skillSourceSchema: JsonSchema = {
  type: "object",
  description:
    "Present when the skill is linked to an upstream GitHub folder. `lastSyncedAt` / `lastSyncedCommit` are absent in the 'linked but never refreshed' state.",
  required: ["type", "repo", "ref", "path"],
  properties: {
    type: { type: "string", enum: ["github"], description: "Source kind. Only `github` exists today." },
    repo: { type: "string", description: "`owner/name`.", example: "ChronoAIProject/ornn-skills" },
    ref: { type: "string", description: "Branch, tag, or commit SHA the folder is read from.", example: "main" },
    path: {
      type: "string",
      description: "Folder inside the repo holding SKILL.md. Empty string means the repo root.",
      example: "skills/pdf-extract",
    },
    lastSyncedAt: { type: "string", format: "date-time", description: "ISO 8601 time of the last successful refresh." },
    lastSyncedCommit: { type: "string", description: "Commit SHA the last refresh pulled." },
    upstreamHeadSha: { type: "string", description: "Upstream HEAD observed by the last background drift check." },
    lastCheckedAt: { type: "string", format: "date-time", description: "ISO 8601 time of the last drift check." },
    driftState: {
      type: "string",
      enum: ["in_sync", "drifted", "changed_unversioned", "broken"],
      description:
        "Cached drift verdict. `in_sync` — upstream matches. `drifted` — upstream moved and declares a higher version. `changed_unversioned` — upstream changed but SKILL.md's version did not (a refresh would 409). `broken` — upstream folder no longer fetchable.",
    },
  },
};

/** AgentSeal advisory trust scan attached to the resolved version. */
const agentsealScanSchema: JsonSchema = {
  type: ["object", "null"],
  description:
    "Advisory AgentSeal security scan for the resolved version (#253). Null when the version has not been scanned (legacy rows, or the scanner was disabled). Warn-only — a low score never blocks publish or execution.",
  properties: {
    score: { type: "integer", description: "0–100, severity-weighted. Higher is safer.", example: 92 },
    findings: {
      type: "array",
      items: { type: "object" },
      description: "Per-file findings from the scan sweep. Shape is scanner-defined; treat entries as opaque objects.",
    },
    scannedAt: { type: "string", format: "date-time", description: "ISO 8601 completion time." },
    agentsealVersion: { type: "string", description: "Pinned AgentSeal package version that produced this record." },
    scannedFiles: { type: "integer", description: "How many files were scanned. Absent on older records." },
  },
};

/**
 * The canonical skill representation. Returned by every read and by every
 * mutation that leaves a skill behind (create, update, refresh, source
 * link, permissions, transfer, NyxID bind).
 */
const skillDetailSchema: JsonSchema = {
  type: "object",
  description:
    "Full skill representation at one resolved version. Identity fields (`guid`, `name`, `isPrivate`, `createdBy`, ACL) come from the skill document; package fields (`metadata`, `skillHash`, `license`, `compatibility`, `version`, deprecation, `agentsealScan`) come from the resolved version — so the same skill read at `?version=1.0` and `?version=2.0` differs only in those.",
  required: [
    "guid",
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "tags",
    "skillHash",
    "isPrivate",
    "createdBy",
    "createdOn",
    "updatedOn",
    "sharedWithUsers",
    "sharedWithOrgs",
    "version",
  ],
  properties: {
    guid: {
      type: "string",
      format: "uuid",
      description: "Stable identifier. The only accepted id on write operations.",
      example: "550e8400-e29b-41d4-a716-446655440000",
    },
    name: {
      type: "string",
      description:
        "Globally unique skill name, read from SKILL.md frontmatter at publish time. Usable in place of the GUID on read paths.",
      example: "pdf-extract",
    },
    description: { type: "string", description: "One-paragraph summary of what the skill does and when to use it." },
    license: { type: ["string", "null"], description: "SPDX identifier, or null when unspecified.", example: "MIT" },
    compatibility: {
      type: ["string", "null"],
      description: "Model/platform the author targeted, or null when model-agnostic.",
      example: null,
    },
    metadata: skillMetadataSchema,
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Convenience copy of `metadata.tags`.",
      example: ["pdf", "extraction"],
    },
    skillHash: {
      type: "string",
      description: "SHA-256 (hex) of the resolved version's ZIP bytes. Changes on every publish.",
    },
    isPrivate: {
      type: "boolean",
      description:
        "True ⇒ visible only to the owner, platform admins, and grantees. Newly created skills are ALWAYS private; flip via `PUT /skills/{id}/permissions`.",
    },
    createdBy: { type: "string", description: "NyxID person user_id of the current owner." },
    createdByEmail: { type: "string", description: "Cached owner email. Absent when never resolved." },
    createdByDisplayName: { type: "string", description: "Cached owner display name. Absent when never resolved." },
    createdOn: { type: "string", format: "date-time", description: "ISO 8601 creation time of the skill." },
    updatedOn: { type: "string", format: "date-time", description: "ISO 8601 time of the most recent mutation." },
    sharedWithUsers: {
      type: "array",
      items: { type: "string" },
      description:
        "Legacy read-only allow-list of person user_ids, kept in lockstep with `grants` for pre-#1123 clients. Prefer `grants`.",
    },
    sharedWithOrgs: {
      type: "array",
      items: { type: "string" },
      description: "Legacy read-only allow-list of org user_ids. Prefer `grants`.",
    },
    grants: {
      type: "array",
      items: grantSchema,
      description:
        "Canonical typed ACL. Always populated on responses — an un-migrated skill has its legacy lists projected here as `read` grants, so you can rely on this field alone.",
    },
    version: {
      type: "string",
      description:
        "The version this payload describes: the requested `?version=` when supplied, otherwise the current latest.",
      example: "1.2",
    },
    isDeprecated: { type: "boolean", description: "True when the author deprecated this specific version." },
    deprecationNote: { type: ["string", "null"], description: "Author's explanation for the deprecation." },
    source: skillSourceSchema,
    nyxidServiceId: { type: ["string", "null"], description: "NyxID catalog service this skill is tied to, or null." },
    nyxidServiceSlug: { type: ["string", "null"], description: "Cached slug of the tied service." },
    nyxidServiceLabel: { type: ["string", "null"], description: "Cached human label of the tied service." },
    isSystemSkill: {
      type: "boolean",
      description:
        "True when tied to an admin/platform NyxID service. System skills are forced public and cannot be flipped private without untying first.",
    },
    agentsealScan: agentsealScanSchema,
    mirrorSync: {
      type: "object",
      description:
        "GitHub-mirror state for public skills. Absent ⇒ never mirrored. `mirrorSync.version === version` ⇒ mirror is current; otherwise a push is still pending.",
      properties: {
        version: { type: "string", description: "Version last committed to the mirror." },
        syncedAt: { type: "string", format: "date-time", description: "ISO 8601 time of that commit." },
        commitSha: { type: "string", description: "Mirror commit SHA, suitable for an audit link." },
      },
    },
    distTags: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "npm-style tag → version map. `latest` is always present and auto-managed on publish; custom tags are owner-managed via the dist-tag endpoints.",
      example: { latest: "1.2", stable: "1.0" },
    },
  },
};

/** Compact, realistic `data` example reused across the skill-returning ops. */
const SKILL_DETAIL_EXAMPLE = {
  guid: "550e8400-e29b-41d4-a716-446655440000",
  name: "pdf-extract",
  description: "Extract text and tables from a PDF into structured JSON.",
  license: "MIT",
  compatibility: null,
  metadata: { category: "runtime-based", outputType: "text", tags: ["pdf", "extraction"] },
  tags: ["pdf", "extraction"],
  skillHash: "9f2c1b8a4d5e6f70819a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70",
  isPrivate: false,
  createdBy: "usr_01HQ8Z3K5N",
  createdByEmail: "author@example.com",
  createdByDisplayName: "Ada Lovelace",
  createdOn: "2026-06-01T09:14:22.000Z",
  updatedOn: "2026-07-18T16:02:05.000Z",
  sharedWithUsers: [],
  sharedWithOrgs: [],
  grants: [],
  version: "1.2",
  isDeprecated: false,
  deprecationNote: null,
  nyxidServiceId: null,
  nyxidServiceSlug: null,
  nyxidServiceLabel: null,
  isSystemSkill: false,
  agentsealScan: null,
  distTags: { latest: "1.2" },
};

/** One entry of `GET /skills/{idOrName}/versions`. */
const versionListItemSchema: JsonSchema = {
  type: "object",
  required: ["version", "skillHash", "integrity", "createdBy", "createdOn", "isDeprecated", "deprecationNote", "releaseNotes"],
  properties: {
    version: { type: "string", description: "`<major>.<minor>` label.", example: "1.2" },
    skillHash: { type: "string", description: "SHA-256 (hex) of this version's ZIP bytes." },
    integrity: {
      type: "string",
      description:
        "npm-style Subresource Integrity string, `sha256-<base64>`. Verify a downloaded package against this before installing.",
      example: "sha256-nywbik1eb3CBmis8TV5vcIGSo7TF1uf4CRorPE1eb3A=",
    },
    createdBy: { type: "string", description: "NyxID person user_id that published this version." },
    createdByEmail: { type: "string", description: "Cached publisher email. Absent when never resolved." },
    createdByDisplayName: { type: "string", description: "Cached publisher display name. Absent when never resolved." },
    createdOn: { type: "string", format: "date-time", description: "ISO 8601 publish time." },
    isDeprecated: { type: "boolean", description: "True when this version is deprecated. Deprecation only warns — the version stays downloadable and can still be `latest`." },
    deprecationNote: { type: ["string", "null"], description: "Author's deprecation note, or null." },
    releaseNotes: {
      type: ["string", "null"],
      description: "Author-supplied changelog read from SKILL.md frontmatter (`release-notes`). Max 2000 chars. Null when omitted.",
    },
  },
};

/** Structured file-level diff between two package ZIPs. */
const versionDiffSchema: JsonSchema = {
  type: "object",
  required: ["files"],
  description:
    "File-level diff. Text files carry both sides' contents (truncated at 64 KiB per side) so a client can render a line-level diff without another fetch; binary files carry hashes and byte counts only.",
  properties: {
    files: {
      type: "object",
      required: ["added", "removed", "modified", "unchangedCount"],
      properties: {
        added: {
          type: "array",
          description: "Files present only in the `to` version.",
          items: {
            type: "object",
            required: ["path", "bytes", "hash", "isText"],
            properties: {
              path: { type: "string", description: "Package-relative path, e.g. `scripts/run.py`." },
              bytes: { type: "integer", description: "Uncompressed size in bytes." },
              hash: { type: "string", description: "SHA-256 (hex) of the file contents." },
              content: { type: "string", description: "Text contents. Absent for binary files." },
              truncated: { type: "boolean", description: "True when `content` was cut at the size cap." },
              isText: { type: "boolean", description: "Whether the file was treated as text." },
            },
          },
        },
        removed: {
          type: "array",
          description: "Files present only in the `from` version.",
          items: {
            type: "object",
            required: ["path", "bytes", "hash", "isText"],
            properties: {
              path: { type: "string", description: "Package-relative path." },
              bytes: { type: "integer", description: "Uncompressed size in bytes." },
              hash: { type: "string", description: "SHA-256 (hex) of the file contents." },
              content: { type: "string", description: "Text contents. Absent for binary files." },
              truncated: { type: "boolean", description: "True when `content` was cut at the size cap." },
              isText: { type: "boolean", description: "Whether the file was treated as text." },
            },
          },
        },
        modified: {
          type: "array",
          description: "Files present in both versions with differing contents.",
          items: {
            type: "object",
            required: ["path", "fromBytes", "toBytes", "fromHash", "toHash", "isText"],
            properties: {
              path: { type: "string", description: "Package-relative path." },
              fromBytes: { type: "integer", description: "Size in the `from` version." },
              toBytes: { type: "integer", description: "Size in the `to` version." },
              fromHash: { type: "string", description: "SHA-256 (hex) in the `from` version." },
              toHash: { type: "string", description: "SHA-256 (hex) in the `to` version." },
              isText: { type: "boolean", description: "Whether the file was treated as text." },
              fromContent: { type: "string", description: "Text contents of the `from` side. Absent for binary." },
              toContent: { type: "string", description: "Text contents of the `to` side. Absent for binary." },
              truncated: { type: "boolean", description: "True when either side was cut at the size cap." },
            },
          },
        },
        unchangedCount: {
          type: "integer",
          description: "How many files are byte-identical in both versions. Count only — no per-file detail.",
        },
      },
    },
  },
};

/** Per-side version summary carried alongside a diff. */
const diffSideSchema: JsonSchema = {
  type: "object",
  required: ["version", "hash", "createdOn", "isDeprecated", "releaseNotes"],
  properties: {
    version: { type: "string", description: "`<major>.<minor>` label of this side." },
    hash: { type: "string", description: "SHA-256 (hex) of this side's package." },
    createdOn: { type: "string", format: "date-time", description: "ISO 8601 publish time of this side." },
    isDeprecated: { type: "boolean", description: "Whether this side is deprecated." },
    releaseNotes: { type: ["string", "null"], description: "Release notes for this side, or null." },
  },
};

/** Minimal `{ guid, name }` identity block used by diff / refresh-preview. */
const skillRefSchema: JsonSchema = {
  type: "object",
  required: ["guid", "name"],
  description: "Identity of the skill the payload is about.",
  properties: {
    guid: { type: "string", format: "uuid", description: "Skill GUID." },
    name: { type: "string", description: "Skill name." },
  },
};

/** One node of a resolved dependency closure. */
const closureNodeSchema: JsonSchema = {
  type: "object",
  required: ["ref", "name", "version", "depth"],
  properties: {
    ref: {
      type: "string",
      description: "Canonical `<name>@<major.minor>` ref this node resolved to. Aliases (`@beta`) collapse onto it.",
      example: "pdf-tools@1.0",
    },
    name: { type: "string", description: "Dependency skill name.", example: "pdf-tools" },
    version: { type: "string", description: "Concrete resolved version.", example: "1.0" },
    guid: { type: "string", format: "uuid", description: "Dependency skill GUID, when the loader resolved one." },
    skillHash: { type: "string", description: "SHA-256 (hex) of that version's package, for integrity pinning." },
    depth: {
      type: "integer",
      description:
        "0 for the skill's direct dependencies; deeper for transitive ones. A node reachable by several paths reports the MAXIMUM depth.",
      example: 1,
    },
  },
};

/** `{ success: true }` acknowledgement returned by the delete endpoints. */
const successAckSchema: JsonSchema = {
  type: "object",
  required: ["success"],
  description: "Deletion acknowledgement. `success` is always `true` — failures surface as an RFC 7807 error instead.",
  properties: { success: { type: "boolean", description: "Always `true`." } },
};

/** `{ tags }` payload shared by the three dist-tag endpoints. */
const distTagsPayloadSchema: JsonSchema = {
  type: "object",
  required: ["tags"],
  properties: {
    tags: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Complete tag → version map AFTER the operation. `latest` is always present (synthesized from the skill's latest-version pointer for skills that predate dist-tags).",
      example: { latest: "2.0", stable: "1.4", beta: "2.0" },
    },
  },
};

/** `{ skill }` wrapper used by the governance endpoints. */
const skillWrapperSchema: JsonSchema = {
  type: "object",
  required: ["skill"],
  description: "The refreshed skill after the change. Wrapped in a `skill` key so future sibling fields can be added without a breaking change.",
  properties: { skill: skillDetailSchema },
};

// ---------------------------------------------------------------------------
// Shared parameters
// ---------------------------------------------------------------------------

const idOrNameParam = pathParam(
  "idOrName",
  "Skill GUID **or** globally unique skill name. Reads accept either; writes accept the GUID only. A private skill the caller cannot read answers 404, not 403.",
  { type: "string" },
  "pdf-extract",
);

const skillIdParam = pathParam(
  "id",
  "Skill GUID. Write operations do NOT resolve names (CONVENTIONS.md §2.2) — read the skill first if you only have its name.",
  { type: "string", format: "uuid" },
  "550e8400-e29b-41d4-a716-446655440000",
);

const versionQueryParam = queryParam(
  "version",
  "Which version to resolve. Either a literal `<major>.<minor>` (e.g. `1.2`) or a dist-tag prefixed with `@` (e.g. `@stable`). **The `@` is required for tags** — a bare `stable` is parsed as a literal version and rejected with 400 `invalid_version`. Omit for the current latest.",
  { type: "string", examples: ["1.2", "@stable"] },
);

/**
 * `skip_validation` is snake_case here because that is what the handlers
 * actually read (`c.req.query("skip_validation")`), predating the
 * camelCase convention in CONVENTIONS.md §4.1.
 */
const skipValidationQueryParam = queryParam(
  "skip_validation",
  "Set to `true` to bypass Ornn's package-format and SKILL.md frontmatter validation — the escape hatch for importing third-party packages that do not follow Ornn's frontmatter schema. Defaults to `false`. It never disables the zip-bomb guards (size / entry-count / compression-ratio caps still apply) and YAML that cannot be parsed at all still fails.",
  { type: "boolean", default: false },
);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Build the Skills CRUD & versioning path table.
 *
 * @param prefix API mount prefix, `/api/v1`. Path keys are built as
 *   `` `${prefix}/skills/{id}` `` so the spec and the booted router agree
 *   (asserted by `tests/contract/openapiRoutes.test.ts`).
 */
export function skillsCrudPaths(prefix: string): PathMap {
  return {
    // -----------------------------------------------------------------------
    // Publish
    // -----------------------------------------------------------------------

    [`${prefix}/skills`]: {
      post: {
        summary: "Publish a new skill from a ZIP package",
        description:
          "Create a brand-new skill by uploading its packaged ZIP as the raw request body (no multipart wrapper — send the bytes directly with `Content-Type: application/zip`). The archive MUST contain a `SKILL.md` whose YAML frontmatter declares at least `name`, `description`, `version` (`<major>.<minor>`) and `metadata.category`; everything else in the archive (scripts, templates, reference data) is carried along verbatim.\n\nThe name in the frontmatter becomes the skill's globally unique name, so a collision with an existing skill fails with 409 `skill_name_exists` — this endpoint never overwrites. To publish a NEW VERSION of a skill you already own, use `PUT /skills/{id}` instead. To create from a public GitHub folder without building a ZIP, use `POST /skills/pull`.\n\nThe skill is created **private** with an empty ACL regardless of anything in the package; make it public or share it afterwards via `PUT /skills/{id}/permissions`. Declared `metadata.depends-on` refs are resolved before anything is written, so a missing dependency, a cycle, or two versions of the same dependency fails the publish rather than landing a broken skill.\n\nRequires the `ornn:skill:create` request scope. Rate-limited to 10 uploads per minute per user.",
        operationId: "createSkill",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skipValidationQueryParam],
        requestBody: {
          required: true,
          description:
            "Raw ZIP bytes of the skill package. Must contain `SKILL.md` at the package root (a single top-level wrapper folder is tolerated and stripped). Rejected with 413 when it exceeds the server's configured max upload size, its uncompressed size / compression ratio trips the zip-bomb guard, or it holds more entries than `MAX_PACKAGE_FILE_COUNT`.",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
          },
        },
        responses: {
          ...jsonResponse(skillDetailSchema, "Skill created. The body is the freshly published skill at version 1 of its history.", {
            status: 201,
            example: { ...SKILL_DETAIL_EXAMPLE, isPrivate: true, version: "1.0", distTags: { latest: "1.0" } },
            headers: {
              Location: {
                description: "Canonical URL of the created skill.",
                schema: { type: "string", example: "/api/v1/skills/550e8400-e29b-41d4-a716-446655440000" },
              },
            },
          }),
          ...problemResponses(
            {
              400: "Bad request. `invalid_content_type` — `Content-Type` was neither `application/zip` nor `application/octet-stream`. `empty_body` — zero-length body. `missing_skill_md` / `missing_frontmatter` / `INVALID_FRONTMATTER` / `frontmatter_validation_failed` — the package's SKILL.md is missing or malformed. `validation_failed` — package-format rules were violated (retry with `skip_validation=true` if importing a third-party package). `reserved_name` — the declared name collides with a reserved action verb. `invalid_version` — the frontmatter `version` is not `<major>.<minor>`.",
            },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:create` scope." },
            { 404: "Not found — `skill_dependency_not_found`: a ref in `metadata.depends-on` does not resolve to a version you can read." },
            {
              409: "Conflict. `skill_name_exists` — a skill with this name already exists (names are global). `dependency_cycle` / `dependency_conflict` — the declared dependency graph loops or pins one skill to two versions.",
            },
            {
              413: "Payload too large. `payload_too_large` — the compressed body exceeds the configured max. `uncompressed_too_large` / `too_many_files` — the zip-bomb guard rejected the archive.",
            },
            { 429: "Rate limited — more than 10 uploads in the last minute for this user. Back off and retry." },
            { 500: "Internal error — the package could not be written to object storage." },
          ),
        },
      },
    },

    [`${prefix}/skills/pull`]: {
      post: {
        summary: "Publish a new skill by pulling a public GitHub folder",
        description:
          "Create a skill straight from a public GitHub repository folder — no local packaging step. Ornn fetches the folder, builds the ZIP server-side, and publishes it exactly as `POST /skills` would, with identical validation, naming, and dependency rules.\n\nIdentify the source either with `githubUrl` (paste the browser URL; Ornn parses repo, ref, and path out of it) or with the explicit `repo` / `ref` / `path` triple. Supply at least one of the two — a body carrying neither is rejected at validation.\n\nUnlike a ZIP upload this records a durable one-way link GitHub → Ornn on the skill. That link powers `POST /skills/{id}/refresh` (re-pull and publish the upstream changes as a new version) and the background drift check that populates `source.driftState`. As with every create path, the skill starts private.\n\nRequires the `ornn:skill:create` request scope.",
        operationId: "pullSkillFromGitHub",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [],
        requestBody: jsonBody(
          {
            type: "object",
            description: "Provide `githubUrl` (preferred) OR `repo`. Supplying `githubUrl` makes `repo` / `ref` / `path` redundant — they are ignored.",
            properties: {
              githubUrl: {
                type: "string",
                minLength: 1,
                description:
                  "A GitHub URL as copied from the browser. `https://github.com/<owner>/<repo>`, `.../tree/<ref>`, and `.../tree/<ref>/<path>` are all understood. Rejected with 400 `invalid_github_url` when it cannot be parsed.",
                example: "https://github.com/ChronoAIProject/ornn-skills/tree/main/skills/pdf-extract",
              },
              repo: {
                type: "string",
                minLength: 1,
                description: "Explicit `owner/name`. Use instead of `githubUrl` when you already have the parts.",
                example: "ChronoAIProject/ornn-skills",
              },
              ref: {
                type: "string",
                description: "Branch, tag, or commit SHA. Defaults to the repository's default branch.",
                example: "main",
              },
              path: {
                type: "string",
                description: "Folder inside the repo that contains SKILL.md. Defaults to the repository root.",
                example: "skills/pdf-extract",
              },
              skip_validation: {
                type: "boolean",
                default: false,
                description:
                  "Same escape hatch as the `skip_validation` query parameter on `POST /skills`: bypass package-format and frontmatter validation for third-party packages. Sent in the BODY here, not the query string.",
              },
            },
          },
          "GitHub source to pull from. At least one of `githubUrl` / `repo` is required.",
          {
            example: {
              githubUrl: "https://github.com/ChronoAIProject/ornn-skills/tree/main/skills/pdf-extract",
            },
          },
        ),
        responses: {
          ...jsonResponse(skillDetailSchema, "Skill created from the GitHub folder. `source` on the body carries the recorded upstream link.", {
            status: 201,
            example: {
              ...SKILL_DETAIL_EXAMPLE,
              isPrivate: true,
              version: "1.0",
              distTags: { latest: "1.0" },
              source: {
                type: "github",
                repo: "ChronoAIProject/ornn-skills",
                ref: "main",
                path: "skills/pdf-extract",
                lastSyncedAt: "2026-07-18T16:02:05.000Z",
                lastSyncedCommit: "3f1a9c2e7b4d5068f1a2b3c4d5e6f708192a3b4c",
              },
            },
            headers: {
              Location: {
                description: "Canonical URL of the created skill.",
                schema: { type: "string", example: "/api/v1/skills/550e8400-e29b-41d4-a716-446655440000" },
              },
            },
          }),
          ...problemResponses(
            {
              400: "Bad request. `invalid_pull_body` — neither `githubUrl` nor `repo` was supplied. `invalid_github_url` — the URL could not be parsed. `pull_failed` — the fetch itself failed (repo/folder missing, private, or GitHub rate-limited the server). Plus every package-validation code `POST /skills` can return (`missing_skill_md`, `frontmatter_validation_failed`, `validation_failed`, `reserved_name`, `invalid_version`).",
            },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:create` scope." },
            { 404: "Not found — `skill_dependency_not_found`: a ref in the pulled package's `metadata.depends-on` does not resolve." },
            { 409: "Conflict — `skill_name_exists`, `dependency_cycle`, or `dependency_conflict`, exactly as on `POST /skills`." },
            { 413: "Payload too large — the folder built a ZIP that trips the zip-bomb guard (`uncompressed_too_large`, `too_many_files`)." },
            { 500: "Internal error — the built package could not be written to object storage." },
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // GitHub source link
    // -----------------------------------------------------------------------

    [`${prefix}/skills/{id}/refresh`]: {
      post: {
        summary: "Re-pull a linked GitHub source and publish it as a new version",
        description:
          "Bring a GitHub-linked skill up to date with its upstream folder. Ornn re-fetches the recorded `source`, and — unless `dryRun` is set — publishes the fetched package as a NEW immutable version, moving `latest` to it and stamping `source.lastSyncedAt` / `lastSyncedCommit`.\n\nBecause this goes through the same publish path as `PUT /skills/{id}`, the upstream `SKILL.md` must declare a version strictly greater than the current latest, and any breaking interface change (removed tool, removed runtime, changed output type) requires a major bump. If the upstream folder changed but its version did not, the refresh fails with 409 — bump the version in the repo and retry.\n\n**Preview first.** Send `{\"dryRun\": true}` to fetch, diff against the current latest, and return the result WITHOUT publishing. The preview body reports `hasChanges`, the `pendingVersion` the real refresh would create, and the same structured file diff `GET /versions/{from}/diff/{to}` returns. This is the recommended way to drive a confirm-then-apply flow.\n\nThe skill must already be linked — link it with `PUT /skills/{id}/source`, or create it linked with `POST /skills/pull`. Requires the `ornn:skill:update` request scope AND being the skill's author or a platform admin (a `write` grantee is NOT sufficient here).",
        operationId: "refreshSkillFromSource",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam],
        requestBody: jsonBody(
          {
            type: "object",
            description: "All fields optional. An empty object `{}` performs a normal (non-preview, validating) refresh.",
            properties: {
              dryRun: {
                type: "boolean",
                default: false,
                description:
                  "When true, fetch and diff but publish nothing. Changes the response payload to the preview shape described below.",
              },
              skipValidation: {
                type: "boolean",
                default: false,
                description: "Bypass package-format / frontmatter validation on the pulled package. Ignored when `dryRun` is true (previews always parse leniently).",
              },
              skip_validation: {
                type: "boolean",
                default: false,
                description: "snake_case alias of `skipValidation`, accepted for backward compatibility with the original handler. Either spelling works; both are OR-ed.",
              },
            },
          },
          "Refresh options.",
          { example: { dryRun: true } },
        ),
        responses: {
          ...jsonResponse(
            {
              oneOf: [
                skillDetailSchema,
                {
                  type: "object",
                  description: "Preview payload — returned when `dryRun` is true. Nothing was persisted.",
                  required: ["skill", "source", "pendingVersion", "hasChanges", "diff"],
                  properties: {
                    skill: skillRefSchema,
                    source: skillSourceSchema,
                    pendingVersion: {
                      type: "string",
                      description:
                        "Version label the real refresh would publish, read from the upstream SKILL.md. Falls back to the current latest when the pulled package cannot be parsed.",
                      example: "1.3",
                    },
                    hasChanges: {
                      type: "boolean",
                      description: "False when upstream is byte-identical to the current latest — a real refresh would be a no-op (and would 409 on the version check).",
                    },
                    diff: versionDiffSchema,
                  },
                },
              ],
              description:
                "The refreshed skill (normal mode) or the dry-run preview (`dryRun: true`). Branch on the presence of `pendingVersion` / `diff` to tell them apart.",
            },
            "Refresh applied (new version published), or — with `dryRun: true` — the preview of what a refresh would do.",
            {
              example: {
                skill: { guid: "550e8400-e29b-41d4-a716-446655440000", name: "pdf-extract" },
                source: {
                  type: "github",
                  repo: "ChronoAIProject/ornn-skills",
                  ref: "main",
                  path: "skills/pdf-extract",
                  lastSyncedCommit: "3f1a9c2e7b4d5068f1a2b3c4d5e6f708192a3b4c",
                },
                pendingVersion: "1.3",
                hasChanges: true,
                diff: { files: { added: [], removed: [], modified: [{ path: "SKILL.md", fromBytes: 1204, toBytes: 1288, fromHash: "…", toHash: "…", isText: true }], unchangedCount: 4 } },
              },
            },
          ),
          ...problemResponses(
            {
              400: "Bad request. `invalid_refresh_body` — the body failed validation. `NO_SOURCE` — the skill has no linked GitHub source; link one with `PUT /skills/{id}/source` first. `refresh_failed` / `refresh_preview_failed` — the upstream fetch or package build failed (folder deleted, repo now private, GitHub unreachable). Plus the usual package-validation codes on the pulled archive.",
            },
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:update`, or `not_skill_owner`: only the skill's author or a platform admin may refresh it." },
            { 404: "Not found — no such skill, or a dependency ref in the pulled package does not resolve (`skill_dependency_not_found`)." },
            {
              409: "Conflict. `VERSION_NOT_INCREMENTED` — the upstream SKILL.md version is not strictly greater than the current latest. `BREAKING_CHANGE_WITHOUT_MAJOR_BUMP` — the interface changed without a major bump. `dependency_cycle` / `dependency_conflict`.",
            },
            { 413: "Payload too large — the pulled folder trips the zip-bomb guard." },
            { 500: "Internal error — the current latest package could not be downloaded for the diff, or the new package could not be stored." },
          ),
        },
      },
    },

    [`${prefix}/skills/{id}/source`]: {
      put: {
        summary: "Attach or clear a skill's GitHub source link",
        description:
          "Point an existing skill at an upstream GitHub folder — or unlink it — WITHOUT pulling anything. Use this to retrofit a link onto a skill that was originally uploaded as a ZIP, or to repoint one at a new repo/branch/folder after a move.\n\nSend `{\"githubUrl\": \"https://github.com/owner/repo/tree/main/skills/x\"}` to link; the URL is parsed into `repo` / `ref` / `path` and stored. `lastSyncedAt` and `lastSyncedCommit` are deliberately left unset — linking is not syncing. Call `POST /skills/{id}/refresh` when you actually want the content. Send `{\"githubUrl\": null}` to unlink; the skill keeps every published version, it just stops being refreshable.\n\nRequires the `ornn:skill:update` request scope AND being the skill's author or a platform admin.",
        operationId: "setSkillSource",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["githubUrl"],
            properties: {
              githubUrl: {
                type: ["string", "null"],
                minLength: 1,
                description:
                  "GitHub URL to link (`https://github.com/<owner>/<repo>[/tree/<ref>[/<path>]]`), or `null` to unlink. Any other JSON type is rejected with 400.",
                example: "https://github.com/ChronoAIProject/ornn-skills/tree/main/skills/pdf-extract",
              },
            },
          },
          "The GitHub URL to link, or `null` to clear the link.",
          { example: { githubUrl: "https://github.com/ChronoAIProject/ornn-skills/tree/main/skills/pdf-extract" } },
        ),
        responses: {
          ...jsonResponse(skillDetailSchema, "Source pointer updated. `source` is populated on a link and absent after an unlink.", {
            example: {
              ...SKILL_DETAIL_EXAMPLE,
              source: {
                type: "github",
                repo: "ChronoAIProject/ornn-skills",
                ref: "main",
                path: "skills/pdf-extract",
              },
            },
          }),
          ...problemResponses(
            {
              400: "Bad request. `invalid_source_body` — `githubUrl` was missing or neither a non-empty string nor null. `invalid_github_url` — the URL could not be parsed into owner/repo.",
            },
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:update`, or `not_skill_owner`: only the skill's author or a platform admin may set its source." },
            404,
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    [`${prefix}/skills/{idOrName}/json`]: {
      get: {
        summary: "Read a skill's full package contents as JSON",
        description:
          "**The endpoint agents should reach for.** Returns the skill's entire package as a JSON object — no ZIP handling, no unpacking, no storage round-trip on your side. `files` maps each package-relative path (`SKILL.md`, `scripts/run.py`, `reference/schema.json`, …) to that file's full text. Binary entries that cannot be decoded as text are silently omitted.\n\nPin a version with `?version=` (literal `1.2` or dist-tag `@stable`); omit it for the current latest. The resolved version is echoed back as `version` so you can record exactly what you read.\n\nUnlike the anonymous-friendly read endpoints, this one requires authentication and the `ornn:skill:read` scope, and it is the call Ornn counts as a programmatic **pull** in its usage analytics. If you only need metadata, use `GET /skills/{idOrName}`; if you need the archive byte-for-byte (to verify `integrity`, or to install it verbatim), use `.../versions/{version}/download`.",
        operationId: "getSkillJson",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [idOrNameParam, versionQueryParam],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["name", "description", "version", "metadata", "files"],
              properties: {
                name: { type: "string", description: "Skill name.", example: "pdf-extract" },
                description: { type: "string", description: "Skill description." },
                version: {
                  type: "string",
                  description: "The concrete version actually returned, after literal/dist-tag resolution.",
                  example: "1.2",
                },
                metadata: skillMetadataSchema,
                files: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description:
                    "Package-relative path → full text content. A single top-level wrapper folder in the archive is stripped, so keys always start at the package root. Undecodable binary files are excluded.",
                  example: { "SKILL.md": "---\nname: pdf-extract\nversion: '1.2'\n---\n…", "scripts/run.py": "import sys\n…" },
                },
              },
            },
            "The skill's package contents at the resolved version.",
          ),
          ...problemResponses(
            { 400: "Bad request — `invalid_version`: `?version=` was neither a `<major>.<minor>` literal nor a resolvable `@tag`. `invalid_dist_tag`: `?version=@` with an empty tag name." },
            401,
            { 403: "Forbidden — the token lacks the `ornn:skill:read` scope." },
            { 404: "Not found — no such skill, the requested version/dist-tag does not exist (`skill_version_not_found`), or the skill is private and this caller cannot read it (existence is not leaked)." },
            { 500: "Internal error — `package_download_failed`: the stored package could not be fetched from object storage." },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/versions`]: {
      get: {
        summary: "List a skill's published versions",
        description:
          "Return every immutable version of the skill, newest first. Each entry carries the version label, its `skillHash`, an npm-style `integrity` string (`sha256-<base64>`) you can verify a download against, who published it and when, the deprecation flag plus note, and the author's release notes.\n\nThis is the call to make before pinning: pick a version here, then read or download it with `?version=` / `.../versions/{version}/download`. Deprecated versions are NOT hidden — deprecation only warns, it never removes a version or excludes it from latest-resolution.\n\nAuthentication is optional: anonymous callers see public skills only; authenticated callers additionally see skills they own, were granted, or can reach via a granted org.",
        operationId: "listSkillVersions",
        tags: ["Skills"],
        security: optionalAuth(),
        parameters: [idOrNameParam],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: versionListItemSchema,
                  description: "All published versions, newest first. Never paginated — a skill's version history is bounded.",
                },
              },
            },
            "The skill's version history.",
            {
              example: {
                items: [
                  {
                    version: "1.2",
                    skillHash: "9f2c1b8a4d5e6f70819a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70",
                    integrity: "sha256-nywbik1eb3CBmis8TV5vcIGSo7TF1uf4CRorPE1eb3A=",
                    createdBy: "usr_01HQ8Z3K5N",
                    createdByEmail: "author@example.com",
                    createdByDisplayName: "Ada Lovelace",
                    createdOn: "2026-07-18T16:02:05.000Z",
                    isDeprecated: false,
                    deprecationNote: null,
                    releaseNotes: "Handle encrypted PDFs.",
                  },
                ],
              },
            },
          ),
          ...problemResponses({
            404: "Not found — no such skill, or it is private and this caller cannot read it.",
          }),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/versions/{fromVersion}/diff/{toVersion}`]: {
      get: {
        summary: "Diff two published versions of a skill",
        description:
          "Compute a structured, file-level diff between two versions of the same skill. Ornn downloads both archives server-side and reports which files were added, removed, or modified, plus a count of the byte-identical ones. For text files both sides' contents are inlined (truncated at 64 KiB per side) so you can render or reason about a line-level diff without any further requests; binary files report hashes and byte counts only.\n\nUse it to decide whether a `latest` move is safe to adopt, or to explain to a user what changed between the version they pinned and the one they are being offered. `fromVersion` and `toVersion` must be literal `<major>.<minor>` labels — dist-tags are NOT resolved on this route, so resolve them via `GET /skills/{idOrName}/dist-tags` first.\n\nAuthentication is optional; the same visibility rules as the read endpoint apply.",
        operationId: "diffSkillVersions",
        tags: ["Skills"],
        security: optionalAuth(),
        parameters: [
          idOrNameParam,
          pathParam(
            "fromVersion",
            "Baseline version — the 'before' side. Literal `<major>.<minor>` only; no leading zeroes, no patch digit, no dist-tag.",
            { type: "string", pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" },
            "1.1",
          ),
          pathParam(
            "toVersion",
            "Target version — the 'after' side. Literal `<major>.<minor>` only. Must differ from `fromVersion`.",
            { type: "string", pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" },
            "1.2",
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["skill", "from", "to", "diff"],
              properties: {
                skill: skillRefSchema,
                from: { ...diffSideSchema, description: "Summary of the baseline version." },
                to: { ...diffSideSchema, description: "Summary of the target version." },
                diff: versionDiffSchema,
              },
            },
            "Structured diff between the two versions.",
          ),
          ...problemResponses(
            {
              400: "Bad request. `same_version` — `fromVersion` and `toVersion` are identical. `invalid_version` — one of them is not a well-formed `<major>.<minor>` label (dist-tags are not accepted here).",
            },
            {
              404: "Not found — no such skill (or not visible to this caller), or `skill_version_not_found`: one of the two versions was never published.",
            },
            { 500: "Internal error — `package_download_failed`: one of the two archives could not be fetched from object storage." },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/versions/{version}/download`]: {
      get: {
        summary: "Download a skill version's package ZIP",
        description:
          "Stream the raw ZIP bytes of one skill version. The bytes are proxied through ornn-api from object storage — no presigned URL is ever handed out, so clients never talk to the storage backend and no credential leaks into a browser.\n\nUse this when you need the archive verbatim: to verify it against the `integrity` value from `GET /skills/{idOrName}/versions`, to install it into a sandbox, or to re-publish it elsewhere. If you just want to read the files, `GET /skills/{idOrName}/json` saves you the unzip.\n\n`{version}` accepts a literal `<major>.<minor>` or a dist-tag written **with its `@` prefix** (`@stable`, `@latest`) — a bare tag name is parsed as a literal version and rejected with 400. Deliberately NOT counted as a pull in usage analytics: this endpoint also backs the web file viewer, and counting UI views would inflate the metric.\n\nAuthentication is optional; anonymous callers may download public skills only. Errors still use the RFC 7807 `application/problem+json` body — only the 200 is binary.",
        operationId: "downloadSkillVersion",
        tags: ["Skills"],
        security: optionalAuth(),
        parameters: [
          idOrNameParam,
          pathParam(
            "version",
            "Literal `<major>.<minor>` (e.g. `1.2`) or a dist-tag INCLUDING the `@` prefix (e.g. `@latest`, `@stable`). A bare `latest` is treated as a literal version and fails with 400 `invalid_version`.",
            { type: "string", examples: ["1.2", "@latest"] },
            "1.2",
          ),
        ],
        responses: {
          ...binaryResponse("The raw skill package ZIP bytes.", "application/zip", {
            "Content-Disposition": {
              description:
                "Attachment filename, `<sanitized-skill-name>-<resolved-version>.zip`. Characters outside `[A-Za-z0-9._-]` in the skill name are replaced with `_`.",
              schema: { type: "string", example: 'attachment; filename="pdf-extract-1.2.zip"' },
            },
          }),
          ...problemResponses(
            { 400: "Bad request — `invalid_version`: `{version}` is neither a well-formed `<major>.<minor>` literal nor an `@`-prefixed tag. `invalid_dist_tag`: `@` with an empty tag name." },
            {
              404: "Not found — no such skill (or private and unreadable by this caller), `skill_version_not_found` (unknown version or unset dist-tag), or `skill_package_not_found` (the version row carries no stored package).",
            },
            { 500: "Internal error — `package_download_failed`: object storage rejected or dropped the read." },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}/closure`]: {
      get: {
        summary: "Resolve a skill version's transitive dependency closure",
        description:
          "Walk the skill's `metadata.depends-on` graph and return **every** transitive dependency it needs — not the skill itself. Items come back in deps-first topological order, so installing them in array order is always safe: every dependency appears before anything that pins it. Nodes shared by several paths (diamonds) appear exactly once, carrying the deepest `depth` at which they were reached.\n\nThis is the one call that turns 'install this skill' into a complete, ordered work list. Pair it with `.../versions/{version}/download` (or `/json`) per node to fetch the packages. A skill declaring no dependencies returns an empty `items` array — that is a success, not a 404.\n\nPin the root with `?version=` (literal or `@tag`); omit for latest. Authentication is optional and the closure is resolved against what the caller may read: a public skill that transitively pins a PRIVATE skill surfaces that node as 404 `skill_dependency_not_found` rather than leaking its existence. The same closure is validated at publish time, so a skill that published successfully had a resolvable graph *for its author* — which is not necessarily resolvable for you.",
        operationId: "getSkillClosure",
        tags: ["Skills"],
        security: optionalAuth(),
        parameters: [idOrNameParam, versionQueryParam],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: closureNodeSchema,
                  description:
                    "The transitive closure in deps-first topological order. Empty when the skill declares no dependencies.",
                },
              },
            },
            "The resolved dependency closure.",
            {
              example: {
                items: [
                  { ref: "pdf-tools@1.0", name: "pdf-tools", version: "1.0", guid: "6f1c…", skillHash: "ab12…", depth: 1 },
                  { ref: "report-gen@2.3", name: "report-gen", version: "2.3", guid: "8a2d…", skillHash: "cd34…", depth: 0 },
                ],
              },
            },
          ),
          ...problemResponses(
            { 400: "Bad request — `invalid_version`: `?version=` is malformed. `invalid_dist_tag`: empty tag name after `@`." },
            {
              404: "Not found — no such root skill (or not visible), `skill_version_not_found` for the requested root version, or `skill_dependency_not_found` when a ref anywhere in the graph does not resolve to a version THIS caller can read.",
            },
            {
              409: "Conflict. `dependency_cycle` — the graph loops. `dependency_conflict` — one skill name is pinned to two different versions inside the same closure, or the closure exceeded the 500-node ceiling.",
            },
          ),
        },
      },
    },

    [`${prefix}/skills/{idOrName}`]: {
      get: {
        summary: "Read a skill's metadata",
        description:
          "Fetch the full metadata record for one skill by GUID or by name: description, license, compatibility, parsed `metadata`, tags, package hash, visibility, the typed grant ACL, GitHub source link, NyxID service tie, AgentSeal trust score, mirror state, and the dist-tag map. It does NOT include the package contents — use `/json` for those or `.../versions/{version}/download` for the archive.\n\nPin with `?version=` (literal `1.2` or dist-tag `@stable`) to see what a specific version looked like; identity fields still come from the skill itself, only the package-shaped fields change.\n\nWhen the resolved version is deprecated the response carries the RFC 8594 `Deprecation: true` header plus a `Link` header with `rel=\"deprecation\"`; the human-readable reason is in `deprecationNote` on the body. Agents should surface that rather than silently installing a deprecated version.\n\nAuthentication is optional: anonymous callers see public skills only. Private skills the caller cannot read answer 404, never 403.",
        operationId: "getSkill",
        tags: ["Skills"],
        security: optionalAuth(),
        parameters: [idOrNameParam, versionQueryParam],
        responses: {
          ...jsonResponse(skillDetailSchema, "The skill at the resolved version.", {
            example: SKILL_DETAIL_EXAMPLE,
            headers: {
              Deprecation: {
                description: "RFC 8594. Present and set to `true` only when the resolved version is deprecated.",
                schema: { type: "string", example: "true" },
              },
              Link: {
                description:
                  "RFC 8594 companion, present alongside `Deprecation`. Carries `rel=\"deprecation\"` pointing at the deprecation registry entry for this skill.",
                schema: {
                  type: "string",
                  example: '<https://github.com/ChronoAIProject/Ornn/blob/main/docs/DEPRECATIONS.md#550e8400>; rel="deprecation"',
                },
              },
            },
          }),
          ...problemResponses(
            { 400: "Bad request — `invalid_version`: `?version=` is not a `<major>.<minor>` literal. `invalid_dist_tag`: empty tag name after `@`." },
            {
              404: "Not found — no such skill, `skill_version_not_found` for the requested version or unset dist-tag, or the skill is private and unreadable by this caller.",
            },
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Per-version writes
    // -----------------------------------------------------------------------

    [`${prefix}/skills/{id}/versions/{version}`]: {
      patch: {
        summary: "Deprecate or un-deprecate a single version",
        description:
          "Flag one published version as deprecated (or clear the flag), optionally with a note explaining why and what to move to. Deprecation is a **warning, not a removal**: the version stays downloadable, stays in `GET /versions`, and can still be what `latest` points at. Consumers see it via `isDeprecated` / `deprecationNote` on the detail and version-list responses, and via the RFC 8594 `Deprecation` header on `GET /skills/{idOrName}`.\n\nSetting `isDeprecated: false` always clears the stored note, so re-deprecating later requires sending the note again.\n\nWrite path, so `{id}` must be the GUID. Requires the `ornn:skill:update` request scope AND object-ADMIN on the skill (author or platform admin) — a `write` grantee cannot deprecate.",
        operationId: "setSkillVersionDeprecation",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [
          skillIdParam,
          pathParam(
            "version",
            "Literal `<major>.<minor>` version to flag. Dist-tags are not resolved on this route.",
            { type: "string", pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" },
            "1.1",
          ),
        ],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["isDeprecated"],
            properties: {
              isDeprecated: {
                type: "boolean",
                description: "`true` marks the version deprecated; `false` clears the flag AND the stored note.",
              },
              deprecationNote: {
                type: "string",
                maxLength: 1024,
                description:
                  "Why it is deprecated and what to use instead. Max 1024 characters. Only meaningful when `isDeprecated` is true — it is forced to null otherwise.",
                example: "Superseded by 2.0 — the text extractor changed output shape.",
              },
            },
          },
          "The deprecation state to apply to this version.",
          { example: { isDeprecated: true, deprecationNote: "Superseded by 2.0 — the text extractor changed output shape." } },
        ),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["skillGuid", "skillName", "version", "isDeprecated", "deprecationNote"],
              description: "Lightweight confirmation. Call `GET /skills/{idOrName}?version=…` if you need the full record afterwards.",
              properties: {
                skillGuid: { type: "string", format: "uuid", description: "The skill's GUID." },
                skillName: { type: "string", description: "The skill's name." },
                version: { type: "string", description: "The version that was updated." },
                isDeprecated: { type: "boolean", description: "The state now stored." },
                deprecationNote: { type: ["string", "null"], description: "The note now stored — null when `isDeprecated` is false." },
              },
            },
            "Deprecation state updated.",
            {
              example: {
                skillGuid: "550e8400-e29b-41d4-a716-446655440000",
                skillName: "pdf-extract",
                version: "1.1",
                isDeprecated: true,
                deprecationNote: "Superseded by 2.0 — the text extractor changed output shape.",
              },
            },
          ),
          ...problemResponses(
            {
              400: "Bad request. `invalid_deprecation_patch` — `isDeprecated` missing/not a boolean, or `deprecationNote` longer than 1024 chars. `invalid_version` — `{version}` is not a `<major>.<minor>` label.",
            },
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:update`, or the caller is not the skill's author / a platform admin." },
            { 404: "Not found — no skill with this GUID (names are not resolved on writes), or `skill_version_not_found`." },
          ),
        },
      },
      delete: {
        summary: "Delete a single non-latest version",
        description:
          "Permanently remove one published version. The skill and every other version survive; the stored archive is best-effort deleted from object storage.\n\nTwo versions can never be removed this way, by design: the **only remaining** version (delete the whole skill with `DELETE /skills/{id}` instead) and the **current latest** (publish a newer version first, then prune the old one). Both refuse with 409.\n\nBe aware this is destructive for consumers: anything pinned to the deleted version will start failing with `skill_version_not_found`, and a dist-tag pointing at it becomes dangling. Prefer `PATCH /skills/{id}/versions/{version}` (deprecate) when you only want to discourage use.\n\nRequires the `ornn:skill:delete` request scope AND object-ADMIN on the skill (author or platform admin).",
        operationId: "deleteSkillVersion",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [
          skillIdParam,
          pathParam(
            "version",
            "Literal `<major>.<minor>` version to delete. Must not be the latest, and must not be the only version.",
            { type: "string", pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" },
            "1.0",
          ),
        ],
        responses: {
          ...jsonResponse(successAckSchema, "Version deleted.", { example: { success: true } }),
          ...problemResponses(
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:delete`, or the caller is not the skill's author / a platform admin." },
            { 404: "Not found — no skill with this GUID, or `skill_version_not_found`." },
            {
              409: "Conflict. `SKILL_VERSION_LAST` — this is the only remaining version; delete the whole skill instead. `SKILL_VERSION_LATEST` — this is the current latest; publish a newer version first.",
            },
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Dist-tags (#463)
    // -----------------------------------------------------------------------

    [`${prefix}/skills/{idOrName}/dist-tags`]: {
      get: {
        summary: "Read a skill's dist-tag map",
        description:
          "Return the complete npm-style tag → version map for a skill. `latest` is always present — it is auto-managed and moves to every newly published version — and any custom tags the owner set (`stable`, `beta`, `lts`, …) sit alongside it.\n\nResolve a tag here, then pass the concrete version to the read/download endpoints; or pass the tag directly as `?version=@stable` (query) / `@stable` (download path segment) and let the server resolve it. Resolving explicitly is the safer pattern for agents that want to record exactly which version they consumed.\n\nAuthentication is optional; the same visibility rules as the read endpoint apply.",
        operationId: "getSkillDistTags",
        tags: ["Skills"],
        security: optionalAuth(),
        parameters: [idOrNameParam],
        responses: {
          ...jsonResponse(distTagsPayloadSchema, "The skill's current dist-tag map.", {
            example: { tags: { latest: "2.0", stable: "1.4", beta: "2.0" } },
          }),
          ...problemResponses({ 404: "Not found — no such skill, or it is private and this caller cannot read it." }),
        },
      },
    },

    [`${prefix}/skills/{id}/dist-tags/{tag}`]: {
      put: {
        summary: "Point a dist-tag at a version",
        description:
          "Create or move a custom dist-tag so downstream consumers can pin to a moving target (`@stable`) instead of a frozen literal. The target version must already exist — Ornn refuses to create a dangling tag.\n\n`latest` is **reserved and immutable here**: it is maintained automatically by the publish path (`POST /skills`, `PUT /skills/{id}`, refresh) and any attempt to set it explicitly is rejected with 400 `dist_tag_immutable`. Tag names must match `^[a-z][a-z0-9-]{0,49}$` — starting with a letter keeps tags from ever looking like version numbers.\n\nMoving a tag is immediately visible to every consumer resolving through it, including exported skillsets, so treat it as a release action.\n\nRequires the `ornn:skill:update` request scope AND object-ADMIN on the skill (author or platform admin).",
        operationId: "setSkillDistTag",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [
          skillIdParam,
          pathParam(
            "tag",
            "Tag name. Must match `^[a-z][a-z0-9-]{0,49}$` (lowercase, starts with a letter, hyphens allowed, max 50 chars). `latest` is reserved.",
            { type: "string", pattern: "^[a-z][a-z0-9-]{0,49}$" },
            "stable",
          ),
        ],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["version"],
            properties: {
              version: {
                type: "string",
                minLength: 1,
                maxLength: 20,
                pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$",
                description:
                  "Literal `<major>.<minor>` version the tag should resolve to. Must already be published — tags cannot point at a version that does not exist, and cannot reference another tag.",
                example: "1.4",
              },
            },
          },
          "The version this tag should point at.",
          { example: { version: "1.4" } },
        ),
        responses: {
          ...jsonResponse(distTagsPayloadSchema, "Tag set. The body is the full tag map after the change.", {
            example: { tags: { latest: "2.0", stable: "1.4" } },
          }),
          ...problemResponses(
            {
              400: "Bad request. `invalid_dist_tag_body` — `version` missing or not `<major>.<minor>`. `dist_tag_immutable` — `{tag}` is `latest`, which is auto-managed. `invalid_dist_tag` — the tag name violates `^[a-z][a-z0-9-]{0,49}$`. `invalid_version` — the version string is malformed.",
            },
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:update`, or the caller is not the skill's author / a platform admin." },
            { 404: "Not found — no skill with this GUID, or `skill_version_not_found`: the target version was never published." },
          ),
        },
      },
      delete: {
        summary: "Remove a dist-tag",
        description:
          "Drop a custom dist-tag. The versions it pointed at are untouched — only the alias disappears, and consumers resolving `@<tag>` afterwards get 404 `skill_version_not_found`.\n\n`latest` cannot be removed: every skill is guaranteed to have a `latest` pointer, so the request is rejected with 400 `dist_tag_immutable`. Deleting a tag that was never set is a no-op that still returns 200 with the current map.\n\nRequires the `ornn:skill:update` request scope AND object-ADMIN on the skill (author or platform admin).",
        operationId: "deleteSkillDistTag",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [
          skillIdParam,
          pathParam(
            "tag",
            "Tag name to remove. Must match `^[a-z][a-z0-9-]{0,49}$`. `latest` is reserved and cannot be deleted.",
            { type: "string", pattern: "^[a-z][a-z0-9-]{0,49}$" },
            "beta",
          ),
        ],
        responses: {
          ...jsonResponse(distTagsPayloadSchema, "Tag removed. The body is the full tag map after the change.", {
            example: { tags: { latest: "2.0", stable: "1.4" } },
          }),
          ...problemResponses(
            {
              400: "Bad request. `dist_tag_immutable` — `{tag}` is `latest`. `invalid_dist_tag` — the tag name violates `^[a-z][a-z0-9-]{0,49}$`.",
            },
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:update`, or the caller is not the skill's author / a platform admin." },
            { 404: "Not found — no skill with this GUID." },
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Skill-level writes
    // -----------------------------------------------------------------------

    [`${prefix}/skills/{id}`]: {
      put: {
        summary: "Publish a new version and/or flip a skill's visibility",
        description:
          "The update endpoint for an existing skill. It does two independent things and you may do either or both in one call:\n\n1. **Publish a new version** — send the new package. The version in the new `SKILL.md` MUST be strictly greater than the current latest (409 `VERSION_NOT_INCREMENTED` otherwise), and any breaking interface change — a removed tool, a removed runtime, a changed output type — requires a MAJOR bump (409 `BREAKING_CHANGE_WITHOUT_MAJOR_BUMP`). Versions are immutable: this appends to history and moves `latest` (and `distTags.latest`), it never rewrites the old archive.\n2. **Flip visibility** — send `isPrivate`.\n\nThree body encodings are accepted: raw ZIP bytes (`application/zip` / `application/octet-stream`) for a package-only update; `multipart/form-data` with a `package` file part and/or an `isPrivate` field for both at once; or `application/json` with `{ \"isPrivate\": … }` for a visibility-only change. A request that carries neither a package nor `isPrivate` is rejected with 400 `no_update`.\n\nThe two halves have DIFFERENT permission tiers: publishing content needs object-WRITE (author, platform admin, or a `write` grantee), while changing `isPrivate` needs object-ADMIN (author or platform admin only). A `write` grantee sending an unchanged `isPrivate` is fine; actually changing it 403s. Skills tied to an admin NyxID service are forced public and refuse `isPrivate: true` until untied.\n\nRequires the `ornn:skill:update` request scope. Write path, so `{id}` is the GUID.",
        operationId: "updateSkill",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam, skipValidationQueryParam],
        requestBody: {
          required: true,
          description:
            "One of: raw ZIP bytes; a multipart form with `package` and/or `isPrivate`; or a JSON body with `isPrivate`. The `Content-Type` header selects the branch — an unrecognised type is treated as 'nothing supplied' and fails with 400 `no_update`.",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  package: {
                    type: "string",
                    format: "binary",
                    description: "New skill package ZIP. Omit to change visibility only.",
                  },
                  isPrivate: {
                    type: "string",
                    enum: ["true", "false"],
                    description:
                      "Visibility flag, sent as a form field. Compared as a string — anything other than the literal `true` is read as `false`.",
                  },
                },
              },
            },
            "application/json": {
              schema: {
                type: "object",
                description: "Visibility-only update. A package cannot be sent through this branch.",
                properties: {
                  isPrivate: {
                    type: "boolean",
                    description:
                      "`true` restricts the skill to its owner, platform admins, and grantees; `false` publishes it to the whole registry.",
                  },
                },
              },
              example: { isPrivate: false },
            },
          },
        },
        responses: {
          ...jsonResponse(skillDetailSchema, "Skill updated. The body reflects the new latest version and the current visibility.", {
            example: SKILL_DETAIL_EXAMPLE,
          }),
          ...problemResponses(
            {
              400: "Bad request. `no_update` — neither a package nor `isPrivate` was supplied. `invalid_body` — the JSON branch received unparseable JSON or a non-boolean `isPrivate`. `SYSTEM_SKILL_MUST_BE_PUBLIC` — the skill is tied to an admin NyxID service and cannot be made private; untie it first. Plus every package-validation code from `POST /skills` (`validation_failed`, `missing_skill_md`, `frontmatter_validation_failed`, `invalid_version`, …).",
            },
            401,
            {
              403: "Forbidden — the token lacks `ornn:skill:update`; or the caller has no WRITE tier on this skill; or the caller is a `write` grantee attempting to CHANGE `isPrivate`, which is ADMIN-tier.",
            },
            { 404: "Not found — no skill with this GUID, or `skill_dependency_not_found` for a ref declared by the new package." },
            {
              409: "Conflict. `VERSION_NOT_INCREMENTED` — the new version is not strictly greater than the current latest. `BREAKING_CHANGE_WITHOUT_MAJOR_BUMP` — the interface changed without a major bump. `dependency_cycle` / `dependency_conflict`.",
            },
            {
              413: "Payload too large — the package exceeds the configured max upload size, or trips the zip-bomb guard (`uncompressed_too_large`, `too_many_files`).",
            },
            { 500: "Internal error — the new package could not be written to object storage." },
          ),
        },
      },
      delete: {
        summary: "Permanently delete a skill and all its versions",
        description:
          "Hard-delete the skill: every published version, every stored archive, and the skill record itself. There is no soft-delete, no tombstone, and no undo — anything pinned to this skill starts failing with `skill_not_found`, and skillsets referencing it are recomputed and their owners notified.\n\nPrefer the reversible alternatives when you can: `PUT /skills/{id}` with `isPrivate: true` hides it from the registry, and `PATCH /skills/{id}/versions/{version}` deprecates a specific version. Use `DELETE /skills/{id}/versions/{version}` to prune one old version rather than the whole skill.\n\nRequires the `ornn:skill:delete` request scope AND object-ADMIN on the skill (author or platform admin — a `write` grantee cannot delete).",
        operationId: "deleteSkill",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam],
        responses: {
          ...jsonResponse(successAckSchema, "Skill and all of its versions deleted.", { example: { success: true } }),
          ...problemResponses(
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:delete`, or the caller is not the skill's author / a platform admin." },
            { 404: "Not found — no skill with this GUID (names are not resolved on writes)." },
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Governance
    // -----------------------------------------------------------------------

    [`${prefix}/skills/{id}/permissions`]: {
      put: {
        summary: "Replace a skill's visibility and access-control list",
        description:
          "Set the skill's complete permission state in one atomic write. This is a **full replace**, not a merge: whatever `grants` you send becomes the entire ACL, so read the current grants off `GET /skills/{idOrName}` and send the modified list back — omitting an entry revokes it.\n\n`grants` is the canonical form: each entry pairs a principal (`type: \"user\"` with a NyxID person user_id, or `type: \"org\"` with a NyxID org user_id) with a `level` of `read` or `write`. A `write` grantee may publish new versions but never gains admin rights (permissions, ownership transfer, deletion, deprecation, dist-tags) — those stay with the owner and platform admins. Org grants cascade to every admin/member of that org. Duplicate `(type, id)` pairs collapse keeping the higher level, and a grant naming the owner is dropped as redundant.\n\n`sharedWithUsers` / `sharedWithOrgs` are the pre-#1123 read-only lists, still accepted for older clients. They are used ONLY when `grants` is omitted, in which case each id becomes a `read` grant. Do not mix the two forms.\n\nSetting `isPrivate: false` publishes the skill registry-wide; the grants are still stored so you can flip back without rebuilding your collaborator list. You may only share into organizations you belong to (platform admins excepted) — sharing into a non-member org is a 403, and a temporarily unresolvable NyxID membership lookup is a retryable 503 rather than a wrong denial.\n\nRequires the `ornn:skill:update` request scope AND object-ADMIN on the skill.",
        operationId: "setSkillPermissions",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["isPrivate"],
            properties: {
              isPrivate: {
                type: "boolean",
                description:
                  "`true` restricts the skill to owner + platform admins + grantees; `false` publishes it to the whole registry. Required — this endpoint replaces the whole permission state.",
              },
              grants: {
                type: "array",
                maxItems: 600,
                items: grantSchema,
                description:
                  "Canonical ACL, replacing the previous one wholesale. Max 600 entries. Omit the field entirely to fall back to the legacy lists below; send `[]` to revoke every grant.",
              },
              sharedWithUsers: {
                type: "array",
                maxItems: 500,
                default: [],
                items: { type: "string", minLength: 1, maxLength: 128 },
                description:
                  "Legacy read-only allow-list of NyxID person user_ids. Used only when `grants` is absent, where each id becomes a `read` grant. Max 500.",
              },
              sharedWithOrgs: {
                type: "array",
                maxItems: 100,
                default: [],
                items: { type: "string", minLength: 1, maxLength: 128 },
                description:
                  "Legacy read-only allow-list of NyxID org user_ids. Used only when `grants` is absent. Max 100. You must be a member of every org listed.",
              },
            },
          },
          "The complete permission state to apply.",
          {
            example: {
              isPrivate: true,
              grants: [
                { type: "user", id: "usr_01HQ8Z3K5N", level: "read" },
                { type: "org", id: "org_01HQ9A4M2P", level: "write" },
              ],
            },
          },
        ),
        responses: {
          ...jsonResponse(skillWrapperSchema, "Permissions replaced. `skill.grants` is the normalized ACL now in force.", {
            example: {
              skill: {
                ...SKILL_DETAIL_EXAMPLE,
                isPrivate: true,
                grants: [{ type: "user", id: "usr_01HQ8Z3K5N", level: "read" }],
                sharedWithUsers: ["usr_01HQ8Z3K5N"],
              },
            },
          }),
          ...problemResponses(
            {
              400: "Bad request. `invalid_permissions` — the body failed validation (missing `isPrivate`, a malformed grant, or a list over its cap). `SYSTEM_SKILL_MUST_BE_PUBLIC` — the skill is tied to an admin NyxID service and cannot be made private; untie it first.",
            },
            401,
            {
              403: "Forbidden — the token lacks `ornn:skill:update`; the caller is not the skill's author / a platform admin; or `not_org_member`: you tried to share into an organization you do not belong to.",
            },
            { 404: "Not found — no skill with this GUID." },
            {
              503: "`org_membership_unavailable` — the NyxID org-membership lookup could not be resolved, so a share into an org cannot be safely validated. Retryable; retry with backoff.",
            },
          ),
        },
      },
    },

    [`${prefix}/skills/{id}/transfer-ownership`]: {
      post: {
        summary: "Transfer a skill to another Ornn user",
        description:
          "Hand ownership of the skill to a different NyxID user. The change is immediate and synchronous: the target becomes `createdBy` (gaining implicit ADMIN over the skill), any grant naming them is dropped as redundant, and the PRIOR owner is retained as a `read` grantee — they keep visibility but lose edit and admin rights, so a transfer is not a lock-out.\n\nThe target must be a known Ornn user: someone who has signed in to Ornn at least once, so the directory can resolve their identity. A user_id that resolves nowhere is rejected with 400 `invalid_transfer_target` before anything is mutated. Transferring to the current owner is a 409 no-op rather than a silent success.\n\nThis is a danger-zone operation: it requires the `ornn:skill:update` request scope AND object-ADMIN (author or platform admin). A `write` grantee can never transfer.",
        operationId: "transferSkillOwnership",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["newOwnerUserId"],
            properties: {
              newOwnerUserId: {
                type: "string",
                minLength: 1,
                maxLength: 128,
                description:
                  "NyxID person user_id of the new owner. Must be a user who has signed in to Ornn at least once — organization ids are not valid targets.",
                example: "usr_01HQ8Z3K5N",
              },
            },
          },
          "The new owner.",
          { example: { newOwnerUserId: "usr_01HQ8Z3K5N" } },
        ),
        responses: {
          ...jsonResponse(skillWrapperSchema, "Ownership transferred. `skill.createdBy` is the new owner and the prior owner appears as a `read` grant.", {
            example: {
              skill: {
                ...SKILL_DETAIL_EXAMPLE,
                createdBy: "usr_01HQ8Z3K5N",
                grants: [{ type: "user", id: "usr_01HPRIOR0WNER", level: "read" }],
              },
            },
          }),
          ...problemResponses(
            {
              400: "Bad request. `invalid_transfer` — `newOwnerUserId` missing, empty, or over 128 chars. `invalid_transfer_target` — the id does not resolve to a known Ornn user; they must sign in to Ornn once before they can receive a skill.",
            },
            401,
            { 403: "Forbidden — the token lacks `ornn:skill:update`, or the caller is not the skill's author / a platform admin." },
            { 404: "Not found — no skill with this GUID." },
            { 409: "`ownership_conflict` — the named user already owns this skill." },
          ),
        },
      },
    },

    [`${prefix}/skills/{id}/nyxid-service`]: {
      put: {
        summary: "Bind or unbind a skill to a NyxID catalog service",
        description:
          "Tie the skill to a NyxID service so credential brokering and service-scoped discovery (`GET /nyxid-services/{serviceId}/skills`) know where it belongs. Send `{\"nyxidServiceId\": \"<id>\"}` to bind, or `{\"nyxidServiceId\": null}` to unbind.\n\nTwo classes of service can be bound. An **admin/platform service** (NyxID `visibility: \"public\"`) may be used by any caller who can see it — binding to one marks the skill a *system skill* and atomically FORCES `isPrivate: false`, because system skills are always public. A **personal service** (`visibility: \"private\"`) may only be bound by the user who created it; binding to somebody else's personal service is refused even for platform admins, and leaves visibility untouched.\n\nAfter binding to an admin service the skill can no longer be made private — `PUT /skills/{id}` and `PUT /skills/{id}/permissions` both refuse with `SYSTEM_SKILL_MUST_BE_PUBLIC` until you unbind. Unbinding clears the cached service id/slug/label and the system-skill flag but does NOT restore the previous visibility; set that explicitly afterwards.\n\nService ids of the form `synthetic:<slug>` come from the platform's configured extra-services list and short-circuit the NyxID lookup; they behave as admin services.\n\nRequires the `ornn:skill:update` request scope AND object-ADMIN on the skill.",
        operationId: "setSkillNyxidService",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [skillIdParam],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["nyxidServiceId"],
            properties: {
              nyxidServiceId: {
                type: ["string", "null"],
                minLength: 1,
                maxLength: 128,
                description:
                  "NyxID catalog service id to bind to, or `null` to unbind. Also accepts a `synthetic:<slug>` id from the platform's configured extras list.",
                example: "svc_01HQ8Z3K5N",
              },
            },
          },
          "The service to bind to, or `null` to unbind.",
          { example: { nyxidServiceId: "svc_01HQ8Z3K5N" } },
        ),
        responses: {
          ...jsonResponse(skillWrapperSchema, "Binding updated. `skill.isSystemSkill` and `skill.isPrivate` reflect the admin-service side effect when one applied.", {
            example: {
              skill: {
                ...SKILL_DETAIL_EXAMPLE,
                isPrivate: false,
                nyxidServiceId: "svc_01HQ8Z3K5N",
                nyxidServiceSlug: "document-tools",
                nyxidServiceLabel: "Document Tools",
                isSystemSkill: true,
              },
            },
          }),
          ...problemResponses(
            { 400: "`INVALID_NYXID_SERVICE_PATCH` — `nyxidServiceId` is missing, or is neither a 1–128 character string nor null." },
            401,
            {
              403: "Forbidden — the token lacks `ornn:skill:update`; the caller is not the skill's author / a platform admin; or `NYXID_SERVICE_NOT_ELIGIBLE`: the target is somebody else's personal service.",
            },
            {
              404: "Not found — no skill with this GUID, or `NYXID_SERVICE_NOT_FOUND`: the service does not exist, is inactive, or is not visible to this caller's NyxID token.",
            },
          ),
        },
      },
    },

    [`${prefix}/nyxid-services/{serviceId}/skills`]: {
      get: {
        summary: "List the skills bound to a NyxID service",
        description:
          "Page through the skills tied to one NyxID catalog service — the inverse of `PUT /skills/{id}/nyxid-service`. Use it to discover which capabilities are available under a service before brokering its credentials.\n\nWhat you get back depends on the service's own kind. For an **admin/platform service** (`tier: \"admin\"`) any authenticated caller sees every public skill bound to it — system skills are forced public, so that is the complete set. For a **personal service** (`tier: \"personal\"`) only the service's creator or a platform admin may browse; the listing is then scoped to the skills that caller can actually read. Anyone else gets 404 rather than 403, so a private service's existence is never leaked.\n\nPagination is page/pageSize rather than the cursor style used elsewhere; the response carries `total`, `page`, `pageSize` and `totalPages` so you can drive a pager directly. Out-of-range or non-numeric values are clamped, never rejected.\n\nRequires a bearer token. No extra `ornn:skill:*` scope is checked — visibility is entirely governed by what the caller's NyxID token can see.",
        operationId: "listSkillsByNyxidService",
        tags: ["Skills"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "serviceId",
            "NyxID catalog service id. Services the caller's token cannot see answer 404 rather than 403.",
            { type: "string" },
            "svc_01HQ8Z3K5N",
          ),
          queryParam(
            "page",
            "1-based page number. Values below 1, non-numeric values, and omission all clamp to 1.",
            { type: "integer", minimum: 1, default: 1, example: 1 },
          ),
          queryParam(
            "pageSize",
            "Items per page. Clamped into 1–100; omission or a non-numeric value yields 20.",
            { type: "integer", minimum: 1, maximum: 100, default: 20, example: 20 },
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["service", "items", "total", "page", "pageSize", "totalPages"],
              properties: {
                service: {
                  type: "object",
                  required: ["id", "slug", "label", "tier"],
                  description: "The resolved service, echoed so a client can render a header without a second NyxID call.",
                  properties: {
                    id: { type: "string", description: "NyxID service id." },
                    slug: { type: "string", description: "URL-safe service slug.", example: "document-tools" },
                    label: { type: "string", description: "Human-readable service name.", example: "Document Tools" },
                    tier: {
                      type: "string",
                      enum: ["admin", "personal"],
                      description:
                        "`admin` — a platform-wide service; the listing covers every public skill bound to it. `personal` — a user-owned service; the listing is scoped to what the caller may read.",
                    },
                  },
                },
                items: {
                  type: "array",
                  description: "Skill summaries for this page. A trimmed projection — call `GET /skills/{idOrName}` for the full record.",
                  items: {
                    type: "object",
                    required: ["guid", "name", "description", "createdBy", "createdOn", "updatedOn", "isPrivate", "tags", "isSystemSkill"],
                    properties: {
                      guid: { type: "string", format: "uuid", description: "Skill GUID." },
                      name: { type: "string", description: "Skill name.", example: "pdf-extract" },
                      description: { type: "string", description: "Skill description." },
                      createdBy: { type: "string", description: "Owner's NyxID person user_id." },
                      createdByEmail: { type: "string", description: "Cached owner email. May be absent." },
                      createdByDisplayName: { type: "string", description: "Cached owner display name. May be absent." },
                      createdOn: { type: "string", format: "date-time", description: "ISO 8601 creation time." },
                      updatedOn: { type: "string", format: "date-time", description: "ISO 8601 last-modified time." },
                      isPrivate: { type: "boolean", description: "Visibility flag." },
                      tags: { type: "array", items: { type: "string" }, description: "Tags from the skill's metadata." },
                      nyxidServiceId: { type: ["string", "null"], description: "The bound service id — matches `{serviceId}`." },
                      nyxidServiceSlug: { type: ["string", "null"], description: "Cached slug of the bound service." },
                      nyxidServiceLabel: { type: ["string", "null"], description: "Cached label of the bound service." },
                      isSystemSkill: { type: "boolean", description: "True when bound to an admin/platform service." },
                    },
                  },
                },
                total: { type: "integer", description: "Total matching skills across all pages.", example: 34 },
                page: { type: "integer", description: "The page actually served, after clamping.", example: 1 },
                pageSize: { type: "integer", description: "The page size actually applied, after clamping.", example: 20 },
                totalPages: { type: "integer", description: "`ceil(total / pageSize)`.", example: 2 },
              },
            },
            "Skills bound to the service, one page at a time.",
          ),
          ...problemResponses(
            401,
            {
              404: "`NYXID_SERVICE_NOT_FOUND` — the service does not exist, is inactive, is not visible to this caller's NyxID token, or is a personal service the caller neither owns nor administers. Existence is deliberately not leaked.",
            },
          ),
        },
      },
    },
  };
}
