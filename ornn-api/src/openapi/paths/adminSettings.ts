/**
 * Admin platform-configuration surface (#1214) — 27 operations behind the
 * single `ornn:admin:skill` request scope.
 *
 * Two sub-surfaces live here, and they are not variations of each other:
 *
 *   1. **Settings sections** — ten `GET` + `PUT` pairs at
 *      `/admin/settings/{publicPath}`. Each section is one document in
 *      `platform_settings`, owned by one subsystem, with its own Zod
 *      schema. `domains/settings/routes.ts` registers them in a loop over
 *      the section registry, so the *paths themselves are computed at boot*
 *      — which is precisely why a source-code scan missed all twenty of
 *      them and the router-reflection contract test did not.
 *   2. **LLM providers** — full CRUD over `llm_providers`, plus the
 *      upstream model-catalog sync and the per-model surface-flag patch
 *      (#270). This is the catalogue the section pins in (1) point at.
 *
 * **The section half of this module is generated, not transcribed.** It
 * iterates the same `sections` registry the router iterates and derives
 * every path key, request body, and response payload from the registry
 * entry's own `publicPath`, `schema`, `secretFields`, and `defaults`. Add
 * an eleventh section and its two operations appear here on their own,
 * with a real payload schema, without anyone editing this file — the
 * reflection test cannot go red for a section that exists. What a new
 * section *does* need is a row in `SECTION_PROSE` below: `Record<SectionId,
 * …>` is total, so TypeScript names the missing row at compile time. A
 * runtime fallback keeps the document buildable in the meantime, so the
 * failure surfaces as a typecheck error rather than a spec-build crash.
 *
 * Three behaviours of this surface trip up integrators, all documented per
 * operation below:
 *
 * **Secrets round-trip as masks.** A secret field never leaves the server
 * in plaintext: `GET` mid-masks it, and a `PUT` carrying a value that still
 * contains the mask's `•` sentinel means *keep the stored secret*. The
 * whole point is that read-modify-write is safe. An admin UI depends on it.
 *
 * **The section `PUT` returns a third top-level key.** Its body is
 * `{ data, error, meta }`, where `meta.changedFields` lists the field names
 * that actually changed. That is not the standard envelope, so it is
 * described here by hand rather than through `jsonResponse`.
 *
 * **A section `PUT` is a full replace, not a merge.** The body is validated
 * against the entire section schema; an omitted required field is a `400`,
 * not "leave it alone".
 *
 * @module openapi/paths/adminSettings
 */

import {
  bearerAuth,
  envelope,
  jsonBody,
  jsonResponse,
  noContentResponse,
  pathParam,
  problemResponses,
  toSchema,
  type JsonSchema,
  type PathItem,
  type PathMap,
} from "../helpers";
import { sections, type SectionId } from "../../domains/settings/sections";
import {
  modelFlagsPatchSchema,
  providerCreateSchema,
  providerUpdateSchema,
} from "../../domains/settings/llmProviders/service";

// ---------------------------------------------------------------------------
// Shared prose
// ---------------------------------------------------------------------------

/**
 * Appended to every description in this module. Every route here is
 * `nyxidAuthMiddleware()` followed by `requirePermission("ornn:admin:skill")`,
 * in that order, which is what fixes 401-before-403.
 */
const ADMIN_SCOPE_NOTE =
  "Requires a bearer token whose `permissions` array contains the platform-admin request scope `ornn:admin:skill`. Authentication is checked first: no token, an expired token, or one the proxy could not validate is `401` (`code: \"auth_missing\"`), and a valid token without the scope is `403` (`code: \"forbidden\"`). There is no finer-grained settings scope — the same one scope unlocks every operation in this module.";

/** Read-path caching. Identical for all ten sections (`SettingsServiceImpl`). */
const CACHE_NOTE =
  "Section reads are served from a per-pod in-process cache with a 30-second TTL. The pod that handles a write busts its own entry, so reading back through the same connection is immediate, but another replica can keep serving the previous value for up to thirty seconds. Do not treat this as a strongly-consistent read-back, and do not poll it as a change feed.";

/** Applies to every section: a missing row reads as the section defaults. */
const DEFAULTS_NOTE =
  "A section that has never been written is not a `404` — stored values are merged over the section defaults on read, so every documented field is always present and a fresh deployment returns a fully-populated document.";

/**
 * Mid-mask semantics. The single most confusing part of this surface: the
 * mask is a *sentinel*, not a redaction, and echoing it back is the
 * supported way to leave a credential untouched.
 */
const MASK_SEMANTICS =
  "Secret fields are encrypted at rest and never returned in plaintext. `GET` replaces the value with a **mid-mask** — first four characters, a run of `•` (U+2022), last four (`ghp_••••••••7f3a`); anything eight characters or shorter is blurred entirely, and an unset secret stays the empty string. The bullet is a sentinel: on `PUT`, a value containing a `•` **anywhere** means *keep the secret already stored*, so the read-modify-write round trip — `GET`, edit the other fields, `PUT` the whole object back — preserves the credential without the client ever holding it. Send a plaintext value to rotate the secret, or the empty string to clear it. Never try to reconstruct the real value from a mask, and never persist a mask as if it were the credential. `GET /api/v1/admin/settings/export` uses a second sentinel, `<REDACTED:fieldName>`, with exactly the same preserve-on-write meaning.";

/**
 * Per-section secret sentence, derived from the registry's `secretFields`
 * so it can never disagree with what the route actually masks.
 */
function secretNote(secretFields: ReadonlyArray<string>): string {
  if (secretFields.length === 0) {
    return "This section stores no secrets: every field round-trips verbatim, and nothing in it is masked or encrypted.";
  }
  const list = secretFields.map((field) => `\`${field}\``).join(", ");
  const plural = secretFields.length > 1 ? "s" : "";
  return `Secret field${plural} in this section: ${list}. ${MASK_SEMANTICS}`;
}

/**
 * `meta` on a section `PUT`. Modelled by hand because it is a third
 * top-level key the standard envelope helper does not know about.
 */
const changedFieldsMetaSchema: JsonSchema = {
  type: "object",
  required: ["changedFields"],
  description:
    "Write receipt. This key sits **beside** `data` and `error` at the top level of the body — it is not part of the standard success envelope, and it is present only on this `PUT`.",
  properties: {
    changedFields: {
      type: "array",
      items: { type: "string" },
      description:
        "Names of the fields whose stored value actually changed, compared field-by-field against the pre-write document (objects and arrays by their JSON form). Names only — values, secret or not, are never echoed here. A secret appears in this list only when you sent a new plaintext value; sending the mask back leaves it out, which makes this the cheapest way to confirm that a round trip preserved rather than rotated a credential. An empty array means the write was accepted and changed nothing.",
      examples: [["enabled", "reconcileSchedule"]],
    },
  },
};

// ---------------------------------------------------------------------------
// Per-section prose
// ---------------------------------------------------------------------------

/**
 * The half of a section's documentation that cannot be derived: what the
 * section actually controls and what writing it does to a running
 * deployment. Everything else — path, payload schema, secret list, example
 * skeleton — comes from the registry entry.
 */
interface SectionProse {
  /** Human name of the section, used in both summaries. */
  readonly title: string;
  /** What this section owns, field by field. Multi-sentence. */
  readonly overview: string;
  /** What changes in the running system when it is written. Multi-sentence. */
  readonly writeEffect: string;
  /**
   * Realistic values layered over `meta.defaults` to build the payload
   * example. Merging over the defaults guarantees the example carries every
   * field the current schema declares, without hand-maintaining a full copy.
   */
  readonly exampleOverrides?: Readonly<Record<string, unknown>>;
  /** Plausible `meta.changedFields` for the `PUT` response example. */
  readonly changedFieldsExample: readonly string[];
}

/**
 * Keyed by section **id**, not by URL path — the two differ for three
 * sections (`skillGen` → `skill-generation`, `nyxid` → `integrations/nyxid`,
 * `telemetry` → `posthog`), and the id is what the export/import payloads
 * and the Mongo `_id` use.
 *
 * Total by construction: adding a `SectionId` without a row here is a
 * compile error naming the missing section.
 */
const SECTION_PROSE: Record<SectionId, SectionProse> = {
  playground: {
    title: "Playground",
    overview:
      "Owns the Playground surface — the sandboxed multi-turn chat at `POST /api/v1/playground/chat`. `defaultProviderId` and `defaultModelId` pin the LLM the surface uses when a request omits `model`; the pin outranks the per-model `defaultForPlayground` flag managed under `/admin/settings/llm-providers`, and `GET /api/v1/me/models?surface=playground` reports it as `defaultModelId` so the picker's pre-selection and the execute-path fallback agree. `sseKeepAliveMs` (1000–600000) is how often the chat stream emits a keep-alive frame to stop an idle proxy closing the connection. `defaultMonthlyQuota` (0–1000000) is the monthly Playground allowance a non-admin user starts with.",
    writeEffect:
      "The new provider/model pin takes effect on the next chat turn resolved by a pod whose cache has expired — there is no restart and no draining of in-flight streams. Nothing here checks that the pinned provider or model exists or is enabled for this surface; the schema validates types only, so a stale `defaultModelId` is accepted at this write and fails later on the execute path instead. `defaultMonthlyQuota` seeds new grants only and does not retroactively raise or claw back an allowance already issued.",
    exampleOverrides: {
      defaultProviderId: "8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742",
      defaultModelId: "gpt-4o",
    },
    changedFieldsExample: ["defaultModelId"],
  },

  skillGen: {
    title: "Skill generation",
    overview:
      "Owns the skill-authoring surface — the three streaming generators at `POST /api/v1/skills/generate`, `.../generate/from-source`, and `.../generate/from-openapi`. The four knobs mirror `playground` exactly: `defaultProviderId` / `defaultModelId` pin the LLM used when the request omits `model` (outranking the per-model `defaultForSkillGen` flag), `sseKeepAliveMs` (1000–600000) paces the generation stream's keep-alive frames, and `defaultMonthlyQuota` (0–1000000) is the monthly generation allowance for a non-admin user — seeded lower than Playground's by default because a generation turn is the more expensive call. Note that the LLM skill-audit pipeline borrows this surface for model resolution when `skillAudit.llmAuditDefaultModelId` is unset; there is no dedicated audit surface.",
    writeEffect:
      "Applies to the next generation request resolved after the writing pod's cache entry expires; a stream already open keeps the model it started with. As with `playground`, the pinned ids are not checked for existence or for being enabled on this surface, so a wrong id is accepted here and fails when a generation is attempted. Because the audit pipeline falls through to this surface, changing the pin can silently re-point LLM audits as well.",
    exampleOverrides: {
      defaultProviderId: "8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742",
      defaultModelId: "claude-sonnet-4-6",
    },
    changedFieldsExample: ["defaultProviderId", "defaultModelId"],
  },

  assistant: {
    title: "Ornn Assistant",
    overview:
      "Owns the Ornn Assistant surface (#970) — the grounded, non-agentic Q&A chat at `POST /api/v1/assistant/chat`, which answers from a curated knowledge base plus a visibility-scoped skill retrieval and executes nothing. Field-for-field identical to `playground` and `skillGen` so the resolver, quota, and SSE machinery treat all three surfaces uniformly: provider/model pin, keep-alive cadence, and the starting monthly allowance, which is seeded between the other two because Q&A turns are cheaper than generation but more frequent than Playground runs.",
    writeEffect:
      "Takes effect on the next assistant turn once the writing pod's cache entry expires. One asymmetry worth knowing before you rely on the picker: the `GET /api/v1/me/models` default resolver only special-cases `playground` and falls through to the skill-generation section for every other surface, so an assistant pin set here changes what the assistant actually uses but is not what the model picker reports for `surface=assistant`.",
    exampleOverrides: {
      defaultProviderId: "8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742",
      defaultModelId: "gpt-4o-mini",
    },
    changedFieldsExample: ["defaultModelId", "defaultMonthlyQuota"],
  },

  mirror: {
    title: "GitHub mirror",
    overview:
      "Owns the GitHub mirror — the job that publishes this registry's skills into a GitHub repository. `enabled` is the master switch. `owner` / `repo` / `branch` are the destination coordinates; `owner` and `repo` must satisfy GitHub's own naming rules (`owner` up to 40 characters of alphanumerics and inner hyphens, `repo` up to 100 of alphanumerics, dot, underscore, hyphen) or be the empty string for \"not configured\". `appId`, `installationId`, and `appPrivateKey` are the GitHub App credentials the mirror authenticates with. `reconcileSchedule` is a cron expression parsed by `cron-parser` (five-field UNIX or six-field with-seconds, both accepted) and interpreted in `Asia/Singapore`, which has no DST — the default `0 2 * * *` reads literally as 02:00 Singapore time. An empty `reconcileSchedule` disables the scheduled sweep only; publish-time webhooks still fire.",
    writeEffect:
      "Flipping `enabled` to `false` halts mirroring without discarding coordinates or credentials, and `POST /api/v1/admin/mirror/reconcile` starts answering `503 mirror_disabled` — that is the safe way to pause. Turning it on with incomplete coordinates or credentials produces the same `503` from the reconcile endpoint, because completeness is checked there and not on this write. A changed `reconcileSchedule` is picked up by the in-process scheduler; use `GET /api/v1/admin/mirror/status` to see when the next sweep is due.",
    exampleOverrides: {
      enabled: true,
      owner: "acme-ai",
      repo: "ornn-skills",
      branch: "main",
      appId: "1234567",
      installationId: "87654321",
      appPrivateKey: "----••••••••••••----",
    },
    changedFieldsExample: ["enabled", "branch"],
  },

  nyxid: {
    title: "NyxID integration",
    overview:
      "Owns the server-side coordinates for NyxID and the two chrono services the backend calls. `tokenUrl`, `clientId`, and `clientSecret` are the service-account OAuth2 credentials ornn-api exchanges for its own access token; `baseApiUrl` is the NyxID API the backend proxies through. `chronoStorageUrl` plus `chronoStorageBucket` locate skill-package object storage, and `chronoSandboxUrl` locates the execution sandbox. Every URL field must be an `http://` or `https://` URL whose host is public — loopback, RFC1918, link-local, and cloud-metadata addresses are refused with `URL host is private/loopback/link-local; set ORNN_URL_ALLOWLIST_CIDR to allow`, because this section's `tokenUrl` receives the client secret on first use and a private-address bypass here is a credential-exfiltration primitive. Deployments that genuinely live at a private address allowlist it through the `ORNN_URL_ALLOWLIST_CIDR` environment variable, not through this API. The bucket name must match `^[a-z0-9.-]{1,63}$`. Every field accepts the empty string as \"not configured\". Browser-facing NyxID link coordinates are **not** here — they ship in ornn-web's ConfigMap.",
    writeEffect:
      "Rotating `clientSecret` invalidates nothing on the NyxID side; it only changes what this deployment presents on its next token exchange, so rotate on NyxID first. Re-pointing `chronoStorageUrl` or `chronoStorageBucket` does not migrate anything already stored — packages written under the old coordinates stay there and become unreadable, so treat a bucket change as a data migration and not a settings edit.",
    exampleOverrides: {
      tokenUrl: "https://nyx-api.example.com/oauth/token",
      clientId: "ornn-api",
      clientSecret: "ornn••••••••4c2d",
      baseApiUrl: "https://nyx-api.example.com",
      chronoStorageUrl: "https://storage.example.com",
      chronoStorageBucket: "ornn-skills",
      chronoSandboxUrl: "https://sandbox.example.com",
    },
    changedFieldsExample: ["baseApiUrl"],
  },

  skillAudit: {
    title: "Skill audit",
    overview:
      "Owns the safety review that runs over a skill version. `llmAuditEnabled` switches the LLM half on, and `llmAuditDefaultProviderId` / `llmAuditDefaultModelId` choose the reviewing model — when the model id is empty the pipeline falls through to the skill-generation surface's default. `riskThreshold` (0–10, one decimal place is typical) is the score at or above which a version is treated as risky; it replaced the older `auditWaiverThreshold` knob on the legacy `/admin/settings` singleton. `agentSealEnabled` and `agentSealTimeoutMs` (1000–600000) control the static AgentSeal scan that runs alongside the LLM review. One cross-field rule is enforced by the schema: `llmAuditDefaultProviderId` is required whenever `llmAuditEnabled` is `true`, and violating it is rejected as `llmAuditDefaultProviderId: required when llmAuditEnabled is true`.",
    writeEffect:
      "The new values apply to audits started after the write; an audit already running keeps the threshold and timeout it began with, and no previously-issued verdict is recomputed. Lowering `riskThreshold` therefore does not retroactively fail skills that already passed — re-run `POST /api/v1/skills/{idOrName}/audit` for anything you need re-judged under the new bar. Turning `agentSealEnabled` on in a deployment whose image ships no scanner does not fail here; the rescan endpoint answers `503 agentseal_disabled` instead.",
    exampleOverrides: {
      llmAuditEnabled: true,
      llmAuditDefaultProviderId: "8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742",
      llmAuditDefaultModelId: "gpt-4o",
    },
    changedFieldsExample: ["llmAuditEnabled", "llmAuditDefaultProviderId", "riskThreshold"],
  },

  telemetry: {
    title: "PostHog telemetry",
    overview:
      "Owns PostHog analytics configuration. Note the name split: the section id is `telemetry` — which is what the Mongo row and the export/import payloads key on — while the URL segment is `posthog`, renamed because the section only ever carried PostHog config. `postHogEnabled` is the master switch; with it off the backend installs a no-op tracker no matter what else is set. `postHogApiKey` is the project API key (the public `phc_…` value), and an empty key disables ingestion on its own. `postHogHost` is the ingest host and must be a public `http(s)` URL, or empty to fall back to the environment variable. `postHogProjectId` is informational and appears in log lines for correlation. `postHogErrorSampleRate` (0–1) sub-samples `api.error` 5xx events. OpenTelemetry fields once lived here and were removed in #271 — Ornn runs no OTel pipeline.",
    writeEffect:
      "**Restart-required.** The tracker is constructed once at boot from this section, so a write here changes nothing about a running pod: the new configuration is picked up on the next ornn-api container restart. Everything else in this module is hot. Environment variables remain the bootstrap fallback and the seed for the very first read on a fresh database, so clearing a field here does not necessarily switch telemetry off.",
    exampleOverrides: {
      postHogEnabled: true,
      postHogApiKey: "phc_••••••••9a1f",
      postHogHost: "https://eu.i.posthog.com",
      postHogProjectId: "41822",
    },
    changedFieldsExample: ["postHogEnabled", "postHogHost"],
  },

  extras: {
    title: "Extra NyxID services",
    overview:
      "Owns `extraNyxidServices`, the list of additional synthetic NyxID services this deployment exposes beyond the built-in set — the ones a skill can be bound to and a user can hold credentials for. Each entry needs a `name` matching `^[A-Za-z0-9._-]{1,64}$` (mixed case, dots, dashes, and underscores are all fine, spaces are not, so the value is safe to drop into a URL path segment unencoded) and a `baseUrl` that is either empty or a public `http(s)` URL. `scopes` is optional and free-form. Names must be unique within the array; a duplicate is rejected as `extraNyxidServices.<index>.name: duplicate service name \"<name>\"`.",
    writeEffect:
      "This is a whole-array replace: send the complete list every time, because an entry you omit is deleted, not left in place. Removing a service that skills or users are already bound to does not cascade — those bindings keep naming a service this deployment no longer advertises — so retire a service by first re-pointing what references it.",
    exampleOverrides: {
      extraNyxidServices: [
        { name: "NyxID", baseUrl: "https://nyx-api.example.com", scopes: ["profile"] },
      ],
    },
    changedFieldsExample: ["extraNyxidServices"],
  },

  launchPromo: {
    title: "Launch promo",
    overview:
      "Owns the GitHub-star → Ornn-credit launch promotion (#724) read by both the poller and the manual-award endpoint `POST /api/v1/admin/launch-promo/award/{userId}`. `enabled` gates the whole thing. `repoOwner` / `repoName` say which repository's stargazers are eligible. `totalSlots` (0–100000) caps lifetime claims — the service refuses to award once claims reach it. `awardPlayground` and `awardSkillGen` are the per-claim monthly credit grants for those two surfaces. `pollIntervalMs` drives the auto-poll loop and `0` disables it, leaving only the manual award path. `codeExpiryDays` (1–365) is how long a minted redemption code stays valid. `nyxidInviteCode` (up to 64 characters) is the static invite code bundled into the claim notification, editable here so a rotation needs no redeploy. Defaults are deliberately inert: disabled, with no repository set.",
    writeEffect:
      "Nothing here is retroactive. Lowering `totalSlots` below the number of claims already made does not revoke anything — it only stops further awards; raising it re-opens the promo. `awardPlayground` / `awardSkillGen` and `codeExpiryDays` apply to codes minted after the write, so already-issued codes keep the grant bundle and expiry they were minted with. Changing `repoOwner` / `repoName` re-points future eligibility checks and does not re-evaluate past claims.",
    exampleOverrides: {
      enabled: true,
      repoOwner: "ChronoAIProject",
      repoName: "Ornn",
      nyxidInviteCode: "ORNN-LAUNCH",
    },
    changedFieldsExample: ["enabled", "repoOwner", "repoName"],
  },

  sourceSync: {
    title: "GitHub source sync",
    overview:
      "Owns the poller that watches the upstream GitHub repositories of GitHub-sourced skills and detects when one has moved (#1175). Mind the URL: this section's path segment is the camelCase `sourceSync`, not the kebab-case every other multi-word section uses. `enabled` is the master switch. `githubToken` is a service-account token used **only** to authenticate reads of public repositories so drift checks escape the unauthenticated 60-requests-per-hour-per-IP ceiling (authenticated is 5000/hour with free `304`s) — it grants nothing the public web does not already; when empty the runtime falls back to the `ORNN_SOURCE_SYNC_GITHUB_TOKEN` environment variable, and when both are empty the poller runs unauthenticated and rate-limited. `pollSchedule` is a cron expression interpreted in `Asia/Singapore`, matching the mirror scheduler; empty disables the schedule. `minCheckIntervalMinutes` (minimum 1) floors how often any single skill is re-checked, independent of how often the cron fires. `autoPublish` is the full unattended switch — when true, detected drift publishes a new version by itself.",
    writeEffect:
      "`autoPublish` is the field to think hardest about: turning it on lets an upstream repository change become a published skill version with no human in the loop, and it is the one setting in this module that can create registry content on its own. `enabled: false` leaves the token and schedule in place, which is the reversible way to stop the poller. A tightened `minCheckIntervalMinutes` throttles the next sweep rather than the one already running.",
    exampleOverrides: {
      enabled: true,
      githubToken: "ghp_••••••••7f3a",
    },
    changedFieldsExample: ["enabled", "githubToken"],
  },
};

/**
 * Safety net for a section added to the registry before its prose row.
 * `SECTION_PROSE` is total, so TypeScript flags that case at compile time
 * and this branch is unreachable in a type-clean tree — it exists so the
 * generated document still builds (and the router-reflection test still
 * passes) in a tree where the typecheck has not been fixed yet. It is
 * deliberately blunt about being undocumented rather than pretending to
 * describe the section.
 */
function fallbackProse(id: SectionId, publicPath: string): SectionProse {
  return {
    title: id,
    overview: `Settings section \`${id}\`, served at \`/admin/settings/${publicPath}\`. **This section has no hand-written documentation yet** — the payload schema below is generated from its Zod schema in \`domains/settings/sections/${id}\` and is accurate, but what the fields mean and what writing them does to a running deployment is not described here. Read the section module before depending on it.`,
    writeEffect: `Replaces the stored \`${id}\` document after validating the body against the section schema. The runtime effect of that write is undocumented; see \`domains/settings/sections/${id}\`.`,
    changedFieldsExample: [],
  };
}

// ---------------------------------------------------------------------------
// Section operations (generated from the registry)
// ---------------------------------------------------------------------------

/** `skillGen` → `SkillGen`, so operationIds read `getSkillGenSettings`. */
function pascal(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * The `GET` + `PUT` pair for one settings section, with the payload schema,
 * the example skeleton, and the secret sentence all derived from the
 * registry entry.
 */
function sectionPathItem(id: SectionId): PathItem {
  const meta = sections[id];
  const prose = SECTION_PROSE[id] ?? fallbackProse(id, meta.publicPath);
  const dataSchema = toSchema(meta.schema, "output");
  const example: Record<string, unknown> = {
    ...(meta.defaults as Record<string, unknown>),
    ...(prose.exampleOverrides ?? {}),
  };
  const secrets = secretNote(meta.secretFields);
  const putEnvelope = envelope(dataSchema);

  return {
    get: {
      summary: `Read the ${prose.title} settings section`,
      description: `${prose.overview}\n\n${secrets}\n\n${DEFAULTS_NOTE} ${CACHE_NOTE}\n\n${ADMIN_SCOPE_NOTE}`,
      operationId: `get${pascal(id)}Settings`,
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [],
      responses: {
        ...jsonResponse(
          dataSchema,
          `The current \`${id}\` section, defaults filled in and secrets mid-masked.`,
          { example },
        ),
        ...problemResponses(401, 403),
      },
    },
    put: {
      summary: `Replace the ${prose.title} settings section`,
      description: `${prose.writeEffect}\n\n**This is a full replace, not a merge.** The body is validated against the entire section schema, so every required field must be present — omitting one is a \`400\`, not a request to leave it as it was. The supported pattern is: \`GET\` the section, change the fields you care about, and \`PUT\` the whole object back. Unknown keys are stripped rather than rejected, so a misspelled field name is silently ignored; check the returned \`meta.changedFields\` to confirm the edit you intended actually landed.\n\nValidation happens in two layers with two different error codes. The body must first be a JSON object at all (\`400 invalid_body\`; an empty body is read as \`{}\` and then fails the schema). It is then parsed by the section schema (\`400 invalid_setting\`), which reports only the **first** failing field, as \`<path>: <message>\` — fix it and resend to see the next one.\n\nOn success the body carries a third top-level key, \`meta.changedFields\`, beside the usual \`data\` and \`error\`. The write also busts this pod's cache entry for the section.\n\n${secrets}\n\n${ADMIN_SCOPE_NOTE}`,
      operationId: `update${pascal(id)}Settings`,
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [],
      requestBody: jsonBody(
        meta.schema,
        `The complete \`${id}\` section. Every field the schema declares must be present.`,
        { example },
      ),
      responses: {
        200: {
          description: `The stored \`${id}\` section after the write, secrets re-masked, plus the \`meta.changedFields\` write receipt.`,
          content: {
            "application/json": {
              schema: {
                ...putEnvelope,
                required: ["data", "error", "meta"],
                properties: {
                  ...(putEnvelope.properties as Record<string, JsonSchema>),
                  meta: changedFieldsMetaSchema,
                },
              },
              example: {
                data: example,
                error: null,
                meta: { changedFields: [...prose.changedFieldsExample] },
              },
            },
          },
        },
        ...problemResponses(
          {
            400: "The body was not valid JSON or not a JSON object (`code: \"invalid_body\"`), or it failed the section schema (`code: \"invalid_setting\"`, `detail` being the first offending field as `<path>: <message>`). Nothing was written in either case.",
          },
          401,
          403,
        ),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// LLM provider payloads
// ---------------------------------------------------------------------------

/**
 * One row of a provider's model catalogue. Hand-written: the handler
 * projects `LlmProviderModel` (a TypeScript interface, no Zod source)
 * straight onto the wire, with `Date` fields serialised as ISO 8601.
 */
const providerModelSchema: JsonSchema = {
  type: "object",
  description:
    "One model in this provider's catalogue. Rows are created by the sync endpoint, not by hand, and the six surface flags are only ever written through the per-model `PATCH`.",
  required: [
    "id",
    "displayName",
    "enabledForPlayground",
    "enabledForSkillGen",
    "enabledForAssistant",
    "defaultForPlayground",
    "defaultForSkillGen",
    "defaultForAssistant",
    "removed",
    "firstSeenAt",
    "lastSyncedAt",
  ],
  properties: {
    id: {
      type: "string",
      description: "Provider-issued model id, exactly as the upstream catalogue spells it. This is the value a caller puts in a surface request's `model` field.",
      examples: ["gpt-4o"],
    },
    displayName: { type: "string", description: "Operator-facing label. Falls back to `id` when upstream supplies nothing better." },
    enabledForPlayground: { type: "boolean", description: "Selectable on the Playground surface. A model is usable there only when this is true **and** `removed` is false." },
    enabledForSkillGen: { type: "boolean", description: "Selectable on the skill-generation surface, same rule." },
    enabledForAssistant: { type: "boolean", description: "Selectable on the Ornn Assistant surface, same rule." },
    defaultForPlayground: { type: "boolean", description: "This is the Playground default. At most one model across **all** providers may carry this, and it implies `enabledForPlayground`." },
    defaultForSkillGen: { type: "boolean", description: "This is the skill-generation default, under the same at-most-one-across-all-providers rule." },
    defaultForAssistant: { type: "boolean", description: "This is the Ornn Assistant default, under the same rule." },
    removed: {
      type: "boolean",
      description:
        "The model was in this catalogue once and is no longer offered upstream. The row is kept for history, every resolver skips it, its default flags were cleared when it disappeared, and its flags cannot be patched until a sync brings it back.",
    },
    firstSeenAt: { type: "string", format: "date-time", description: "When this model first appeared in the catalogue (ISO 8601, UTC). Preserved across syncs and across a removal/reappearance." },
    lastSyncedAt: { type: "string", format: "date-time", description: "When the last sync observed this model (ISO 8601, UTC)." },
  },
};

/**
 * The provider's credential block as it comes back on a read: a
 * discriminated union on `kind`, with the secret member mid-masked.
 */
const providerAuthSchema: JsonSchema = {
  description:
    "How this provider is authenticated, discriminated on `kind`. Exactly one secret member per kind — `apiKey`, `clientSecret`, or `password` — and it is always mid-masked on the way out. Writing back a value that still contains a `•` preserves the stored secret.",
  oneOf: [
    {
      type: "object",
      title: "apiKey",
      required: ["kind", "apiKey"],
      properties: {
        kind: { type: "string", enum: ["apiKey"], description: "Static bearer key sent on every call." },
        apiKey: { type: "string", description: "Mid-masked API key. Empty string when none is configured.", examples: ["sk-p••••••••3f9a"] },
      },
    },
    {
      type: "object",
      title: "tokenUrl",
      required: ["kind", "tokenUrl", "clientId", "clientSecret"],
      properties: {
        kind: { type: "string", enum: ["tokenUrl"], description: "OAuth2 client-credentials exchange against `tokenUrl`." },
        tokenUrl: { type: "string", description: "Token endpoint. Must be a public `http(s)` URL — this is where the client secret is sent." },
        clientId: { type: "string", description: "OAuth2 client id. Not a secret; returned verbatim." },
        clientSecret: { type: "string", description: "Mid-masked OAuth2 client secret.", examples: ["cid_••••••••b71e"] },
      },
    },
    {
      type: "object",
      title: "basic",
      required: ["kind", "username", "password"],
      properties: {
        kind: { type: "string", enum: ["basic"], description: "HTTP basic authentication." },
        username: { type: "string", description: "Basic-auth username. Not a secret; returned verbatim." },
        password: { type: "string", description: "Mid-masked basic-auth password.", examples: ["pa••••••••rd"] },
      },
    },
  ],
};

/** One provider as every read path in this module returns it. */
const providerSchema: JsonSchema = {
  type: "object",
  description:
    "A configured LLM provider with its credential mid-masked. The same shape is returned by the list, the read, the create, the update, the sync, and the per-model patch — every write path re-reads through the masking projection, so no write response ever echoes a plaintext secret back.",
  required: [
    "_id",
    "name",
    "gatewayUrl",
    "modelListUrl",
    "apiFormat",
    "auth",
    "models",
    "maxOutputTokens",
    "defaultTemperature",
    "createdAt",
    "updatedAt",
    "updatedBy",
  ],
  properties: {
    _id: { type: "string", description: "Server-assigned provider id — a UUID minted on create. This is the `{id}` path parameter everywhere below.", examples: ["8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742"] },
    name: { type: "string", description: "Operator-facing provider name, unique across providers at create time.", examples: ["OpenAI"] },
    gatewayUrl: { type: "string", description: "Base URL completions are sent to. Must be a public `http(s)` URL." },
    modelListUrl: { type: "string", description: "URL the catalogue sync reads the model list from. Must be a public `http(s)` URL." },
    apiFormat: { type: "string", enum: ["chat-completion", "responses"], description: "Wire dialect this provider speaks. Decides both how completions are framed and how the sync parses the model list." },
    auth: providerAuthSchema,
    models: { type: "array", items: providerModelSchema, description: "The provider's model catalogue, including rows flagged `removed`. Populated by the sync endpoint." },
    maxOutputTokens: { type: "integer", description: "Per-call output-token ceiling applied to every request routed through this provider (1–1000000).", examples: [8192] },
    defaultTemperature: { type: "number", description: "Sampling temperature (0–2) used when a caller does not specify one.", examples: [0.7] },
    createdAt: { type: "string", format: "date-time", description: "When the provider was created (ISO 8601, UTC)." },
    updatedAt: { type: "string", format: "date-time", description: "When the provider document was last written — including by a sync or a per-model patch (ISO 8601, UTC)." },
    updatedBy: { type: "string", description: "NyxID user id of the admin behind the most recent write." },
  },
};

const providerListSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  description: "All configured providers. There is no pagination and no filtering — a deployment has a handful of providers, not a directory of them.",
  properties: {
    items: { type: "array", items: providerSchema, description: "Every provider, each with its credential mid-masked and its full model catalogue inlined." },
  },
};

const syncResultSchema: JsonSchema = {
  type: "object",
  required: ["provider", "result"],
  properties: {
    provider: providerSchema,
    result: {
      type: "object",
      required: ["added", "updated", "removed"],
      description: "What the sync changed. All three zero means the upstream catalogue matched what was already stored — the sync is idempotent, so that is the expected result of running it twice.",
      properties: {
        added: { type: "integer", description: "Models seen for the first time. They arrive with every surface flag `false`, so a new upstream model never re-routes traffic on its own." },
        updated: { type: "integer", description: "Known models whose `displayName` changed, or that came back after having been flagged `removed`." },
        removed: { type: "integer", description: "Models that disappeared from the upstream catalogue on this run and were flagged `removed`. Counts the transition only, not the standing total of removed rows." },
      },
    },
  },
};

/** Example provider, reused across the operation examples. */
const providerExample = {
  _id: "8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742",
  name: "OpenAI",
  gatewayUrl: "https://api.openai.com/v1",
  modelListUrl: "https://api.openai.com/v1/models",
  apiFormat: "chat-completion",
  auth: { kind: "apiKey", apiKey: "sk-p••••••••3f9a" },
  models: [
    {
      id: "gpt-4o",
      displayName: "GPT-4o",
      enabledForPlayground: true,
      enabledForSkillGen: true,
      enabledForAssistant: true,
      defaultForPlayground: true,
      defaultForSkillGen: false,
      defaultForAssistant: false,
      removed: false,
      firstSeenAt: "2026-05-02T09:14:00.000Z",
      lastSyncedAt: "2026-08-07T04:12:30.442Z",
    },
  ],
  maxOutputTokens: 8192,
  defaultTemperature: 0.7,
  createdAt: "2026-05-02T09:14:00.000Z",
  updatedAt: "2026-08-07T04:12:30.442Z",
  updatedBy: "usr_01HXYZ7QK3M2N4P5R6S7T8V9W0",
};

const providerIdParam = pathParam(
  "id",
  "Provider id — the `_id` returned by the create call and by the listing. A UUID; an id that does not resolve is a `404` (`code: \"provider_not_found\"`).",
  { type: "string" },
  "8f2a1c34-9b7e-4d51-a0c6-1e5b3d9f0742",
);

// ---------------------------------------------------------------------------
// Path map
// ---------------------------------------------------------------------------

/**
 * All 27 operations, keyed by their full `/api/v1` path.
 *
 * The ten section entries are computed from the registry so they match the
 * loop in `domains/settings/routes.ts` by construction; the seven provider
 * entries must match the registrations in
 * `domains/settings/llmProviders/routes.ts` character for character. Both
 * halves are asserted against the booted router by a contract test.
 */
export function adminSettingsPaths(prefix: string): PathMap {
  const paths: PathMap = {};

  for (const id of Object.keys(sections) as SectionId[]) {
    paths[`${prefix}/admin/settings/${sections[id].publicPath}`] = sectionPathItem(id);
  }

  paths[`${prefix}/admin/settings/llm-providers`] = {
    get: {
      summary: "List configured LLM providers",
      description: `Every LLM provider this deployment can route completions through, each with its full model catalogue inlined and its credential mid-masked. This is the admin-side catalogue that decides what ordinary callers see: the per-model \`enabledFor…\` flags below are exactly what \`GET /api/v1/me/models\` filters on, and the \`defaultFor…\` flags supply the fallback model for a surface whose settings section has no explicit pin. Unpaginated and unfiltered by design — a deployment has a handful of providers.\n\nStart here when a surface reports \`503 MODEL_UNAVAILABLE\`: that state means no model is both enabled for the surface and not \`removed\`, which is visible in this response. ${MASK_SEMANTICS}\n\n${ADMIN_SCOPE_NOTE}`,
      operationId: "listLlmProviders",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [],
      responses: {
        ...jsonResponse(providerListSchema, "Every configured provider, credentials mid-masked.", {
          example: { items: [providerExample] },
        }),
        ...problemResponses(401, 403),
      },
    },
    post: {
      summary: "Create an LLM provider",
      description: `Register a new provider. \`name\` must be unique across providers — a collision is a \`409\` and nothing is written. \`gatewayUrl\` and \`modelListUrl\` must both be public \`http(s)\` URLs; loopback, RFC1918, link-local, and cloud-metadata hosts are refused at the schema, because these URLs receive the provider credential on first use. \`apiFormat\` picks the wire dialect and therefore also how the model list is parsed.\n\n\`auth\` is a discriminated union on \`kind\`: \`apiKey\` (one static key), \`tokenUrl\` (OAuth2 client-credentials — \`tokenUrl\` is itself public-URL checked), or \`basic\` (username/password). The secret member is encrypted before it is stored.\n\n\`models\` is optional and normally omitted: create the provider, then call the sync endpoint to populate the catalogue from upstream. If you do supply models, every surface flag you leave out defaults to \`false\`, so a hand-seeded catalogue never re-routes a surface by accident.\n\nThe \`201\` body is not an echo of what you sent — the provider is re-read through the masking projection, so the credential you just submitted comes back mid-masked. ${ADMIN_SCOPE_NOTE}`,
      operationId: "createLlmProvider",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [],
      requestBody: jsonBody(providerCreateSchema, "The provider to create.", {
        example: {
          name: "OpenAI",
          gatewayUrl: "https://api.openai.com/v1",
          modelListUrl: "https://api.openai.com/v1/models",
          apiFormat: "chat-completion",
          auth: { kind: "apiKey", apiKey: "sk-proj-REPLACE-ME" },
          maxOutputTokens: 8192,
          defaultTemperature: 0.7,
        },
      }),
      responses: {
        ...jsonResponse(providerSchema, "The provider was created. Body is the stored document, credential mid-masked.", {
          status: 201,
          example: { ...providerExample, models: [] },
        }),
        ...problemResponses(
          {
            400: "The body was not a JSON object (`code: \"invalid_body\"`), or it failed the provider schema (`code: \"invalid_provider_input\"`, `detail` being the first offending field as `<path>: <message>`) — a missing field, a non-public `gatewayUrl` / `modelListUrl` / `tokenUrl`, an unknown `apiFormat` or `auth.kind`, or an out-of-range `maxOutputTokens` / `defaultTemperature`.",
            409: "A provider with this `name` already exists (`code: \"PROVIDER_NAME_TAKEN\"`). Nothing was written; pick another name or update the existing provider instead.",
          },
          401,
          403,
        ),
      },
    },
  };

  paths[`${prefix}/admin/settings/llm-providers/{id}`] = {
    get: {
      summary: "Read one LLM provider",
      description: `One provider by id, with its full model catalogue and its credential mid-masked — the same projection the listing uses. Use it to inspect a single provider's catalogue before flipping surface flags, and as the read half of the read-modify-write cycle for the \`PUT\` below.\n\n${MASK_SEMANTICS}\n\n${ADMIN_SCOPE_NOTE}`,
      operationId: "getLlmProvider",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [providerIdParam],
      responses: {
        ...jsonResponse(providerSchema, "The provider, credential mid-masked.", { example: providerExample }),
        ...problemResponses(
          401,
          403,
          { 404: "No provider with this id (`code: \"provider_not_found\"`)." },
        ),
      },
    },
    put: {
      summary: "Update an LLM provider",
      description: `Despite the verb this is a **partial** update: every field is optional, and one you omit keeps its stored value. Send only what you are changing.\n\nThree fields have semantics worth reading twice. **\`auth\`** is replaced whole when present — send the complete discriminated object, including \`kind\`, not just the member you are editing; the secret member follows the mask rule, so echoing back the mid-masked value you read preserves the stored credential and sending plaintext rotates it. **\`models\`** distinguishes absent from empty: omit it and the stored catalogue is untouched, send \`[]\` and the catalogue is wiped. For any model you do send, an omitted surface flag inherits the stored value for that model rather than resetting to \`false\`, and \`firstSeenAt\` / \`lastSyncedAt\` are preserved — only the sync endpoint moves those. **\`name\`** is not re-checked for uniqueness on this path, unlike on create, so a rename can collide with an existing provider without a \`409\`.\n\nThe response is the provider re-read through the masking projection. ${ADMIN_SCOPE_NOTE}`,
      operationId: "updateLlmProvider",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [providerIdParam],
      requestBody: jsonBody(providerUpdateSchema, "The provider fields to change. All optional; omitted fields keep their stored value.", {
        example: {
          gatewayUrl: "https://api.openai.com/v1",
          maxOutputTokens: 16384,
          auth: { kind: "apiKey", apiKey: "sk-p••••••••3f9a" },
        },
      }),
      responses: {
        ...jsonResponse(providerSchema, "The updated provider, credential mid-masked.", {
          example: { ...providerExample, maxOutputTokens: 16384 },
        }),
        ...problemResponses(
          {
            400: "The body was not a JSON object (`code: \"invalid_body\"`), or a field that was present failed validation (`code: \"invalid_provider_input\"`, `detail` being the first offending field as `<path>: <message>`).",
          },
          401,
          403,
          { 404: "No provider with this id (`code: \"provider_not_found\"`). Checked before the body is parsed." },
        ),
      },
    },
    delete: {
      summary: "Delete an LLM provider",
      description: `Permanently removes the provider document and, with it, the entire model catalogue underneath. There is no soft delete, no undo, and no confirmation step — the \`removed\` flag on a model row is about upstream catalogue drift and has nothing to do with this.\n\nNothing cascades and nothing is checked first. A settings section still pinning a model that lived only on this provider keeps the now-dangling \`defaultModelId\`, and the surface falls back to whatever else is enabled — or answers \`503 MODEL_UNAVAILABLE\` if that leaves it with nothing. Check what depends on the provider before deleting it, and re-check the surface sections afterwards. Returns \`204\` with no body. ${ADMIN_SCOPE_NOTE}`,
      operationId: "deleteLlmProvider",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [providerIdParam],
      responses: {
        ...noContentResponse("The provider and its model catalogue were deleted. No body."),
        ...problemResponses(
          401,
          403,
          { 404: "No provider with this id (`code: \"provider_not_found\"`) — including the case where a concurrent delete already removed it." },
        ),
      },
    },
  };

  paths[`${prefix}/admin/settings/llm-providers/{id}/sync`] = {
    post: {
      summary: "Sync a provider's model catalogue",
      description: `Fetches the provider's model list from its \`modelListUrl\` (authenticating with the stored credential, parsed according to \`apiFormat\`) and reconciles it against the stored catalogue. Takes no request body.\n\nThe merge is deliberately conservative and idempotent — running it twice against an unchanged upstream reports \`{ added: 0, updated: 0, removed: 0 }\`. A model already known keeps all six surface flags and gets a fresh \`lastSyncedAt\`. A model seen for the first time arrives with every flag \`false\`, so a new upstream model can never re-route a surface on its own; enable it explicitly with the per-model \`PATCH\`. A model that has disappeared upstream is **not** deleted — it is flagged \`removed: true\` and kept for history, with its default flags cleared in the same write so a surface is never left pointing at a model that no longer exists. A \`removed\` row that reappears upstream flips back and keeps the flags it had.\n\nThis is the only write path that touches \`firstSeenAt\` / \`lastSyncedAt\`, and it is the intended way to populate a freshly-created provider. The response carries both the re-read provider and the three counters. ${ADMIN_SCOPE_NOTE}`,
      operationId: "syncLlmProviderModels",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [providerIdParam],
      responses: {
        ...jsonResponse(syncResultSchema, "The catalogue was reconciled. `result` reports what changed; `provider` is the provider after the merge.", {
          example: { provider: providerExample, result: { added: 2, updated: 1, removed: 0 } },
        }),
        ...problemResponses(
          401,
          403,
          { 404: "No provider with this id (`code: \"provider_not_found\"`)." },
          {
            503: "The provider's model-list endpoint could not be read (`code: \"MODEL_LIST_UNREACHABLE\"`) — unreachable host, TLS failure, rejected credential, or an unparseable response; the underlying message is quoted in `detail`. The stored catalogue is untouched, so this is safe to retry, but a rejected credential or a wrong `modelListUrl` will not fix itself.",
          },
        ),
      },
    },
  };

  paths[`${prefix}/admin/settings/llm-providers/{id}/models/{modelId}`] = {
    patch: {
      summary: "Set one model's per-surface flags",
      description: `The single write path for the six surface flags on one model — \`enabledForPlayground\`, \`enabledForSkillGen\`, \`enabledForAssistant\`, \`defaultForPlayground\`, \`defaultForSkillGen\`, \`defaultForAssistant\`. Send any subset; a flag you omit is preserved. At least one recognised flag must be present, and since unknown keys are stripped before that check, a body of only misspelled keys fails as an empty patch.\n\nThree invariants are enforced server-side, and two of them change state you did not name in the request. Setting \`defaultForX: true\` **clears that same flag on every other model across every other provider** — at most one default per surface exists platform-wide — and forces \`enabledForX: true\` on this model, because a default that is not enabled would silently mis-route the surface. Setting \`enabledForX: false\` on a model that is currently the surface default also clears \`defaultForX\`. And a model flagged \`removed: true\` refuses all patches until a sync brings it back.\n\nThe response is **this provider only**. Sibling providers whose defaults were just cleared are not in it — re-list if you need the platform-wide picture. Note also that \`{modelId}\` is a single path segment: a provider whose model ids contain a slash cannot be addressed through this route. ${ADMIN_SCOPE_NOTE}`,
      operationId: "patchLlmProviderModelFlags",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [
        providerIdParam,
        pathParam(
          "modelId",
          "The model's provider-issued id, exactly as it appears in the provider's `models[].id` — not the display name. Must be a single path segment. A model id that is not on this provider is a `404` (`code: \"MODEL_NOT_FOUND\"`).",
          { type: "string" },
          "gpt-4o",
        ),
      ],
      requestBody: jsonBody(modelFlagsPatchSchema, "The surface flags to change. Any subset; at least one must be present.", {
        example: { enabledForPlayground: true, defaultForPlayground: true },
      }),
      responses: {
        ...jsonResponse(providerSchema, "The provider after the patch, with this model's flags updated and the credential mid-masked.", {
          example: providerExample,
        }),
        ...problemResponses(
          {
            400: "The body was not a JSON object (`code: \"invalid_body\"`); or it carried no recognised flag (`code: \"invalid_provider_input\"`, `detail: \"At least one flag must be provided\"`), which is also what a body of only misspelled keys produces; or the model is flagged `removed` (`code: \"MODEL_REMOVED\"`) and must be restored by a sync before its flags can change.",
          },
          401,
          403,
          {
            404: "Either no provider with this id (`code: \"provider_not_found\"`) or no such model on that provider (`code: \"MODEL_NOT_FOUND\"`). Branch on `code` to tell them apart.",
          },
        ),
      },
    },
  };

  return paths;
}
