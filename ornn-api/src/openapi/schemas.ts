/**
 * Zod schemas for OpenAPI spec generation.
 * Mirrors the request/response types used across all routes.
 * @module openapi/schemas
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  code: z.string().describe("Machine-readable error code (e.g. SKILL_NOT_FOUND, VALIDATION_ERROR)"),
  message: z.string().describe("Human-readable error description"),
});

function apiResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema.nullable(),
    error: apiErrorSchema.nullable(),
  });
}

export const successResponseSchema = apiResponse(z.object({ success: z.boolean() }));

// ---------------------------------------------------------------------------
// Skill Metadata
// ---------------------------------------------------------------------------

export const skillMetadataSchema = z.object({
  category: z.string().describe("Skill category determining execution model: 'plain' (prompt-only), 'tool-based' (uses MCP tools), 'runtime-based' (executes code in sandbox), 'mixed' (combines tools and runtime)"),
  outputType: z.enum(["text", "file"]).optional().describe("Output type: 'text' returns stdout content, 'file' returns generated files retrieved via glob pattern from sandbox"),
  runtimes: z.array(z.object({
    runtime: z.string().describe("Runtime environment identifier: 'node' (Node.js) or 'python'"),
    dependencies: z.array(z.object({
      library: z.string().describe("Package name (e.g. 'axios', 'numpy')"),
      version: z.string().describe("Semver version constraint (e.g. '^1.0.0', '>=2.0')"),
    })).optional().describe("Runtime dependencies to install before execution"),
    envs: z.array(z.object({
      var: z.string().describe("Environment variable name (e.g. 'OPENAI_API_KEY')"),
      description: z.string().describe("Human-readable description of what this env var is used for"),
    })).optional().describe("Environment variables required at execution time, provided by the user"),
  })).optional().describe("Runtime configurations for sandbox execution. Each entry defines a runtime with its dependencies and required env vars"),
  tools: z.array(z.object({
    tool: z.string().describe("Tool identifier as referenced in the skill prompt"),
    type: z.string().describe("Tool type: 'builtin' (provided by platform) or 'mcp' (from MCP server)"),
    "mcp-servers": z.array(z.object({
      mcp: z.string().describe("MCP server package name"),
      version: z.string().describe("MCP server version"),
    })).optional().describe("MCP server dependencies required for this tool"),
  })).optional().describe("External tools the skill invokes during LLM execution"),
  tags: z.array(z.string()).optional().describe("Classification tags for search and discovery"),
});

// ---------------------------------------------------------------------------
// Skill CRUD
// ---------------------------------------------------------------------------

export const skillDetailResponseSchema = z.object({
  guid: z.string().describe("Unique identifier (UUID) of the skill"),
  name: z.string().describe("Skill name, unique across the platform. Used as the human-readable identifier in URLs and references"),
  description: z.string().describe("Brief description of what the skill does and when to use it"),
  license: z.string().nullable().describe("SPDX license identifier (e.g. 'MIT', 'Apache-2.0'), or null if not specified"),
  compatibility: z.string().nullable().describe("Compatible AI model or platform (e.g. 'claude', 'gpt-4'), or null if model-agnostic"),
  metadata: z.record(z.unknown()).describe("Structured skill metadata including category, outputType, runtimes, tools, and tags. See skill format spec for full schema"),
  tags: z.array(z.string()).describe("List of tag names for categorization and search filtering"),
  skillHash: z.string().describe("SHA-256 hash of the skill package contents. Changes when the skill is updated"),
  presignedPackageUrl: z.string().describe("Temporary pre-signed URL to download the skill package ZIP file. Expires after a short period"),
  isPrivate: z.boolean().describe("If true, only the owner can view and use this skill. If false, the skill is publicly listed in the registry"),
  createdBy: z.string().describe("Email address of the user who created the skill"),
  createdOn: z.string().describe("ISO 8601 timestamp of when the skill was created"),
  updatedOn: z.string().describe("ISO 8601 timestamp of the most recent update"),
});

export const skillDetailApiResponse = apiResponse(skillDetailResponseSchema);

export const skillJsonResponseSchema = z.object({
  name: z.string().describe("Skill name"),
  description: z.string().describe("Skill description"),
  metadata: z.record(z.unknown()).describe("Structured skill metadata (category, outputType, runtimes, tools, tags)"),
  files: z.record(z.string()).describe("Map of relative file path to file content string. Keys are paths like 'skill.md', 'scripts/run.py'. Values are the full text content of each file. Binary files are excluded"),
});

export const skillJsonApiResponse = apiResponse(skillJsonResponseSchema);

export const updateSkillJsonBodySchema = z.object({
  isPrivate: z.boolean().optional().describe("Set to true to make the skill private (owner-only), or false to make it publicly visible in the registry"),
});

// ---------------------------------------------------------------------------
// Skill Search
// ---------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  query: z.string().max(2000).optional().default("").describe("Free-text search query. For keyword mode, matches against skill name, description, and tags. For semantic mode, uses LLM embeddings to find conceptually related skills. Max 2000 characters. Empty string returns all skills"),
  mode: z.enum(["keyword", "semantic"]).optional().default("keyword").describe("Search strategy: 'keyword' performs text matching (fast, exact), 'semantic' uses LLM to find conceptually similar skills (slower, requires model)"),
  scope: z.enum(["public", "private", "mixed"]).optional().default("private").describe("Visibility filter: 'public' searches only public skills, 'private' searches only the authenticated user's private skills, 'mixed' searches both"),
  page: z.coerce.number().int().min(1).optional().default(1).describe("Page number for pagination, starting from 1"),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(9).describe("Number of results per page (1-100, default 9)"),
  model: z.string().optional().describe("LLM model identifier to use for semantic search embedding. Only applicable when mode is 'semantic'. If omitted, uses the platform default model"),
});

export const skillSearchItemSchema = z.object({
  guid: z.string().describe("Unique identifier (UUID) of the skill"),
  name: z.string().describe("Skill name"),
  description: z.string().describe("Brief description of the skill"),
  createdBy: z.string().describe("Email of the skill author"),
  createdOn: z.string().describe("ISO 8601 creation timestamp"),
  updatedOn: z.string().describe("ISO 8601 last-updated timestamp"),
  isPrivate: z.boolean().describe("Whether the skill is private (owner-only) or publicly visible"),
  tags: z.array(z.string()).describe("Tag names for categorization"),
});

export const skillSearchResponseSchema = z.object({
  searchMode: z.string().describe("The search mode that was used: 'keyword' or 'semantic'"),
  searchScope: z.string().describe("The visibility scope that was applied: 'public', 'private', or 'mixed'"),
  total: z.number().describe("Total number of matching skills across all pages"),
  totalPages: z.number().describe("Total number of pages available"),
  page: z.number().describe("Current page number"),
  pageSize: z.number().describe("Number of items per page"),
  items: z.array(skillSearchItemSchema).describe("Array of skill summaries for the current page"),
});

export const skillSearchApiResponse = apiResponse(skillSearchResponseSchema);

// ---------------------------------------------------------------------------
// Skill Generation
// ---------------------------------------------------------------------------

export const generateJsonBodySchema = z.object({
  messages: z.array(z.object({
    role: z.string().describe("Message role: 'user' or 'assistant'"),
    content: z.string().describe("Message text content"),
  })).optional().describe("Multi-turn conversation history for iterative skill generation. Use this to refine a skill across multiple exchanges. Mutually exclusive with 'prompt'"),
  prompt: z.string().optional().describe("Single-turn natural language prompt describing the skill to generate (e.g. 'Create a skill that summarizes web pages'). Mutually exclusive with 'messages'. Use 'messages' instead for multi-turn refinement"),
  model: z.string().optional().describe("LLM model identifier to use for generation. If omitted, uses the platform default model"),
});

export const generationStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("generation_start") }).describe("Emitted when generation begins"),
  z.object({ type: z.literal("token"), content: z.string().describe("Incremental text token from the LLM") }).describe("Streamed token from the LLM during generation"),
  z.object({ type: z.literal("generation_complete"), raw: z.string().describe("Complete raw LLM output containing the full generated skill in markdown format") }).describe("Emitted when the LLM finishes generating. The 'raw' field contains the full skill package content"),
  z.object({ type: z.literal("validation_error"), message: z.string().describe("Description of the validation failure"), retrying: z.boolean().describe("If true, the system is automatically retrying generation with corrected constraints") }).describe("Emitted when the generated skill fails format validation"),
  z.object({ type: z.literal("error"), message: z.string().describe("Error description") }).describe("Emitted on unrecoverable generation failure"),
]);

// ---------------------------------------------------------------------------
// Skill Format
// ---------------------------------------------------------------------------

export const formatRulesResponseSchema = apiResponse(z.object({ rules: z.string() }));

export const formatValidationResponseSchema = apiResponse(z.object({
  valid: z.boolean(),
  violations: z.array(z.object({ rule: z.string(), message: z.string() })).optional(),
}));

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

export const chatRequestBodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "tool", "system"]),
    content: z.string(),
    toolCalls: z.array(z.object({
      id: z.string(),
      name: z.string(),
      args: z.record(z.unknown()),
    })).optional(),
    toolCallId: z.string().optional(),
  })).min(1).max(100),
  skillId: z.string().optional(),
  envVars: z.record(z.string()).optional(),
});

export const playgroundChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), delta: z.string() }),
  z.object({ type: z.literal("tool-call"), toolCall: z.object({ id: z.string(), name: z.string(), args: z.record(z.unknown()) }) }),
  z.object({ type: z.literal("tool-result"), toolCallId: z.string(), result: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("finish"), finishReason: z.string() }),
]);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createCategoryBodySchema = z.object({
  name: z.enum(["plain", "tool-based", "runtime-based", "mixed"]),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1).max(500),
  order: z.number().int().min(0).optional(),
});

export const updateCategoryBodySchema = z.object({
  description: z.string().min(1).max(500).optional(),
  order: z.number().int().min(0).optional(),
});

export const tagSchema = z.object({
  _id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});

export const createTagBodySchema = z.object({
  name: z.string().min(1).max(30).regex(/^[a-z0-9-_]+$/),
});
