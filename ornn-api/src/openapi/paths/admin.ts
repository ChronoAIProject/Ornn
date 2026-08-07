/**
 * Admin core — the platform-operator surface (#1214).
 *
 * Thirteen operations behind one request scope, `ornn:admin:skill`. An
 * agent reaches this domain only when its token carries that scope; the
 * cheapest way to find out is `GET /api/v1/me` and to look for it in
 * `permissions` before attempting anything here. Without it every
 * operation in this module answers `403`, and without a token at all,
 * `401`.
 *
 * The domain splits into six unrelated concerns that happen to share a
 * gate:
 *
 *   1. **Skill moderation** — `GET /admin/skills` is the only listing in
 *      the API with no visibility filter at all: it returns every skill
 *      on the deployment, private ones included. `DELETE /admin/skills/{id}`
 *      is a hard, cascading, irreversible delete that ignores ownership.
 *      `POST /admin/skills/{idOrName}/versions/{version}/agentseal-rescan`
 *      re-runs the AgentSeal static scan on one immutable version.
 *   2. **User directory** — `GET /admin/users`, the paginated admin/normal
 *      roster with per-user skill and activity counts.
 *   3. **Dashboard** — `GET /admin/dashboard/stats`, two tiles of totals.
 *      The activity feed that used to live beside it moved to PostHog.
 *   4. **Platform settings** — the legacy singleton (`auditWaiverThreshold`
 *      plus an LLM-provider override) read and patched at
 *      `/admin/settings`, and the whole-configuration
 *      `/admin/settings/export` + `/admin/settings/import` pair that moves
 *      every settings *section* between deployments.
 *   5. **GitHub mirror operations** — kick off a reconcile
 *      (`POST /admin/mirror/reconcile`, fire-and-forget, `202`) and read
 *      the resulting snapshot (`GET /admin/mirror/status`).
 *   6. **Launch promo** — manually award a user
 *      (`POST /admin/launch-promo/award/{userId}`) and inspect the most
 *      recent awards (`GET /admin/launch-promo/recent`).
 *
 * Two cross-cutting behaviours to internalise before integrating:
 *
 * **Secrets are masked, never returned.** Every settings read replaces a
 * stored credential with a *mid-mask* — first four characters, a run of
 * `•` (U+2022), last four (`sk-p••••••••3f9a`). The bullet is a sentinel:
 * writing a value back that still contains one tells the server "keep the
 * value you already have". So the read-modify-write round trip is safe,
 * and an agent must never try to reconstruct the real key from a mask.
 * The settings *export* uses a different sentinel, `<REDACTED:fieldName>`,
 * with the same preserve-on-import semantics.
 *
 * **Three handlers here still emit the pre-#456 error envelope.** The
 * `503` on the AgentSeal rescan, the `409`/`503` on the mirror reconcile,
 * and the `413` on the settings import are produced inline with
 * `c.json({ data: null, error: { code, message } }, status)` instead of
 * being raised through the global RFC 7807 handler. They are documented
 * below with the standard problem schema for consistency with the rest of
 * the spec, and each carries an explicit warning in its `description`.
 * A client that parses error bodies must tolerate both shapes on those
 * three statuses; branch on the HTTP status first, and read `code` from
 * whichever of the root or `error` object is present.
 *
 * Schema provenance: the settings export/import section payloads are
 * generated from the ten section Zod schemas in
 * `domains/settings/sections/` — the exact schemas the importer validates
 * against, so the documented shape cannot drift from the validator.
 * Everything else is hand-written JSON Schema, because those handlers
 * project their responses inline off TypeScript interfaces
 * (`DashboardStats`, `AdminUserRow`, `ExportEnvelope`, `ImportResult`,
 * `ScheduledRunStatus`, `LaunchPromoClaimDoc`) with no Zod source at all.
 *
 * @module openapi/paths/admin
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
import { assistantSchema } from "../../domains/settings/sections/assistant";
import { extrasSchema } from "../../domains/settings/sections/extras";
import { launchPromoSchema } from "../../domains/settings/sections/launchPromo";
import { mirrorSchema } from "../../domains/settings/sections/mirror";
import { nyxidSchema } from "../../domains/settings/sections/nyxid";
import { playgroundSchema } from "../../domains/settings/sections/playground";
import { skillAuditSchema } from "../../domains/settings/sections/skillAudit";
import { skillGenSchema } from "../../domains/settings/sections/skillGen";
import { sourceSyncSchema } from "../../domains/settings/sections/sourceSync";
import { telemetrySchema } from "../../domains/settings/sections/telemetry";

// ---------------------------------------------------------------------------
// Shared prose
// ---------------------------------------------------------------------------

/** Appended to every operation description in this module. */
const ADMIN_SCOPE_NOTE =
  "Requires a bearer token whose `permissions` array contains the platform-admin request scope `ornn:admin:skill` — the scope NyxID mints onto its \"Platform Admin\" role. A token without it gets `403` (`code: \"forbidden\"`); no token, an expired token, or a token the proxy could not validate gets `401` (`code: \"auth_missing\"`). There is no finer-grained admin scope: the same one scope unlocks every operation in this domain.";

// ---------------------------------------------------------------------------
// Skill moderation payloads
// ---------------------------------------------------------------------------

const adminSkillRowSchema: JsonSchema = {
  type: "object",
  required: [
    "guid",
    "name",
    "description",
    "createdBy",
    "createdByEmail",
    "createdByDisplayName",
    "createdOn",
    "updatedOn",
    "isPrivate",
    "tags",
  ],
  properties: {
    guid: {
      type: "string",
      description:
        "Skill id (UUID). This is the value `DELETE /admin/skills/{id}` expects — that endpoint resolves by guid only, never by name.",
      examples: ["3f2a91c4-0d5b-4a1e-9d2f-7c8b6e5a4310"],
    },
    name: {
      type: "string",
      description: "Registry-unique skill name, the human-facing identifier used everywhere else in the API.",
      examples: ["web-summarizer"],
    },
    description: { type: "string", description: "One-line summary from the skill's SKILL.md frontmatter." },
    createdBy: {
      type: "string",
      description:
        "NyxID user id of the owner. Feed this back as the `userId` query parameter to narrow the listing to one author. Empty string on legacy rows written before ownership was recorded.",
    },
    createdByEmail: {
      type: "string",
      description: "Owner's email, denormalised onto the skill document at create time. Empty string when unknown.",
    },
    createdByDisplayName: {
      type: "string",
      description: "Owner's display name, denormalised at create time. Empty string when unknown. May be stale if the user has since renamed themselves in NyxID.",
    },
    createdOn: { type: "string", format: "date-time", description: "Creation timestamp (ISO 8601, UTC). The listing is sorted by this field, descending." },
    updatedOn: { type: "string", format: "date-time", description: "Timestamp of the most recent publish or metadata change (ISO 8601, UTC)." },
    isPrivate: {
      type: "boolean",
      description:
        "`true` when the skill is owner-only. Private skills appear here and nowhere else in the API for a non-owner — this listing deliberately skips the visibility filter every other listing applies. Legacy rows with no stored flag are reported as `true`.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Classification tags from `metadata.tags`. Empty array when the skill declared none.",
    },
  },
};

const adminSkillListSchema: JsonSchema = {
  type: "object",
  required: ["items", "total", "page", "pageSize", "totalPages"],
  properties: {
    items: { type: "array", items: adminSkillRowSchema, description: "This page of skills, newest first." },
    total: { type: "integer", description: "Total number of skills matching the filter across all pages." },
    page: { type: "integer", description: "Page number actually served, after clamping (always ≥ 1)." },
    pageSize: { type: "integer", description: "Page size actually served, after clamping to 1–100." },
    totalPages: { type: "integer", description: "`ceil(total / pageSize)`. `0` when `total` is 0." },
  },
};

const successFlagSchema: JsonSchema = {
  type: "object",
  required: ["success"],
  properties: {
    success: {
      type: "boolean",
      description: "Always `true`. The operation is reported through the status code; this field carries no extra information.",
    },
  },
};

const agentsealFindingSchema: JsonSchema = {
  type: "object",
  description:
    "One AgentSeal finding. The shape is defined by the scanner, not by Ornn, and is passed through verbatim — treat it as an open object and read defensively. In practice entries carry a rule identifier, a severity, a file path, and a message.",
  additionalProperties: true,
};

const agentsealScanSchema: JsonSchema = {
  type: "object",
  required: ["score", "findings", "scannedAt", "agentsealVersion"],
  properties: {
    score: {
      type: "number",
      description:
        "Trust score, 0–100, computed from severity-weighted penalties against the findings below. Higher is safer. This value replaces whatever the version's previous scan recorded.",
      examples: [92],
    },
    findings: { type: "array", items: agentsealFindingSchema, description: "Every issue the sweep raised. Empty array on a clean scan." },
    scannedAt: { type: "string", format: "date-time", description: "When this scan completed (ISO 8601, UTC)." },
    agentsealVersion: {
      type: "string",
      description:
        "Pinned AgentSeal package version that produced the score. Compare against the version recorded on an older scan to tell a rules-change from a package-content change.",
    },
    scannedFiles: {
      type: "integer",
      description: "Number of files the sweep actually inspected. Absent on snapshots written before this field was added.",
    },
  },
};

const agentsealRescanSchema: JsonSchema = {
  type: "object",
  required: ["skillGuid", "skillName", "version", "scan"],
  properties: {
    skillGuid: { type: "string", description: "Resolved skill id, useful when the request addressed the skill by name." },
    skillName: { type: "string", description: "Resolved skill name." },
    version: { type: "string", description: "The `<major>.<minor>` version that was rescanned, echoed back." },
    scan: {
      oneOf: [agentsealScanSchema, { type: "null" }],
      description:
        "The new scan snapshot, already persisted onto the version document. `null` means the scan produced no result and **nothing was persisted** — the previous snapshot, if any, is untouched. Do not read `null` as \"clean\"; read it as \"unknown\".",
    },
  },
};

// ---------------------------------------------------------------------------
// User directory + dashboard payloads
// ---------------------------------------------------------------------------

const adminUserRowSchema: JsonSchema = {
  type: "object",
  required: ["userId", "email", "displayName", "skillCount", "lastActiveAt", "activityCount", "firstJoinedAt"],
  properties: {
    userId: { type: "string", description: "NyxID user id — the same value that appears as `createdBy` on a skill and as the `{userId}` path parameter on the launch-promo award endpoint." },
    email: { type: "string", description: "Email from the directory row. Empty string when the identity token never carried one." },
    displayName: { type: "string", description: "Display name from the directory row. Empty string when unknown." },
    skillCount: { type: "integer", description: "Number of skills in the registry whose `createdBy` is this user, counted live at request time." },
    lastActiveAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "Timestamp of the most recent authenticated request from this user (ISO 8601, UTC), or `null` if the directory row has never been stamped.",
    },
    activityCount: {
      type: "integer",
      description:
        "Count of authenticated requests seen from this user. This is a request counter, not a count of meaningful actions — it grows with polling. Monotonic, so it is usable for ordering but not as a business metric.",
    },
    firstJoinedAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "First time Ornn saw this user (ISO 8601, UTC), or `null` on rows predating the field. This is Ornn's first sighting, not the NyxID account creation date.",
    },
  },
};

const adminUserListSchema: JsonSchema = {
  type: "object",
  required: ["items", "page", "pageSize", "total", "totalPages"],
  properties: {
    items: { type: "array", items: adminUserRowSchema, description: "This page of users." },
    page: { type: "integer", description: "Page number actually served, after clamping (always ≥ 1)." },
    pageSize: { type: "integer", description: "Page size actually served, after clamping to 1–200." },
    total: {
      type: "integer",
      description:
        "Users matching `role` + `q`, counted over the pool the service loads for in-application sorting — and that pool is hard-capped at 5000 rows. A role bucket with more than 5000 matches therefore reports exactly `5000`, and nothing in the payload flags the truncation. Narrow with `q` if you need an exact count.",
    },
    totalPages: {
      type: "integer",
      description:
        "`ceil(total / pageSize)`, floored at 1 — an empty result still reports `1`. Derived from the capped `total`, so on a bucket larger than 5000 rows it is an under-estimate and paging to the last page will not reach the end of the directory.",
    },
  },
};

const dashboardStatsSchema: JsonSchema = {
  type: "object",
  required: ["users", "skills"],
  properties: {
    users: {
      type: "object",
      required: ["total", "admin", "normal"],
      description: "User tiles, from the user directory. The two buckets partition the total exactly: `total === admin + normal`.",
      properties: {
        total: { type: "integer", description: "Every user Ornn has ever seen authenticate." },
        admin: { type: "integer", description: "Users whose most recent token carried the platform-admin scope." },
        normal: { type: "integer", description: "Everyone else." },
      },
    },
    skills: {
      type: "object",
      required: ["total", "system", "public", "private"],
      description:
        "Skill tiles. The three buckets partition the total exactly: `total === system + public + private`. `system` means `isSystemSkill: true`; `public` means publicly visible **and** not a system skill; `private` means owner-only.",
      properties: {
        total: { type: "integer", description: "Every skill document in the registry." },
        system: { type: "integer", description: "Platform-provided system skills." },
        public: { type: "integer", description: "Publicly listed, non-system skills." },
        private: { type: "integer", description: "Owner-only skills." },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Platform settings payloads
// ---------------------------------------------------------------------------

const MASK_NOTE =
  "Mid-masked on read: first four characters, a run of `•` (U+2022), last four — e.g. `sk-p••••••••3f9a`. Values of eight characters or fewer are replaced entirely by bullets, and an unset value reads back as the empty string. The bullet is a write-side sentinel: PATCH a value that still contains one and the stored secret is preserved untouched, which makes a read-modify-write round trip safe.";

const platformSettingsSchema: JsonSchema = {
  type: "object",
  required: ["auditWaiverThreshold", "llmProvider"],
  properties: {
    auditWaiverThreshold: {
      type: "number",
      minimum: 0,
      maximum: 10,
      description:
        "Audit overall score, 0–10, at or above which a new share grant applies without a waiver. Below it, the audit-gated share-request flow kicks in (owner justification, then reviewer decision). Stored rounded to one decimal place.",
      examples: [6],
    },
    llmProvider: {
      type: "object",
      required: ["gatewayUrl", "apiKey"],
      description:
        "Legacy single-provider override, consulted by every playground / skill-generation / assistant LLM call. Both fields empty means \"fall back to the deployment's environment configuration\" (the Chrono LLM gateway reached through a NyxID service-account token exchange). The richer per-provider catalog lives under `/admin/settings/llm-providers` and is managed separately.",
      properties: {
        gatewayUrl: {
          type: "string",
          description: "Gateway base URL. Empty string means the env default is used. Returned verbatim — this is not a secret.",
          examples: ["https://api.openai.com/v1"],
        },
        apiKey: {
          type: "string",
          description: `Direct bearer key used instead of the service-account token exchange. Encrypted at rest. ${MASK_NOTE}`,
        },
      },
    },
  },
};

const platformSettingsPatchSchema: JsonSchema = {
  type: "object",
  description:
    "Partial update. Send only the keys you intend to change; every key is optional and any key that is not one of the two below is silently ignored. The body must contain at least one recognised key or the request is rejected with `400`.",
  properties: {
    auditWaiverThreshold: {
      type: "number",
      minimum: 0,
      maximum: 10,
      description:
        "New waiver threshold. Coerced with `Number()`, then required to be finite and within 0–10, then rounded to one decimal. Anything outside that range — including `NaN`, `Infinity`, and non-numeric strings — is a `400` (`code: \"invalid_setting\"`).",
      examples: [7.5],
    },
    llmProvider: {
      type: "object",
      description:
        "LLM override. Field-level partial: omit `gatewayUrl` or `apiKey` and the stored value for that field is carried forward unchanged, so `{ \"llmProvider\": { \"gatewayUrl\": \"...\" } }` re-points the gateway without disturbing the key.",
      properties: {
        gatewayUrl: {
          type: "string",
          description:
            "Absolute URL, or the empty string to clear the override and fall back to the environment default. A non-empty value that does not parse as a URL is a `400`.",
        },
        apiKey: {
          type: "string",
          description:
            "New bearer key, or the empty string to clear it. If the value contains a `•` (U+2022) it is treated as the mid-mask you just read back from `GET /admin/settings` and the stored key is preserved unchanged — so echoing the GET response back is a no-op, by design. Leading and trailing whitespace is trimmed.",
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Settings export / import payloads
// ---------------------------------------------------------------------------

/**
 * Per-section JSON Schemas, generated from the ten Zod section schemas in
 * `domains/settings/sections/`. The exporter writes all ten keys and the
 * importer validates each candidate against the very same schema, so one
 * set of definitions serves both directions. None of these schemas carries
 * a Zod `.default()`, which is why the input and output projections are
 * identical and reusing them here is safe.
 */
const sectionSchemas: Record<string, JsonSchema> = {
  playground: {
    ...toSchema(playgroundSchema),
    description: "Playground surface: default LLM provider/model, SSE keep-alive cadence, and the default monthly quota granted to non-admin users.",
  },
  skillGen: {
    ...toSchema(skillGenSchema),
    description: "Skill-generation surface — same knobs as `playground`, applied to the skill-authoring LLM calls.",
  },
  assistant: {
    ...toSchema(assistantSchema),
    description: "Ornn Assistant surface (grounded Q&A) — same knobs as `playground`.",
  },
  mirror: {
    ...toSchema(mirrorSchema),
    description:
      "GitHub mirror: kill switch, repository coordinates, GitHub App credentials, and the reconcile cron (interpreted in `Asia/Singapore`; empty string disables the schedule). `appPrivateKey` is a secret — redacted on export, preserved on import when the sentinel comes back unchanged.",
  },
  nyxid: {
    ...toSchema(nyxidSchema),
    description:
      "NyxID and adjacent service coordinates: service-account OAuth endpoint and client id/secret, the NyxID API base URL, and the chrono-storage / chrono-sandbox base URLs plus the storage bucket. `clientSecret` is a secret — redacted on export.",
  },
  skillAudit: {
    ...toSchema(skillAuditSchema),
    description:
      "Skill audit configuration: LLM audit toggle plus its default provider/model, the 0–10 risk threshold, and the AgentSeal toggle and timeout. Note the cross-field rule the importer enforces — `llmAuditDefaultProviderId` is required whenever `llmAuditEnabled` is true.",
  },
  telemetry: {
    ...toSchema(telemetrySchema),
    description:
      "PostHog configuration. Changes take effect on the next ornn-api restart, not immediately. `postHogApiKey` is a secret — redacted on export.",
  },
  extras: {
    ...toSchema(extrasSchema),
    description:
      "Extra synthetic NyxID services an operator has declared. Service names must be unique within the array; duplicates are rejected by the importer as a section-level failure.",
  },
  launchPromo: {
    ...toSchema(launchPromoSchema),
    description:
      "Launch-promo configuration read by both launch-promo endpoints in this domain: enabled flag, GitHub repo coordinates, slot cap, per-claim Playground and Skill-Generation grants, poll interval, code expiry, and the bundled NyxID invite code.",
  },
  sourceSync: {
    ...toSchema(sourceSyncSchema),
    description:
      "GitHub source-sync poller: enabled flag, service-account token, poll cron, per-skill minimum re-check interval, and the auto-publish switch. `githubToken` is a secret — redacted on export.",
  },
};

const exportedLlmProviderSchema: JsonSchema = {
  type: "object",
  required: ["_id", "name", "gatewayUrl", "modelListUrl", "apiFormat", "auth", "maxOutputTokens", "defaultTemperature"],
  description:
    "One configured LLM provider, with its secret auth field redacted. Note what is **not** here: the `models` catalog is derived data and is deliberately excluded, so per-model enable/default flags do not survive an export/import round trip — re-sync the catalog and set the flags again on the target deployment.",
  properties: {
    _id: { type: "string", description: "Provider id." },
    name: { type: "string", description: "Operator-facing provider name." },
    gatewayUrl: { type: "string", description: "Base URL completions are sent to." },
    modelListUrl: { type: "string", description: "URL the model-catalog sync reads." },
    apiFormat: {
      type: "string",
      enum: ["chat-completion", "responses"],
      description: "Wire dialect this provider speaks.",
    },
    auth: {
      type: "object",
      description:
        "Discriminated on `kind`: `apiKey` carries `apiKey`; `tokenUrl` carries `tokenUrl`, `clientId`, `clientSecret`; `basic` carries `username`, `password`. The secret member for the given kind (`apiKey` / `clientSecret` / `password`) is replaced with `<REDACTED:fieldName>`.",
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["apiKey", "tokenUrl", "basic"], description: "Auth strategy discriminator." },
      },
      additionalProperties: true,
    },
    maxOutputTokens: { type: "integer", description: "Per-call output-token ceiling applied to this provider." },
    defaultTemperature: { type: "number", description: "Sampling temperature used when a caller does not specify one." },
  },
};

const exportEnvelopeSchema: JsonSchema = {
  type: "object",
  required: ["schemaVersion", "exportedAt", "ornnVersion", "sections"],
  properties: {
    schemaVersion: {
      type: "integer",
      const: 1,
      description:
        "Envelope format version. The importer demands an exact match — a file carrying any other value is rejected wholesale, with no partial write.",
    },
    exportedAt: { type: "string", format: "date-time", description: "When the export was produced (ISO 8601, UTC)." },
    ornnVersion: {
      type: ["string", "null"],
      description: "Release of the ornn-api instance that produced the file, or `null` when the deployment did not report one. Informational — the importer does not check it.",
    },
    sections: {
      type: "object",
      required: [...Object.keys(sectionSchemas), "llmProviders"],
      description:
        "Every settings section, keyed by section id. All ten sections are always present, even when a section has never been edited (defaults are emitted). Secret fields are replaced with the string sentinel `<REDACTED:fieldName>` so the file never carries plaintext or ciphertext.",
      properties: {
        ...sectionSchemas,
        llmProviders: {
          type: "array",
          items: exportedLlmProviderSchema,
          description: "Configured LLM providers. Present in the export for review purposes but **not** applied by the importer in v1.",
        },
      },
    },
  },
};

const importBodySchema: JsonSchema = {
  type: "object",
  required: ["schemaVersion"],
  description:
    "An export envelope, normally posted back verbatim from `GET /admin/settings/export`, plus an optional `dryRun` flag. Unrecognised top-level keys are ignored.",
  properties: {
    schemaVersion: {
      type: "integer",
      const: 1,
      description:
        "Must equal `1`. Any other value (including a missing key) aborts the whole import — the response is still `200`, with `aggregateStatus: \"failed\"` and a single `extras` section entry naming `schemaVersion`.",
    },
    sections: {
      type: "object",
      description:
        "Sections to apply, keyed by section id. Omit a section to leave the target deployment's value untouched — it comes back as `skipped`. Each present section is validated against that section's schema; a section that fails validation is reported as `failed` and skipped, while its siblings still apply. Secret fields carrying a `<REDACTED:...>` or mid-mask sentinel preserve the target's existing value rather than overwriting it with the sentinel string.",
      properties: {
        ...sectionSchemas,
        llmProviders: {
          type: "array",
          items: exportedLlmProviderSchema,
          description:
            "Accepted but never applied in v1. Supplying it adds an `llmProviders` entry to the response with `status: \"skipped\"` and an explanatory error. Manage providers through `/admin/settings/llm-providers` instead.",
        },
      },
    },
    dryRun: {
      type: "boolean",
      description:
        "When `true`, validate every section and report what would happen without writing anything. Dry-run sections report `status: \"applied\"` with an empty `changedFields`, so use the flag to catch validation failures, not to preview a diff. Combined with the `dryRun` query parameter by logical OR, not by precedence: the import is a dry run when this field is `true` **or** the query parameter is `1`/`true`. Sending `dryRun: false` therefore cannot force a real write past a `?dryRun=1` on the URL — remove the query parameter instead.",
    },
  },
};

const importResultSchema: JsonSchema = {
  type: "object",
  required: ["schemaVersion", "aggregateStatus", "sections"],
  properties: {
    schemaVersion: { type: "integer", const: 1, description: "The schema version the server understands. Always `1`, even on a rejected import." },
    aggregateStatus: {
      type: "string",
      enum: ["applied", "partial", "failed"],
      description:
        "Roll-up across the section results: `failed` when every section that was attempted failed, `partial` when some applied and some failed, `applied` when none failed. Careful — an import that touched nothing at all (all sections skipped) also reports `applied`, so confirm against `sections[].status` rather than trusting this field to mean \"something changed\".",
    },
    sections: {
      type: "array",
      description: "One entry per known section, in registry order, plus a trailing `llmProviders` entry when that key was present in the request.",
      items: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: {
            type: "string",
            enum: [...Object.keys(sectionSchemas), "llmProviders"],
            description: "Section id this result describes.",
          },
          status: {
            type: "string",
            enum: ["applied", "skipped", "failed"],
            description:
              "`applied` — written (or, under `dryRun`, validated cleanly). `skipped` — absent from the request, or an `llmProviders` block that v1 refuses to apply. `failed` — the payload did not validate, or the write threw.",
          },
          changedFields: {
            type: "array",
            items: { type: "string" },
            description: "Field names whose stored value actually changed. Empty on a no-op write and always empty under `dryRun`. Absent on `skipped` and `failed` entries.",
          },
          errors: {
            type: "array",
            description: "Why this section failed, one entry per problem. Absent on success.",
            items: {
              type: "object",
              required: ["field", "message"],
              properties: {
                field: { type: "string", description: "Dotted path to the offending field, or the empty string when the failure was not field-specific (e.g. a write error)." },
                message: { type: "string", description: "What was wrong." },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Mirror payloads
// ---------------------------------------------------------------------------

const reconcileAcceptedSchema: JsonSchema = {
  type: "object",
  required: ["status", "startedAt"],
  properties: {
    status: { type: "string", enum: ["running"], description: "Always `running` — the response is sent before any work happens." },
    startedAt: {
      type: "string",
      format: "date-time",
      description: "When this pod started the run (ISO 8601, UTC). Quote it if a later `409` reports a run still in flight.",
    },
  },
};

const mirrorStatusSchema: JsonSchema = {
  type: "object",
  required: ["enabled", "repo", "appId", "installationId", "appPrivateKey", "counts", "scheduledRun"],
  properties: {
    enabled: { type: "boolean", description: "Mirror kill switch. When `false` no reconcile runs, scheduled or manual." },
    repo: {
      type: "object",
      required: ["owner", "repo", "branch"],
      description: "Target repository coordinates. All three are empty strings when the mirror has never been configured.",
      properties: {
        owner: { type: "string", description: "GitHub owner (user or org login).", examples: ["ChronoAIProject"] },
        repo: { type: "string", description: "GitHub repository name.", examples: ["ornn-skills"] },
        branch: { type: "string", description: "Branch commits land on.", examples: ["main"] },
      },
    },
    appId: { type: "string", description: "GitHub App id used to authenticate the mirror. Empty string when unset." },
    installationId: { type: "string", description: "GitHub App installation id on the target repository. Empty string when unset." },
    appPrivateKey: { type: "string", description: `GitHub App private key. ${MASK_NOTE}` },
    counts: {
      type: "object",
      required: ["eligible", "synced", "lagging", "neverSynced", "oldestUnsyncedAt"],
      description:
        "Live aggregate over every **public** skill — private skills are never mirrored and are excluded from all four counts. `eligible === synced + lagging + neverSynced`.",
      properties: {
        eligible: { type: "integer", description: "Public skills, i.e. everything the mirror is responsible for." },
        synced: { type: "integer", description: "Skills whose mirrored version equals their current latest version." },
        lagging: { type: "integer", description: "Skills mirrored at an older version than their current latest — a reconcile will move these." },
        neverSynced: { type: "integer", description: "Skills that have never been committed to the mirror." },
        oldestUnsyncedAt: {
          type: ["string", "null"],
          format: "date-time",
          description: "Creation timestamp of the oldest never-synced skill (ISO 8601, UTC), or `null` when `neverSynced` is 0. The practical \"how far behind are we\" signal.",
        },
      },
    },
    scheduledRun: {
      type: "object",
      required: ["status", "lastRunAt", "lastFinishedAt", "lastDurationMs", "lastError", "nextRunAt"],
      description:
        "The cluster-wide, persisted view of the most recent **scheduled** fire. Manual runs started through `POST /admin/mirror/reconcile` are tracked per-pod and never appear here — polling this block will not tell you when your manual reconcile finished. Every field reads as its empty value when the scheduler failed to start on this pod.",
      properties: {
        status: {
          type: "string",
          enum: ["succeeded", "failed", "running", "never_run"],
          description: "Outcome of the last scheduled fire. `never_run` means no run has been recorded — a fresh deployment, or the schedule is disabled.",
        },
        lastRunAt: { type: ["string", "null"], format: "date-time", description: "Start of the last scheduled fire (ISO 8601, UTC)." },
        lastFinishedAt: { type: ["string", "null"], format: "date-time", description: "End of the last scheduled fire (ISO 8601, UTC). `null` while one is in flight." },
        lastDurationMs: { type: ["integer", "null"], description: "Wall-clock duration of the last completed scheduled fire, in milliseconds." },
        lastError: { type: ["string", "null"], description: "Failure message from the last fire; `null` unless `status` is `failed`." },
        nextRunAt: { type: ["string", "null"], format: "date-time", description: "Next scheduled fire (ISO 8601, UTC), or `null` when the cron is empty or the scheduler is not running." },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Launch-promo payloads
// ---------------------------------------------------------------------------

const launchPromoAwardSchema: JsonSchema = {
  type: "object",
  required: ["claim"],
  properties: {
    claim: {
      type: "object",
      required: ["userId", "eligibilityRank", "redemptionCodeId", "redemptionCode", "awardedAt", "awardedBy"],
      properties: {
        userId: { type: "string", description: "The awarded user's NyxID id — the `{userId}` path parameter, echoed back." },
        eligibilityRank: {
          type: "integer",
          description: "The user's 1-based Ornn registration rank at award time, frozen onto the claim so a later audit can answer \"why was this user eligible\".",
          examples: [37],
        },
        redemptionCodeId: { type: "string", description: "Id of the minted redemption code in the redemption-codes domain." },
        redemptionCode: {
          type: "string",
          description:
            "The code string itself. This is the **only** place it is returned — the claim record stores only the id. The user also receives it in an in-app notification, so there is normally no need to relay it manually.",
        },
        awardedAt: { type: "string", format: "date-time", description: "When the award landed (ISO 8601, UTC)." },
        awardedBy: { type: "string", description: "Who triggered it: the calling admin's user id here, or the sentinel `system:cron` for automated awards." },
      },
    },
  },
};

const launchPromoRecentSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "Most recent claims first. No pagination cursor — raise `limit` to see further back.",
      items: {
        type: "object",
        required: ["userId", "eligibilityRank", "redemptionCodeId", "awardedAt", "awardedBy", "githubLogin"],
        properties: {
          userId: { type: "string", description: "Awarded user's NyxID id." },
          eligibilityRank: { type: "integer", description: "Registration rank frozen at award time." },
          redemptionCodeId: {
            type: "string",
            description: "Redemption-code id. The code string is deliberately not exposed here — only the award response returns it.",
          },
          awardedAt: { type: "string", format: "date-time", description: "When the award landed (ISO 8601, UTC)." },
          awardedBy: { type: "string", description: "Admin user id, or the sentinel `system:cron`." },
          githubLogin: {
            type: ["string", "null"],
            description: "GitHub login recorded at award time. Populated on cron-driven awards (that is how the user was matched) and normally `null` for manual admin awards.",
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function adminPaths(prefix: string): PathMap {
  return {
    [`${prefix}/admin/skills`]: {
      get: {
        summary: "List every skill on the platform",
        description:
          `Moderation listing over the entire registry. Unlike \`GET /api/v1/skill-search\` and every other listing in the API, this one applies **no visibility filter**: private skills belonging to other users are returned in full, which is exactly why it sits behind the platform-admin scope. Results are always sorted by creation time, newest first; there is no sort parameter. Use it to find a skill to moderate, then act with \`DELETE /api/v1/admin/skills/{id}\` or the AgentSeal rescan endpoint. For ordinary discovery — including anything an agent does on its own behalf — use the search endpoints instead; they are cheaper and respect visibility. Pagination is page-based rather than cursor-based here, and out-of-range or non-numeric pagination values are silently clamped rather than rejected, so always read \`page\` and \`pageSize\` back off the response instead of assuming the server used what you sent. Both the count and the fetch run under a five-second server-side time limit; a query broad enough to exceed it fails with \`500\` rather than holding the database connection open. ${ADMIN_SCOPE_NOTE}`,
        operationId: "listAdminSkills",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "page",
            "1-based page number. Values below 1, non-numeric values, and a missing parameter all resolve to 1. There is no upper bound — a page past the end returns an empty `items` array with the real `total`.",
            { type: "integer", minimum: 1, default: 1, examples: [1] },
          ),
          queryParam(
            "pageSize",
            "Rows per page. Clamped to 1–100; anything outside that range, including a non-numeric value, is clamped rather than rejected. Defaults to 20.",
            { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] },
          ),
          queryParam(
            "q",
            "Case-insensitive substring filter matched against skill `name` **or** `description`. Regex metacharacters are escaped server-side, so the value is treated as a literal. Omit or send an empty string for no filter. Note this is an unanchored scan — a very short `q` on a large registry is the query most likely to hit the five-second timeout.",
            { type: "string", examples: ["pdf"] },
          ),
          queryParam(
            "userId",
            "Restrict the listing to skills owned by this NyxID user id (exact match on the skill's `createdBy`). Take the value from `items[].createdBy` here or from `GET /api/v1/admin/users`. Combines with `q` as a logical AND.",
            { type: "string", examples: ["usr_01HXYZ7QK3M2N4P5R6S7T8V9W0"] },
          ),
        ],
        responses: {
          ...jsonResponse(adminSkillListSchema, "One page of skills, newest first.", {
            example: {
              items: [
                {
                  guid: "3f2a91c4-0d5b-4a1e-9d2f-7c8b6e5a4310",
                  name: "web-summarizer",
                  description: "Summarise a web page into bullet points.",
                  createdBy: "usr_01HXYZ7QK3M2N4P5R6S7T8V9W0",
                  createdByEmail: "author@example.com",
                  createdByDisplayName: "Ada Lovelace",
                  createdOn: "2026-07-14T09:21:04.113Z",
                  updatedOn: "2026-08-02T16:40:55.007Z",
                  isPrivate: false,
                  tags: ["web", "summarisation"],
                },
              ],
              total: 1,
              page: 1,
              pageSize: 20,
              totalPages: 1,
            },
          }),
          ...problemResponses(401, 403, {
            500: "The listing exceeded the five-second server-side query budget, or the database was unreachable. Narrow the filter (a longer `q`, or a `userId`) and retry.",
          }),
        },
      },
    },

    [`${prefix}/admin/skills/{id}`]: {
      delete: {
        summary: "Hard-delete any skill",
        description:
          `Permanently removes a skill regardless of who owns it: every version row is dropped, every stored package is deleted from object storage, and the skill document itself is removed. There is no soft-delete, no tombstone, and no undo — a subsequent read of the same id or name returns \`404\`, and the name becomes available for reuse. Prefer deprecation or a visibility flip for anything short of abuse. Storage cleanup is best-effort: an object-storage failure is logged and the database rows are still removed, so an orphaned package may survive a partial failure while the API-level delete still reports success. The operation is effectively idempotent from the caller's point of view — the second call answers \`404\`. ${ADMIN_SCOPE_NOTE}`,
        operationId: "deleteAdminSkill",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Skill **guid**. This endpoint resolves by id only — unlike most skill routes it will not accept a skill name, and passing one produces `404` (`code: \"skill_not_found\"`). Read the value from `guid` in `GET /api/v1/admin/skills`.",
            { type: "string" },
            "3f2a91c4-0d5b-4a1e-9d2f-7c8b6e5a4310",
          ),
        ],
        responses: {
          ...jsonResponse(successFlagSchema, "The skill, all of its versions, and its packages were deleted.", {
            example: { success: true },
          }),
          ...problemResponses(401, 403, {
            404: "No skill with this guid (`code: \"skill_not_found\"`). Also returned when a skill *name* was passed instead of a guid.",
          }),
        },
      },
    },

    [`${prefix}/admin/skills/{idOrName}/versions/{version}/agentseal-rescan`]: {
      post: {
        summary: "Re-run the AgentSeal scan on one skill version",
        description:
          `Re-downloads the immutable package for a single published version, runs the AgentSeal static safety sweep over it, and overwrites that version's stored trust score and findings with the result. Two reasons to call it: a false positive that a newer AgentSeal ruleset has since fixed, and picking up a rules update without waiting for the author to publish again. Only this one version is touched — sibling versions keep their existing scores. The scan is synchronous and can take a while on a large package, so use a generous client timeout rather than retrying on a slow response; a retry runs the whole scan again. No request body is required. Note the \`null\` case in the response: when the deployment has a scanner wired but the scan yields no result, the response is \`200\` with \`scan: null\` and **nothing is persisted** — the previous snapshot survives untouched. Treat \`null\` as "unknown", never as "clean". ${ADMIN_SCOPE_NOTE}`,
        operationId: "rescanSkillVersionAgentSeal",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "idOrName",
            "Skill guid **or** registry-unique skill name. The guid is tried first, then the name, so either works.",
            { type: "string" },
            "web-summarizer",
          ),
          pathParam(
            "version",
            "Exact `<major>.<minor>` version to rescan — two non-negative integers, no leading zeroes and no patch component. Dist-tags such as `latest` are **not** resolved here; resolve the tag first via `GET /api/v1/skills/{idOrName}/dist-tags` and pass the literal version.",
            { type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" },
            "1.4",
          ),
        ],
        responses: {
          ...jsonResponse(agentsealRescanSchema, "The scan completed. When `scan` is non-null it has already been persisted onto the version document.", {
            example: {
              skillGuid: "3f2a91c4-0d5b-4a1e-9d2f-7c8b6e5a4310",
              skillName: "web-summarizer",
              version: "1.4",
              scan: {
                score: 92,
                findings: [],
                scannedAt: "2026-08-07T04:12:30.442Z",
                agentsealVersion: "0.9.3",
                scannedFiles: 11,
              },
            },
          }),
          ...problemResponses(
            {
              400: "The `version` path segment is not a valid `<major>.<minor>` string (`code: \"invalid_version\"`). Dist-tag names land here too.",
            },
            401,
            403,
            {
              404: "No such skill (`code: \"skill_not_found\"`), or the skill exists but has no such version (`code: \"skill_version_not_found\"`).",
              500: "The package could not be downloaded from object storage, or the scanner crashed mid-sweep. The stored snapshot is unchanged; retry.",
              503:
                "This deployment has no AgentSeal scanner wired (`code: \"agentseal_disabled\"`) — common in development and CI images that ship without the scanner binary. Nothing was scanned and nothing was written; retrying will not help until the deployment is reconfigured. **Body shape warning:** this particular 503 is emitted inline as the legacy `{ \"data\": null, \"error\": { \"code\", \"message\" } }` envelope under `application/json`, not as the RFC 7807 document shown here.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/users`]: {
      get: {
        summary: "List platform users",
        description:
          `The admin user roster, one role bucket at a time, with per-user activity and authorship counts. The pool is Ornn's own user directory — a row appears the first time a user authenticates against Ornn, so this is not a mirror of the NyxID account list and a NyxID user who has never called Ornn will not be here. Use it to find the \`userId\` that other admin endpoints take (skill filtering, quota administration, launch-promo awards). Sorting happens in the application rather than the database, which is why the role pool is hard-bounded at 5000 rows: the query returns at most 5000 matching users in the database's natural order, and only then are the skill counts joined, the sort applied, and the page sliced. On a bucket bigger than that, \`total\` saturates at exactly 5000, \`totalPages\` follows it, and which users were dropped is not determined by any ordering you can see here — narrow with \`q\` rather than paging deeper. Pagination values are clamped silently, but \`role\`, \`sort\`, and \`dir\` are validated strictly and reject unknown values with \`400\`. ${ADMIN_SCOPE_NOTE}`,
        operationId: "listAdminUsers",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "role",
            "Which bucket to list. `admin` = users whose most recent token carried the platform-admin scope; `normal` = everyone else. The two buckets are disjoint and there is no \"all\" option — call twice to see the whole directory. Defaults to `normal`. Any other value is a `400` (`code: \"invalid_role\"`).",
            { type: "string", enum: ["admin", "normal"], default: "normal" },
          ),
          queryParam(
            "page",
            "1-based page number. Values below 1 and non-numeric values resolve to 1. Defaults to 1.",
            { type: "integer", minimum: 1, default: 1, examples: [1] },
          ),
          queryParam(
            "pageSize",
            "Rows per page. Clamped to 1–200 rather than rejected. Defaults to 20.",
            { type: "integer", minimum: 1, maximum: 200, default: 20, examples: [50] },
          ),
          queryParam(
            "q",
            "Case-insensitive filter over the directory, matched as an `email` **prefix** OR a `displayName` **substring**. Mind the asymmetry: the email side is anchored at the start, so `q=\"ada@\"` matches `ada@example.com` but `q=\"@example.com\"` matches no addresses at all however many users are on that domain; the display-name side is unanchored, so `q=\"Lovelace\"` hits `Ada Lovelace`. Regex metacharacters are escaped server-side, so the value is always treated as a literal. Applied before sorting and pagination; whitespace is trimmed and an all-whitespace value counts as absent.",
            { type: "string", examples: ["ada@"] },
          ),
          queryParam(
            "sort",
            "Column to sort by. Defaults to `lastActiveAt`. Rows whose sort value is null always sort last regardless of `dir`. An unrecognised value is a `400` (`code: \"invalid_sort\"`).",
            {
              type: "string",
              enum: ["displayName", "email", "skillCount", "lastActiveAt", "activityCount", "firstJoinedAt"],
              default: "lastActiveAt",
            },
          ),
          queryParam(
            "dir",
            "Sort direction. Defaults to `desc`, which pairs with the default `lastActiveAt` sort to put the most recently active users first. An unrecognised value is a `400` (`code: \"invalid_dir\"`).",
            { type: "string", enum: ["asc", "desc"], default: "desc" },
          ),
        ],
        responses: {
          ...jsonResponse(adminUserListSchema, "One page of users in the requested role bucket.", {
            example: {
              items: [
                {
                  userId: "usr_01HXYZ7QK3M2N4P5R6S7T8V9W0",
                  email: "ada@example.com",
                  displayName: "Ada Lovelace",
                  skillCount: 12,
                  lastActiveAt: "2026-08-07T03:55:12.004Z",
                  activityCount: 4821,
                  firstJoinedAt: "2026-02-11T08:02:44.910Z",
                },
              ],
              page: 1,
              pageSize: 20,
              total: 1,
              totalPages: 1,
            },
          }),
          ...problemResponses(
            {
              400: "`role`, `sort`, or `dir` carried a value outside its enum (`code`: `invalid_role` / `invalid_sort` / `invalid_dir`).",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/dashboard/stats`]: {
      get: {
        summary: "Platform totals",
        description:
          `Two tiles of counters — users split by role, skills split by system / public / private — computed live on every call with no caching. Both groupings are exact partitions, so the sub-counts always add up to their total; that property is worth asserting on if you build alerting off this. It is the cheapest single call for a health-at-a-glance view, but it is not a time series: there is no history, no delta, and no date range. For trends and for the per-event activity feed that used to live next to this endpoint, use the PostHog dashboard the deployment is wired to instead. Takes no parameters. ${ADMIN_SCOPE_NOTE}`,
        operationId: "getAdminDashboardStats",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [],
        responses: {
          ...jsonResponse(dashboardStatsSchema, "Current totals.", {
            example: {
              users: { total: 418, admin: 3, normal: 415 },
              skills: { total: 1204, system: 14, public: 902, private: 288 },
            },
          }),
          ...problemResponses(401, 403),
        },
      },
    },

    [`${prefix}/admin/settings`]: {
      get: {
        summary: "Read platform settings",
        description:
          `Returns the singleton platform-settings document: the audit waiver threshold and the legacy single-provider LLM override. This is a small, legacy surface — the modern, section-based configuration lives under \`/admin/settings/{section}\` and \`/admin/settings/llm-providers\`, and the whole-configuration snapshot is \`GET /api/v1/admin/settings/export\`. Reads are served from a short-lived in-process cache, so a value written through the PATCH below is visible immediately on the pod that handled the write but may take up to about thirty seconds to appear on other pods; do not use this endpoint as a strongly-consistent read-back. \`llmProvider.apiKey\` comes back mid-masked and can be echoed straight back into the PATCH body to leave it unchanged. ${ADMIN_SCOPE_NOTE}`,
        operationId: "getPlatformSettings",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [],
        responses: {
          ...jsonResponse(platformSettingsSchema, "Current platform settings, secrets mid-masked.", {
            example: {
              auditWaiverThreshold: 6,
              llmProvider: { gatewayUrl: "https://api.openai.com/v1", apiKey: "sk-p••••••••3f9a" },
            },
          }),
          ...problemResponses(401, 403),
        },
      },
      patch: {
        summary: "Update platform settings",
        description:
          `Partial update of the platform-settings singleton. Only two keys are recognised, \`auditWaiverThreshold\` and \`llmProvider\`; anything else in the body is ignored, and a body containing none of them is rejected with \`400\` rather than treated as a no-op — that is the guard against a typo'd key silently doing nothing. Validation is per-field and fail-fast: the first bad field aborts the request and nothing is written. \`llmProvider\` is itself a partial — an omitted \`gatewayUrl\` or \`apiKey\` carries the stored value forward — and an \`apiKey\` still containing the \`•\` mask sentinel preserves the existing secret, so the safe pattern is GET, edit the fields you care about, PATCH the whole object back. The response is the full updated document, re-masked, read back through the cache-busting path. ${ADMIN_SCOPE_NOTE}`,
        operationId: "patchPlatformSettings",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [],
        requestBody: jsonBody(platformSettingsPatchSchema, "The settings keys to change.", {
          example: {
            auditWaiverThreshold: 7.5,
            llmProvider: { gatewayUrl: "https://api.anthropic.com/v1", apiKey: "sk-p••••••••3f9a" },
          },
        }),
        responses: {
          ...jsonResponse(platformSettingsSchema, "The updated settings, secrets mid-masked.", {
            // Response to the request example above: `gatewayUrl` took the new
            // value, and the masked `apiKey` that was echoed back preserved the
            // stored secret, so it re-masks to exactly what the GET returned.
            example: {
              auditWaiverThreshold: 7.5,
              llmProvider: { gatewayUrl: "https://api.anthropic.com/v1", apiKey: "sk-p••••••••3f9a" },
            },
          }),
          ...problemResponses(
            {
              400: "The body was not a JSON object (`code: \"invalid_body\"`), contained no recognised setting key, or a recognised key failed its field check — out-of-range threshold, non-object `llmProvider`, non-string or unparseable `gatewayUrl`, non-string `apiKey` (`code: \"invalid_setting\"`).",
            },
            401,
            403,
          ),
        },
      },
    },

    [`${prefix}/admin/settings/export`]: {
      get: {
        summary: "Export the full platform configuration",
        description:
          `Produces a portable snapshot of every settings section — the ten configuration sections plus a read-only view of the configured LLM providers — wrapped in a versioned envelope that \`POST /api/v1/admin/settings/import\` accepts verbatim. Use it to clone a deployment's configuration, to diff staging against production, or to keep a reviewable backup before a risky change. Every secret field is replaced with the string sentinel \`<REDACTED:fieldName>\`, so the file is safe to commit or attach to a ticket; it also means the file alone cannot stand up a new deployment, and the target keeps its own secrets when the sentinel is imported unchanged. Two further gaps to plan around: per-model enable and default flags are not exported (the model catalog is derived data — re-sync it on the target), and the LLM providers block is exported but never applied on import. Despite the \`Content-Disposition\` header this is a normal enveloped JSON response, not a file stream: read the document from \`data\`, and use the header only if you want the server's suggested filename. ${ADMIN_SCOPE_NOTE}`,
        operationId: "exportPlatformSettings",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [],
        responses: {
          ...jsonResponse(exportEnvelopeSchema, "The complete settings snapshot, secrets replaced with redaction sentinels.", {
            headers: {
              "Content-Disposition": {
                description:
                  "`attachment` with a generated filename of the form `ornn-settings-<env>-<iso-timestamp>.json`, where `<env>` is the deployment's configured environment name. Advisory only — the body is still the standard `{ data, error }` envelope, so a client saving the response verbatim would be saving the envelope, not the export document.",
                schema: { type: "string" },
                example: 'attachment; filename="ornn-settings-prod-2026-08-07T04-12-30-442Z.json"',
              },
            },
          }),
          ...problemResponses(401, 403),
        },
      },
    },

    [`${prefix}/admin/settings/import`]: {
      post: {
        summary: "Import a platform configuration snapshot",
        description:
          `Applies an export envelope to this deployment, one section at a time. **Read the result body, not just the status code:** short of a transport-level failure this endpoint answers \`200\` even when nothing was applied — a wrong \`schemaVersion\`, a section that fails validation, and a section whose write threw all surface as entries in \`data.sections[]\` with the roll-up in \`data.aggregateStatus\`. A \`200\` alone is not confirmation of success.\n\nThe apply is per-section atomic but not transactional across sections: sections are processed in registry order, each valid one is written on its own, and a failure part-way through leaves the earlier sections applied. \`aggregateStatus: "partial"\` is the signal for that state. A \`schemaVersion\` mismatch is the one hard stop — it aborts before any write.\n\nAlways dry-run first. Send \`dryRun: true\` in the body (or \`?dryRun=1\`) to validate every section and write nothing. The two sources are OR-ed rather than ranked: dry-run is on as soon as either says so, so \`{"dryRun": false}\` cannot force a real write past a \`?dryRun=1\` on the URL — drop the query parameter instead. Note the asymmetry: a dry-run section reports \`applied\` with an empty \`changedFields\`, so a dry run proves the payload validates but tells you nothing about what would change.\n\nSecret handling mirrors the export: a secret field still carrying \`<REDACTED:...>\` or a mid-mask sentinel preserves the target's existing value instead of overwriting it, so importing a redacted file never destroys credentials on the target. LLM providers are accepted and reported but never applied in v1. ${ADMIN_SCOPE_NOTE}`,
        operationId: "importPlatformSettings",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "dryRun",
            "Validate without writing. Accepts the literal strings `1` or `true`; anything else, including `0` and `false`, is treated as absent. OR-ed with the body field `dryRun`: setting either one turns the dry run on, and neither can switch the other off. Prefer the body, and use the query form only for shell clients that cannot easily edit the payload.",
            { type: "string", enum: ["1", "true"] },
          ),
        ],
        requestBody: jsonBody(importBodySchema, "An export envelope, optionally with `dryRun`.", {
          example: {
            schemaVersion: 1,
            dryRun: true,
            sections: {
              playground: { defaultProviderId: "prv_openai", defaultModelId: "gpt-4o", sseKeepAliveMs: 15000, defaultMonthlyQuota: 200 },
              telemetry: {
                postHogEnabled: true,
                postHogApiKey: "<REDACTED:postHogApiKey>",
                postHogHost: "https://eu.i.posthog.com",
                postHogProjectId: "41822",
                postHogErrorSampleRate: 0.1,
              },
            },
          },
        }),
        responses: {
          ...jsonResponse(
            importResultSchema,
            "The import was processed. Inspect `aggregateStatus` and every entry in `sections[]` — this status is returned for rejected and partially-applied imports too.",
            {
              // Paired with the request example above: a dry run carrying only
              // `playground` and `telemetry`. Every known section gets an entry
              // in registry order — the eight the request omitted come back
              // `skipped` — and dry-run sections report `applied` with an empty
              // `changedFields`, which is why the roll-up reads `applied` even
              // though nothing was written.
              example: {
                schemaVersion: 1,
                aggregateStatus: "applied",
                sections: [
                  { id: "playground", status: "applied", changedFields: [] },
                  { id: "skillGen", status: "skipped" },
                  { id: "assistant", status: "skipped" },
                  { id: "mirror", status: "skipped" },
                  { id: "nyxid", status: "skipped" },
                  { id: "skillAudit", status: "skipped" },
                  { id: "telemetry", status: "applied", changedFields: [] },
                  { id: "extras", status: "skipped" },
                  { id: "launchPromo", status: "skipped" },
                  { id: "sourceSync", status: "skipped" },
                ],
              },
            },
          ),
          ...problemResponses(
            {
              400: "The request body was not valid JSON, or was not a JSON object (`code: \"invalid_body\"`). Semantic problems with an otherwise well-formed envelope are reported in the 200 body instead.",
            },
            401,
            403,
            {
              413: "The body exceeded the deployment's import size cap (1 MiB by default) and was rejected before parsing (`code: \"payload_too_large\"`). Trim the envelope to the sections you actually need. **Body shape warning:** this 413 is emitted inline as the legacy `{ \"data\": null, \"error\": { \"code\", \"message\" } }` envelope under `application/json`, not as the RFC 7807 document shown here.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/mirror/reconcile`]: {
      post: {
        summary: "Trigger a full GitHub mirror reconcile",
        description:
          `Starts a full reconcile of every mirror-eligible skill against the configured GitHub repository and returns immediately with \`202\` — the work runs in the background on the pod that accepted the request, and the response says only that it started. Nothing about the outcome is available from this call. Takes no request body.\n\nPolling for completion is the subtle part. \`GET /api/v1/admin/mirror/status\` reports the last **scheduled** run and does not track manual ones, so the practical signal that a manual reconcile finished is the \`counts\` block in that response settling (\`lagging\` and \`neverSynced\` falling to their expected values). Do not wait on \`scheduledRun\`.\n\nThe in-flight guard is per-pod and in-memory: a second call routed to the same pod while a run is active gets \`409\`, but two pods can each start a run at the same moment. The scheduled path is protected properly; this manual path accepts that small risk, whose worst case is a duplicate-tag conflict logged by the loser. Use it after changing mirror settings or to recover from a failed scheduled run; the daily cron covers steady state. ${ADMIN_SCOPE_NOTE}`,
        operationId: "triggerMirrorReconcile",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [],
        responses: {
          ...jsonResponse(reconcileAcceptedSchema, "The reconcile was accepted and is now running in the background. No work has been done yet when this response is sent.", {
            status: 202,
            example: { status: "running", startedAt: "2026-08-07T04:12:30.442Z" },
          }),
          ...problemResponses(401, 403, {
            409:
              "A reconcile started by this pod is still running (`code: \"reconcile_already_running\"`); the message quotes its start time. Wait for the mirror counts to settle and retry. **Body shape warning:** this 409 is emitted inline as the legacy `{ \"data\": null, \"error\": { \"code\", \"message\" } }` envelope under `application/json`, not as the RFC 7807 document shown here.",
            503:
              "The mirror is switched off, or it is on but incompletely configured — missing owner/repo/branch or GitHub App credentials (`code: \"mirror_disabled\"`; the message distinguishes the two). Fix the configuration under `/admin/settings/mirror` first; retrying changes nothing. **Body shape warning:** this 503 is emitted inline as the legacy `{ \"data\": null, \"error\": { \"code\", \"message\" } }` envelope under `application/json`, not as the RFC 7807 document shown here.",
          }),
        },
      },
    },

    [`${prefix}/admin/mirror/status`]: {
      get: {
        summary: "GitHub mirror status and configuration",
        description:
          `One call that answers "is the mirror configured, is it healthy, and how far behind is it": the full mirror configuration (private key mid-masked), live drift counts over every public skill, and the outcome of the most recent scheduled run. It exists as a single endpoint so an operator view renders without a second round-trip, which is why the configuration block is duplicated here from \`/admin/settings/mirror\`.\n\nThe counts are computed live by scanning public skills, so this is not a free call — poll it on the order of seconds, not continuously. \`counts.lagging\` plus \`counts.neverSynced\` is the practical backlog, and \`counts.oldestUnsyncedAt\` is the age of the worst offender.\n\nThe \`scheduledRun\` block is cluster-wide and persisted, so it survives pod restarts — but it covers **scheduled** fires only. A run started through \`POST /api/v1/admin/mirror/reconcile\` never appears there; watch the counts instead. Takes no parameters. ${ADMIN_SCOPE_NOTE}`,
        operationId: "getMirrorStatus",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [],
        responses: {
          ...jsonResponse(mirrorStatusSchema, "Mirror configuration, drift counts, and the last scheduled run.", {
            example: {
              enabled: true,
              repo: { owner: "ChronoAIProject", repo: "ornn-skills", branch: "main" },
              appId: "1284412",
              installationId: "78221093",
              appPrivateKey: "----••••••••----",
              counts: { eligible: 902, synced: 874, lagging: 21, neverSynced: 7, oldestUnsyncedAt: "2026-06-30T11:02:19.884Z" },
              scheduledRun: {
                status: "succeeded",
                lastRunAt: "2026-08-07T02:00:00.000Z",
                lastFinishedAt: "2026-08-07T02:04:41.219Z",
                lastDurationMs: 281219,
                lastError: null,
                nextRunAt: "2026-08-08T02:00:00.000Z",
              },
            },
          }),
          ...problemResponses(401, 403),
        },
      },
    },

    [`${prefix}/admin/launch-promo/award/{userId}`]: {
      post: {
        summary: "Manually award the launch promo to a user",
        description:
          `Grants one launch-promo claim to a specific user: mints a redemption code carrying the configured Playground and Skill-Generation credits, records an append-only claim row, and drops an in-app notification containing the code. Takes no request body — the grant amounts, slot cap, and code expiry all come from the \`launchPromo\` settings section, so configure that section before calling this.\n\nEvery eligibility rule is enforced server-side and each failure gets its own status: the promo must be enabled (\`400\`), the user must exist in Ornn's directory (\`404\`), their registration rank must fall within the slot cap (\`403\`), free slots must remain (\`409\`), and they must not already have claimed (\`409\`). None of those are retryable without changing configuration or picking a different user.\n\nIdempotent by construction: the claim row is keyed on the user id, so a duplicate call — including two racing calls — yields exactly one award and \`ALREADY_CLAIMED\` for the loser. Safe to retry blindly after a network timeout. The credits are **not** applied directly; the user redeems the returned code themselves. The response is the only place the code string is returned, but the user already has it in their notification, so relaying it manually is normally unnecessary. Note the status code: this creates a claim yet answers \`200\`, not \`201\`, and sends no \`Location\` header. ${ADMIN_SCOPE_NOTE}`,
        operationId: "awardLaunchPromo",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "userId",
            "NyxID user id of the recipient, exactly as it appears in `GET /api/v1/admin/users`. Not an email and not a display name — an unknown id is a `404`.",
            { type: "string" },
            "usr_01HXYZ7QK3M2N4P5R6S7T8V9W0",
          ),
        ],
        responses: {
          ...jsonResponse(launchPromoAwardSchema, "The claim was recorded and a redemption code was minted. The notification carrying the code is best-effort: a delivery failure is logged and does not roll back the award.", {
            example: {
              claim: {
                userId: "usr_01HXYZ7QK3M2N4P5R6S7T8V9W0",
                eligibilityRank: 37,
                redemptionCodeId: "rc_01HXYZ8M2N4P5R6S7T8V9W0AB",
                redemptionCode: "ORNN-LAUNCH-7QK3-M2N4",
                awardedAt: "2026-08-07T04:12:30.442Z",
                awardedBy: "usr_01HADMIN4P5R6S7T8V9W0XYZ",
              },
            },
          }),
          ...problemResponses(
            {
              400: "The launch promo is disabled, or it is enabled but configured with zero credits on both surfaces, which would mint a useless code (`code: \"PROMO_DISABLED\"`). Fix the `launchPromo` settings section first.",
            },
            401,
            {
              403: "Either the caller lacks `ornn:admin:skill` (`code: \"forbidden\"`), or the target user's registration rank is past the configured slot cap and they were never eligible (`code: \"RANK_EXCEEDED\"`). Branch on `code` — the two are unrelated.",
              404: "No such user in Ornn's directory (`code: \"USER_NOT_FOUND\"`). The user must have authenticated against Ornn at least once before they can be awarded.",
              409: "Either the user has already claimed (`code: \"ALREADY_CLAIMED\"`, also returned when two callers raced and the other one won) or every configured slot is already taken (`code: \"SLOTS_EXHAUSTED\"`).",
              500: "The award failed for a reason outside the eligibility rules — typically minting the redemption code (`code: \"LAUNCH_PROMO_ERROR\"`). Retry is safe: the claim row is written only after the code exists, and its primary key prevents a double award.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/launch-promo/recent`]: {
      get: {
        summary: "List recent launch-promo awards",
        description:
          `Observability over the launch promo: the most recently awarded claims, newest first, spanning both manual admin awards and automated ones (\`awardedBy\` distinguishes them — a real user id versus the sentinel \`system:cron\`). Use it to confirm an award landed, to audit who granted what, and to sanity-check burn rate against the configured slot cap. For the remaining-slot count itself, read \`slotsRemaining\` from \`GET /api/v1/me/launch-promo\` — that is the only endpoint that computes it. The \`launchPromo\` settings section carries \`totalSlots\`, the configured cap, not the remainder.\n\nThere is no cursor and no total: the only control is \`limit\`, and to look further back you raise it. Redemption code **strings** are deliberately not exposed — only their ids — so this endpoint cannot be used to harvest unredeemed codes. Awards are append-only, so a row that appears here never changes or disappears. ${ADMIN_SCOPE_NOTE}`,
        operationId: "listRecentLaunchPromoAwards",
        tags: ["Admin"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "limit",
            "Maximum claims to return, newest first. Clamped to 1–500 rather than rejected, so an out-of-range or non-numeric value is silently corrected. Defaults to 50.",
            { type: "integer", minimum: 1, maximum: 500, default: 50, examples: [50] },
          ),
        ],
        responses: {
          ...jsonResponse(launchPromoRecentSchema, "The most recent claims, newest first.", {
            example: {
              items: [
                {
                  userId: "usr_01HXYZ7QK3M2N4P5R6S7T8V9W0",
                  eligibilityRank: 37,
                  redemptionCodeId: "rc_01HXYZ8M2N4P5R6S7T8V9W0AB",
                  awardedAt: "2026-08-07T04:12:30.442Z",
                  awardedBy: "usr_01HADMIN4P5R6S7T8V9W0XYZ",
                  githubLogin: null,
                },
              ],
            },
          }),
          ...problemResponses(401, 403),
        },
      },
    },
  };
}
