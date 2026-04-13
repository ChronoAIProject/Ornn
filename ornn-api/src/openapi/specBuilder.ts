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
  const result = zodToJsonSchema(zodSchema, { target: "openApi3", $refStrategy: "none" }) as JsonSchema;
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

function skillUploadPath(prefix: string): PathItem {
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

function skillReadPath(prefix: string): PathItem {
  return {
    get: {
      summary: "Get skill by GUID or name",
      description: "Retrieve full details of a single skill by its UUID or unique name. Returns metadata, tags, package download URL, visibility status, and timestamps. The presignedPackageUrl can be used to download the raw ZIP package. For accessing individual file contents without downloading the ZIP, use the /json endpoint instead.",
      operationId: "getSkill",
      tags: ["Skills"],
      security: bearerAuth(),
      parameters: [pathParam("idOrName", "Skill UUID (e.g. '550e8400-e29b-41d4-a716-446655440000') or unique skill name (e.g. 'web-summarizer')")],
      responses: { ...jsonResponse(S.skillDetailApiResponse), ...errorResponses(401, 404) },
    },
  };
}

function skillJsonPath(prefix: string): PathItem {
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

function skillUpdatePath(prefix: string): PathItem {
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

function skillDeletePath(prefix: string): PathItem {
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

function skillSearchPath(prefix: string): PathItem {
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

function skillGeneratePath(prefix: string): PathItem {
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

function categoriesListCreatePath(): PathItem {
  return {
    get: {
      summary: "List all skill categories",
      operationId: "listCategories",
      tags: ["Admin"],
      security: bearerAuth(),
      responses: { ...jsonResponse(S.categorySchema.array()), ...errorResponses(401) },
    },
    post: {
      summary: "Create a category",
      operationId: "createCategory",
      tags: ["Admin"],
      security: bearerAuth(),
      requestBody: {
        required: true,
        content: { "application/json": { schema: toSchema(S.createCategoryBodySchema) } },
      },
      responses: { ...jsonResponse(S.categorySchema, "Category created"), ...errorResponses(400, 401) },
    },
  };
}

function categoryUpdateDeletePath(): PathItem {
  return {
    put: {
      summary: "Update a category",
      operationId: "updateCategory",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [pathParam("id", "Category ID")],
      requestBody: {
        required: true,
        content: { "application/json": { schema: toSchema(S.updateCategoryBodySchema) } },
      },
      responses: { ...jsonResponse(S.categorySchema), ...errorResponses(400, 401, 404) },
    },
    delete: {
      summary: "Delete a category",
      operationId: "deleteCategory",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [pathParam("id", "Category ID")],
      responses: { ...jsonResponse(S.successResponseSchema), ...errorResponses(401, 404) },
    },
  };
}

function tagsListCreatePath(): PathItem {
  return {
    get: {
      summary: "List tags",
      operationId: "listTags",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [{ name: "type", in: "query", required: false, schema: { type: "string", enum: ["predefined", "custom"] } }],
      responses: { ...jsonResponse(S.tagSchema.array()), ...errorResponses(401) },
    },
    post: {
      summary: "Create a custom tag",
      operationId: "createTag",
      tags: ["Admin"],
      security: bearerAuth(),
      requestBody: {
        required: true,
        content: { "application/json": { schema: toSchema(S.createTagBodySchema) } },
      },
      responses: { ...jsonResponse(S.tagSchema, "Tag created"), ...errorResponses(400, 401) },
    },
  };
}

function tagDeletePath(): PathItem {
  return {
    delete: {
      summary: "Delete a tag",
      operationId: "deleteTag",
      tags: ["Admin"],
      security: bearerAuth(),
      parameters: [pathParam("id", "Tag ID")],
      responses: { ...jsonResponse(S.successResponseSchema), ...errorResponses(401, 404) },
    },
  };
}

// ---------------------------------------------------------------------------
// Spec builders
// ---------------------------------------------------------------------------

function baseSpec(title: string, description: string): OpenApiSpec {
  return {
    openapi: "3.1.0",
    info: { title, version: "2.0.0", description },
    servers: [{ url: "http://localhost:3802" }],
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

export function buildAgentSpec(): OpenApiSpec {
  const prefix = "/api/agent";
  return {
    ...baseSpec(
      "ornn-api Agent API",
      "API for AI agents and MCP tools to interact with the ornn skill registry. A 'skill' is a packaged AI prompt (with optional scripts and tool declarations) that can be searched, retrieved, executed, and generated. All endpoints require NyxID JWT authentication via Bearer token. Responses follow a uniform envelope: { data: T | null, error: { code, message } | null }.",
    ),
    tags: [
      { name: "Skills", description: "Upload, retrieve, and inspect AI skill packages. Each skill is a ZIP containing a skill.md file (YAML frontmatter + prompt body) and optional supporting files (scripts, configs). Use 'upload' to publish, 'get' to fetch metadata, and 'json' to read file contents without downloading the ZIP." },
      { name: "Search", description: "Find skills in the registry by keyword text matching or AI-powered semantic similarity. Supports pagination, visibility scope filtering (public/private/mixed), and optional model override for semantic search." },
      { name: "Generation", description: "Generate complete skill packages from natural language descriptions using AI. Supports single-turn and multi-turn conversational generation with real-time SSE streaming of progress events." },
    ],
    paths: {
      [`${prefix}/skills`]: skillUploadPath(prefix),
      [`${prefix}/skills/{idOrName}`]: skillReadPath(prefix),
      [`${prefix}/skills/{idOrName}/json`]: skillJsonPath(prefix),
      [`${prefix}/skill-search`]: skillSearchPath(prefix),
      [`${prefix}/skills/generate`]: skillGeneratePath(prefix),
    },
  };
}

export function buildWebSpec(): OpenApiSpec {
  const prefix = "/api/web";
  return {
    ...baseSpec(
      "ornn-api Web API",
      "Frontend-facing endpoints for the ornn web UI. Full skill CRUD, search, generation, playground, and admin.",
    ),
    tags: [
      { name: "Skills", description: "Skill CRUD operations" },
      { name: "Search", description: "Keyword and semantic skill search" },
      { name: "Generation", description: "AI-powered skill generation" },
      { name: "Format", description: "Skill format rules and validation" },
      { name: "Playground", description: "Credential management and chat" },
      { name: "Admin", description: "Category and tag management" },
    ],
    paths: {
      // Skills CRUD
      [`${prefix}/skills`]: skillUploadPath(prefix),
      [`${prefix}/skills/{idOrName}`]: skillReadPath(prefix),
      [`${prefix}/skills/{idOrName}/json`]: skillJsonPath(prefix),
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
      // Playground
      [`${prefix}/playground/chat`]: playgroundChatPath(),
      // Admin
      [`${prefix}/admin/categories`]: categoriesListCreatePath(),
      [`${prefix}/admin/categories/{id}`]: categoryUpdateDeletePath(),
      [`${prefix}/admin/tags`]: tagsListCreatePath(),
      [`${prefix}/admin/tags/{id}`]: tagDeletePath(),
    },
  };
}
