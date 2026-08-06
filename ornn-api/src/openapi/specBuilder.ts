/**
 * OpenAPI 3.1 spec builder. Generates web and agent specs from Zod schemas.
 * @module openapi/specBuilder
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import * as S from "./schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;
type PathItem = Record<string, unknown>;
type OpenApiSpec = Record<string, unknown>;

function toSchema(zodSchema: ZodTypeAny): JsonSchema {
  // Zod 4 changed the public ZodType signature; zod-to-json-schema's
  // type guards still target the v3 shape. Cast through `any` at the
  // boundary — the runtime shape is unchanged, this is purely the
  // type bridge.
  const result = zodToJsonSchema(zodSchema as unknown as Parameters<typeof zodToJsonSchema>[0], { target: "openApi3", $refStrategy: "none" }) as JsonSchema;
  // Remove top-level $schema key (not valid in OpenAPI component schemas)
  delete result.$schema;
  return result;
}

function jsonResponse(schema: ZodTypeAny, description = "Successful response"): Record<string, unknown> {
  return {
    "200": {
      description,
      content: { "application/json": { schema: toSchema(schema) } },
    },
  };
}

function sseResponse(description: string): Record<string, unknown> {
  return {
    "200": {
      description,
      content: { "text/event-stream": { schema: { type: "string" } } },
    },
  };
}

function errorResponses(...codes: number[]): Record<string, unknown> {
  const errorSchema = toSchema(S.apiErrorSchema);
  const envelope = {
    type: "object",
    properties: {
      data: { type: "null" },
      error: errorSchema,
    },
  };
  const map: Record<string, unknown> = {};
  const descriptions: Record<number, string> = {
    400: "Bad request — invalid input, missing required fields, or validation failure. Check the error message for details",
    401: "Unauthorized — missing, expired, or invalid JWT token. Obtain a new token from NyxID and retry",
    403: "Forbidden — authenticated but insufficient permissions (e.g. trying to modify another user's skill)",
    404: "Not found — the requested skill does not exist or is not accessible with current permissions",
    409: "Conflict — resource already exists (e.g. duplicate skill name)",
    413: "Payload too large — the uploaded ZIP exceeds the maximum allowed size",
    500: "Internal server error — unexpected failure. Retry or contact support",
  };
  for (const code of codes) {
    map[String(code)] = {
      description: descriptions[code] ?? `Error ${code}`,
      content: { "application/json": { schema: envelope } },
    };
  }
  return map;
}

function bearerAuth(): Record<string, unknown>[] {
  return [{ BearerAuth: [] }];
}

function queryParams(schema: ZodTypeAny): unknown[] {
  const jsonSchema = toSchema(schema) as { properties?: Record<string, JsonSchema>; required?: string[] };
  if (!jsonSchema.properties) return [];
  const required = new Set(jsonSchema.required ?? []);
  return Object.entries(jsonSchema.properties).map(([name, prop]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: prop,
    description: (prop as Record<string, unknown>).description ?? undefined,
  }));
}

function pathParam(name: string, description: string): Record<string, unknown> {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}

// ---------------------------------------------------------------------------
// Shared path definitions
// ---------------------------------------------------------------------------

function skillUploadPath(_prefix: string): PathItem {
  return {
    post: {
      summary: "Upload a skill package",
      description: "Upload a ZIP-packaged skill to the registry. The ZIP must contain at least a 'skill.md' file with valid YAML frontmatter defining the skill metadata (name, description, category, etc.). Optionally include supporting files such as scripts, templates, or configuration. The package is validated against format rules unless skip_validation is set. On success, the skill is stored and becomes available for search and retrieval. If a skill with the same name already exists for this user, it will be updated (new version).",
      operationId: "uploadSkill",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [{
        name: "skip_validation",
        in: "query",
        required: false,
        schema: { type: "boolean" },
        description: "If true, skip format validation rules (useful for importing legacy packages). Default is false — validation is enforced",
      }],
      requestBody: {
        required: true,
        description: "ZIP file containing the skill package. Must include a 'skill.md' file with YAML frontmatter. Max size depends on server configuration (typically 10MB).",
        content: { "application/zip": { schema: { type: "string", format: "binary" } } },
      },
      responses: { ...jsonResponse(S.skillDetailApiResponse, "Skill created"), ...errorResponses(400, 401, 413) },
    },
  };
}

function skillReadPath(_prefix: string): PathItem {
  return {
    get: {
      summary: "Get skill by GUID or name",
      description: "Retrieve full details of a single skill by its UUID or unique name. Returns metadata, tags, visibility status, and timestamps. To download the raw ZIP package use GET /skills/{idOrName}/versions/{version}/download; for individual file contents without downloading the ZIP, use the /json endpoint instead.",
      operationId: "getSkill",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [pathParam("idOrName", "Skill UUID (e.g. '550e8400-e29b-41d4-a716-446655440000') or unique skill name (e.g. 'web-summarizer')")],
      responses: { ...jsonResponse(S.skillDetailApiResponse), ...errorResponses(401, 404) },
    },
  };
}

function skillJsonPath(_prefix: string): PathItem {
  return {
    get: {
      summary: "Get skill package as JSON with all file contents",
      description: "Retrieve a skill's complete package contents as a JSON object without downloading the ZIP file. Returns the skill name, description, metadata, and a 'files' map where each key is a relative file path (e.g. 'skill.md', 'scripts/run.py') and each value is the full text content of that file. Binary files are excluded. This is the preferred endpoint for AI agents that need to read and understand skill contents programmatically.",
      operationId: "getSkillJson",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [pathParam("idOrName", "Skill UUID (e.g. '550e8400-e29b-41d4-a716-446655440000') or unique skill name (e.g. 'web-summarizer')")],
      responses: { ...jsonResponse(S.skillJsonApiResponse), ...errorResponses(401, 404) },
    },
  };
}

function skillDownloadPath(_prefix: string): PathItem {
  return {
    get: {
      summary: "Download a skill version's package ZIP",
      description: "Stream the raw ZIP package for a specific skill version. Bytes are proxied from object storage through ornn-api — clients never talk to the storage backend directly. `version` may be a literal (e.g. '1.2') or a dist-tag (e.g. 'latest'). Returns application/zip on success; a private skill the caller cannot read returns 404 (existence is not leaked).",
      operationId: "downloadSkillPackage",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [
        pathParam("idOrName", "Skill UUID or unique skill name"),
        pathParam("version", "Version literal (e.g. '1.2') or dist-tag (e.g. 'latest')"),
      ],
      responses: {
        200: {
          description: "The raw skill package ZIP bytes",
          content: { "application/zip": { schema: { type: "string", format: "binary" } } },
        },
        ...errorResponses(401, 404),
      },
    },
  };
}

function skillUpdatePath(_prefix: string): PathItem {
  return {
    put: {
      summary: "Update a skill (ZIP, metadata, or privacy flag)",
      operationId: "updateSkill",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [
        pathParam("id", "Skill GUID"),
        { name: "skip_validation", in: "query", required: false, schema: { type: "boolean" } },
      ],
      requestBody: {
        content: {
          "application/zip": { schema: { type: "string", format: "binary" } },
          "application/json": { schema: toSchema(S.updateSkillJsonBodySchema) },
        },
      },
      responses: { ...jsonResponse(S.skillDetailApiResponse), ...errorResponses(400, 401, 403, 404, 413) },
    },
  };
}

function skillDeletePath(_prefix: string): PathItem {
  return {
    delete: {
      summary: "Delete a skill",
      operationId: "deleteSkill",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [pathParam("id", "Skill GUID")],
      responses: { ...jsonResponse(S.successResponseSchema), ...errorResponses(401, 403, 404) },
    },
  };
}

function skillSearchPath(_prefix: string): PathItem {
  return {
    get: {
      summary: "Search skills by keyword or semantic similarity",
      description: "Search the skill registry using keyword matching or AI-powered semantic search. Keyword mode performs text matching against skill names, descriptions, and tags — fast and precise. Semantic mode uses LLM embeddings to find conceptually related skills even when exact terms don't match — slower but understands intent. Results are paginated. Use 'scope' to filter by visibility: 'public' for community skills, 'private' for your own skills, 'mixed' for both. An empty query with keyword mode returns all skills in the given scope.",
      operationId: "searchSkills",
      tags: ["Search"],
      security: bearerAuth(),
      parameters: queryParams(S.searchQuerySchema),
      responses: { ...jsonResponse(S.skillSearchApiResponse), ...errorResponses(400, 401) },
    },
  };
}

function skillGeneratePath(_prefix: string): PathItem {
  return {
    post: {
      summary: "Generate a skill via AI (SSE stream)",
      description: "Use AI to generate a complete skill package from a natural language description. Returns a Server-Sent Events (SSE) stream with real-time generation progress. Supports two modes: (1) Single-turn via 'prompt' field — describe the skill you want in one message. (2) Multi-turn via 'messages' array — provide a conversation history for iterative refinement (e.g. 'make it also handle PDFs'). The stream emits events: 'generation_start' when LLM begins, 'token' for incremental output, 'generation_complete' with the full generated skill content, 'validation_error' if the output fails format checks (may auto-retry), and 'error' on failure. Alternatively, use multipart/form-data with an existing skill package ZIP to modify or extend an existing skill based on the prompt.",
      operationId: "generateSkill",
      tags: ["Generation"],
      security: bearerAuth(),
      requestBody: {
        required: true,
        description: "Either JSON with a prompt/messages for generation, or multipart/form-data with a prompt and optional existing skill package ZIP for modification.",
        content: {
          "application/json": { schema: toSchema(S.generateJsonBodySchema) },
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                prompt: { type: "string", description: "Natural language description of the skill to generate or the modification to apply to the attached package" },
                package: { type: "string", format: "binary", description: "Optional existing skill package ZIP to use as a base for modification. When provided, the AI will modify this package according to the prompt rather than generating from scratch" },
              },
              required: ["prompt"],
            },
          },
        },
      },
      responses: { ...sseResponse("SSE stream of generation events. Event types: 'generation_start', 'token' (incremental LLM output), 'generation_complete' (full result), 'validation_error' (format check failed), 'error' (unrecoverable failure). Connect via EventSource or fetch with ReadableStream."), ...errorResponses(400, 401) },
    },
  };
}

// ---------------------------------------------------------------------------
// Web-only path definitions
// ---------------------------------------------------------------------------

function formatRulesPath(): PathItem {
  return {
    get: {
      summary: "Get skill format specification rules",
      operationId: "getFormatRules",
      tags: ["Format"],
      responses: jsonResponse(S.formatRulesResponseSchema),
    },
  };
}

function formatValidatePath(): PathItem {
  return {
    post: {
      summary: "Validate a ZIP package against format rules",
      operationId: "validateFormat",
      tags: ["Format"],
      security: bearerAuth(),
      requestBody: {
        required: true,
        content: { "application/zip": { schema: { type: "string", format: "binary" } } },
      },
      responses: { ...jsonResponse(S.formatValidationResponseSchema), ...errorResponses(400, 401) },
    },
  };
}

/**
 * JSON Schema for SKILL.md frontmatter (#464). Unlike the other format
 * endpoints this one returns a raw JSON Schema document — no envelope —
 * so external tooling (IDEs, schemastore.org) consumes it directly.
 */
function formatSchemaPath(): PathItem {
  return {
    get: {
      summary: "JSON Schema for SKILL.md frontmatter",
      description:
        "Canonical JSON Schema (draft-7) for `SKILL.md` YAML frontmatter, generated from the server's Zod schema. Public, long-cacheable. Returns the schema document at the body root with `Content-Type: application/schema+json` — not the standard `{ data, error }` envelope, since consumers (VS Code, Cursor, schemastore.org) expect a raw JSON Schema.",
      operationId: "getFormatSchema",
      tags: ["Format"],
      responses: {
        200: {
          description: "JSON Schema document",
          content: {
            "application/schema+json": {
              schema: { type: "object" },
            },
          },
        },
      },
    },
  };
}

function playgroundChatPath(): PathItem {
  return {
    post: {
      summary: "Multi-turn playground chat (SSE stream)",
      operationId: "playgroundChat",
      tags: ["Playground"],
      security: bearerAuth(),
      requestBody: {
        required: true,
        content: { "application/json": { schema: toSchema(S.chatRequestBodySchema) } },
      },
      responses: { ...sseResponse("SSE stream of chat events"), ...errorResponses(400, 401) },
    },
  };
}

function assistantChatPath(): PathItem {
  return {
    post: {
      summary: "Ornn Assistant — repo-aware Q&A chat (SSE stream)",
      description:
        "Pure, non-agentic Q&A about Ornn and the skills the caller may see. Grounds answers in a curated knowledge-base digest plus a visibility-scoped skill retrieval (SAFE fields only). SSE event types: 'chat_start', 'chat_text_delta', 'chat_error', 'chat_finish' (+ keepalive comment frames). No tools / no execution.",
      operationId: "assistantChat",
      tags: ["Assistant"],
      security: bearerAuth(),
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: toSchema(S.assistantChatRequestBodySchema) },
        },
      },
      responses: {
        ...sseResponse("SSE stream of assistant chat events"),
        ...errorResponses(400, 401, 429, 503),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Spec builders
// ---------------------------------------------------------------------------

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

function baseSpec(title: string, description: string, options: SpecOptions): OpenApiSpec {
  return {
    openapi: "3.1.0",
    info: { title, version: options.version, description },
    servers: [{ url: options.serverUrl }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "NyxID JWT access token. Obtain by authenticating with NyxID OAuth flow or API key exchange. Pass as 'Authorization: Bearer <token>' header. Tokens expire after a configurable period and must be refreshed via NyxID",
        },
      },
    },
  };
}

export function buildSpec(options: SpecOptions): OpenApiSpec {
  // MUST match the mount prefix in `bootstrap.ts` (`app.route("/api/v1",
  // apiApp)`) and CONVENTIONS.md §3. This is asserted against the booted
  // router in `tests/contract/openapiRoutes.test.ts` — do not change one
  // without the other.
  const prefix = "/api/v1";
  return {
    ...baseSpec(
      "ornn API",
      "API for ornn — the end-to-end skill life-cycle manager for AI agents. Covers the full life-cycle: skill CRUD, search, AI-powered generation, playground, audit, and admin endpoints — from spec to ship. All endpoints require NyxID authentication via Bearer token. Responses follow a uniform envelope: { data: T | null, error: { code, message } | null }.",
      options,
    ),
    tags: [
      { name: "Skills", description: "Upload, retrieve, update, delete, and inspect AI skill packages." },
      { name: "Search", description: "Find skills by keyword text matching or AI-powered semantic similarity." },
      { name: "Generation", description: "Generate complete skill packages from natural language descriptions using AI." },
      { name: "Format", description: "Skill format rules and validation" },
      { name: "Playground", description: "Multi-turn chat playground" },
    ],
    paths: {
      // Skills CRUD
      [`${prefix}/skills`]: skillUploadPath(prefix),
      [`${prefix}/skills/{idOrName}`]: skillReadPath(prefix),
      [`${prefix}/skills/{idOrName}/json`]: skillJsonPath(prefix),
      [`${prefix}/skills/{idOrName}/versions/{version}/download`]: skillDownloadPath(prefix),
      [`${prefix}/skills/{id}`]: {
        ...skillUpdatePath(prefix),
        ...skillDeletePath(prefix),
      },
      // Search
      [`${prefix}/skill-search`]: skillSearchPath(prefix),
      // Generation
      [`${prefix}/skills/generate`]: skillGeneratePath(prefix),
      // Format
      [`${prefix}/skill-format/rules`]: formatRulesPath(),
      [`${prefix}/skill-format/validate`]: formatValidatePath(),
      [`${prefix}/skill-manifest-schema.json`]: formatSchemaPath(),
      // Playground
      [`${prefix}/playground/chat`]: playgroundChatPath(),
      // Assistant (#970)
      [`${prefix}/assistant/chat`]: assistantChatPath(),
    },
  };
}
