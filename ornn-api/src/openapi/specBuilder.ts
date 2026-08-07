/**
 * OpenAPI 3.1 spec builder.
 *
 * The document is assembled from one module per domain under `paths/`,
 * each of which derives its request and response schemas from the same
 * Zod definitions the running handlers validate against. Shared response
 * shapes, the RFC 7807 error body, and the parameter helpers live in
 * `helpers.ts`.
 *
 * Two invariants are enforced by contract tests in `tests/contract/`:
 *
 *   - *documented ⇒ registered* — no path in this document is absent
 *     from the booted Hono router (no phantom endpoints).
 *   - *registered ⇒ documented* — no route on the booted router is
 *     absent from this document (no undocumented endpoints).
 *
 * Adding a route therefore means adding it to the matching `paths/`
 * module in the same change, or CI fails. That pairing is the whole
 * point: before #1214 the table here was hand-maintained and had drifted
 * to describing 13 of 104 routes.
 *
 * @module openapi/specBuilder
 */

import type { PathMap } from "./helpers";
import { accountPaths } from "./paths/account";
import { adminPaths } from "./paths/admin";
import { adminQuotaPaths } from "./paths/adminQuota";
import { adminSettingsPaths } from "./paths/adminSettings";
import { auditAnalyticsPaths } from "./paths/auditAnalytics";
import { generationPaths } from "./paths/generation";
import { messagingPaths } from "./paths/messaging";
import { searchFormatPaths } from "./paths/searchFormat";
import { skillsCrudPaths } from "./paths/skillsCrud";
import { skillsetsPaths } from "./paths/skillsets";
import { systemPaths } from "./paths/system";
import { usersMirrorPaths } from "./paths/usersMirror";

type OpenApiSpec = Record<string, unknown>;

/**
 * Deployment-specific values the spec advertises. Both are caller-supplied
 * so nothing environment-shaped is baked into the builder (CLAUDE.md:
 * zero hardcoded config).
 */
export interface SpecOptions {
  /**
   * Public base URL clients prepend to every path key. No trailing slash,
   * no `/api/v1` suffix — the paths carry that. Comes from
   * `config.ornnApiBaseUrl`.
   */
  readonly serverUrl: string;
  /** Package version, reported as `info.version`. */
  readonly version: string;
}

/**
 * Tag vocabulary. Every tag an operation declares must appear here —
 * a tag with no entry renders as an unlabelled group in Swagger UI and
 * most generators fold it into a nameless client namespace.
 */
const TAGS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: "Skills",
    description:
      "The core resource. Upload, pull, inspect, update, version, tag, and delete skill packages, and manage who may read them.",
  },
  {
    name: "Skillsets",
    description:
      "Named, versioned bundles of skills. Resolve a skillset to its transitive closure of skill versions, or export it as an agent plugin.",
  },
  {
    name: "Search",
    description:
      "Discovery over the registry: keyword and semantic skill search, plus the facet and count endpoints that back filter UIs.",
  },
  {
    name: "Generation",
    description:
      "Author skills with an LLM — from a prompt, from an existing source repository, or from an OpenAPI document. All stream over SSE.",
  },
  {
    name: "Format",
    description:
      "The skill package format itself: the human-readable rules, the machine-readable SKILL.md JSON Schema, and a validator for a candidate ZIP.",
  },
  {
    name: "Audit",
    description:
      "LLM safety review of a specific skill version — dimension scores, a green/yellow/red verdict, and the audit history behind it.",
  },
  {
    name: "Analytics",
    description: "Per-skill usage aggregates: execution outcomes and latency, and time-bucketed pull counts by surface.",
  },
  {
    name: "Playground",
    description: "Multi-turn chat that executes skills in a sandbox, for trying a skill before wiring it into an agent.",
  },
  {
    name: "Assistant",
    description: "Grounded, non-agentic Q&A about Ornn itself and the skills the caller can see. No tools, no execution.",
  },
  {
    name: "Account",
    description:
      "The authenticated caller's own view: profile, organisations, bound services, quota, model picker, and redemption codes.",
  },
  { name: "Notifications", description: "The caller's notification inbox and its read state." },
  { name: "Announcements", description: "Platform-wide announcements — the public read side and the admin authoring side." },
  {
    name: "Admin",
    description:
      "Platform operator surface: skill moderation, user and quota administration, redemption codes, platform settings, and the GitHub mirror. Every operation requires an admin permission.",
  },
  { name: "Users", description: "User directory lookups used to resolve a handle or email to a user before granting access." },
  { name: "Mirror", description: "GitHub repository mirroring — inspect a repo and register it as a skill source." },
  {
    name: "System",
    description:
      "Service-level endpoints: this OpenAPI document and the Kubernetes liveness/readiness probes. The probes sit outside the /api/v1 prefix by design.",
  },
];

const DESCRIPTION = `Ornn is an agent-facing skill-lifecycle API: agents call it directly to
search, pull, install, execute, build, upload, and share skills. Think of it as an npm
registry and npm CLI fused into one HTTP surface, and model-agnostic — nothing here is
tied to a particular model runtime.

## Conventions

**Base path.** Every endpoint except the Kubernetes probes lives under \`/api/v1\`.
Prepend the server URL above.

**Success envelope.** Every 2xx JSON body is \`{ "data": <payload>, "error": null }\`.
Read your payload from \`data\`. Two endpoints deliberately opt out and return their
document at the body root: \`GET /api/v1/skill-manifest-schema.json\` and
\`GET /api/v1/openapi.json\`.

**Errors.** Every 4xx and 5xx response is RFC 7807 \`application/problem+json\`, with
fields at the **body root** — not inside the success envelope:

    {
      "type": "https://.../errors/skill_not_found",
      "title": "Resource not found",
      "status": 404,
      "detail": "Skill 'web-summarizer' does not exist",
      "instance": "/api/v1/skills/web-summarizer",
      "code": "skill_not_found",
      "requestId": "01J..."
    }

Branch on \`code\`, never on \`detail\`. On a validation failure (400), \`detail\` carries the
rejected fields as \`<path>: <message>\` pairs joined with \`; \` — there is no separate
per-field array.

**Auth.** Send a NyxID JWT as \`Authorization: Bearer <token>\`. Operations marked with
no security requirement are public. Operations that accept optional auth return a wider,
visibility-scoped result when a token is present.

**Visibility.** A private resource the caller may not read answers \`404\`, never \`403\`,
so existence is never leaked. A \`403\` means the resource is visible but the action is not
permitted.

**Correlation.** Every response carries \`X-Request-ID\`; it is echoed in the problem body
as \`requestId\`. Quote it in bug reports.

**Streaming.** Generation, playground, and assistant endpoints reply with
\`text/event-stream\`. The frame layout differs by surface, so check the operation you are
calling: the generation and playground streams send bare \`data: <json>\\n\\n\` frames with
**no** \`event:\` line — dispatch on the JSON body's own \`type\` field — while the assistant
stream sends both an \`event: <type>\` line and the \`data:\` line. Periodic keep-alive frames
hold the connection open and must be ignored.

Once a stream has opened with 200, later failures arrive **in-band** as an error event,
not as an HTTP status. Read the terminal event, not just the status code.

This document is generated at server boot from the same Zod schemas the handlers validate
against, so it cannot drift from the running API.`;

export function buildSpec(options: SpecOptions): OpenApiSpec {
  // MUST match the mount prefix in `bootstrap.ts` (`app.route("/api/v1",
  // apiApp)`) and CONVENTIONS.md §3. This is asserted against the booted
  // router in `tests/contract/openapiRoutes.test.ts` — do not change one
  // without the other.
  const prefix = "/api/v1";

  const paths: PathMap = {
    ...skillsCrudPaths(prefix),
    ...skillsetsPaths(prefix),
    ...searchFormatPaths(prefix),
    ...generationPaths(prefix),
    ...auditAnalyticsPaths(prefix),
    ...accountPaths(prefix),
    ...messagingPaths(prefix),
    ...adminPaths(prefix),
    ...adminQuotaPaths(prefix),
    ...adminSettingsPaths(prefix),
    ...usersMirrorPaths(prefix),
    ...systemPaths(prefix),
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Ornn API",
      version: options.version,
      description: DESCRIPTION,
    },
    servers: [{ url: options.serverUrl, description: "This deployment." }],
    tags: TAGS,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "NyxID JWT access token. Obtain one through the NyxID OAuth flow or by exchanging an API key, then send it as `Authorization: Bearer <token>`. Tokens expire on a deployment-configured interval and are refreshed through NyxID, not through this API.",
        },
      },
    },
    paths,
  };
}
