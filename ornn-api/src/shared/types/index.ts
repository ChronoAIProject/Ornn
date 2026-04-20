/**
 * Shared TypeScript types for ornn-api.
 * @module shared/types
 */

// ---------------------------------------------------------------------------
// API Response
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(code: string, message: string): AppError {
    return new AppError(400, code, message);
  }

  static unauthorized(code: string, message: string): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(code: string, message: string): AppError {
    return new AppError(403, code, message);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(404, code, message);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(409, code, message);
  }

  static payloadTooLarge(message: string): AppError {
    return new AppError(413, "PAYLOAD_TOO_LARGE", message);
  }

  static internal(message: string): AppError {
    return new AppError(500, "INTERNAL_ERROR", message);
  }

  static internalError(code: string, message: string): AppError {
    return new AppError(500, code, message);
  }

  static serviceUnavailable(code: string, message: string): AppError {
    return new AppError(503, code, message);
  }

  static gatewayTimeout(code: string, message: string): AppError {
    return new AppError(504, code, message);
  }
}

// ---------------------------------------------------------------------------
// Skill Types
// ---------------------------------------------------------------------------

export interface SkillDocument {
  guid: string;
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: SkillMetadata;
  skillHash: string;
  storageKey: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: Date;
  updatedBy: string;
  updatedOn: Date;
  isPrivate: boolean;
  /** System skills are auto-generated from NyxID service catalog. */
  isSystem?: boolean;
  /** NyxID service ID this system skill was generated from. */
  nyxidServiceId?: string;
  /**
   * Cached pointer to the highest version published for this skill, e.g. "1.2".
   * The `skill_versions` collection is the source of truth; this field exists
   * for fast default-read access and must be kept in sync by the service layer.
   */
  latestVersion: string;
}

/**
 * Immutable record of a single published version of a skill.
 * Stored in the `skill_versions` collection. The corresponding `SkillDocument`
 * carries the "latest version" pointer for fast default-read access; the
 * version collection is the source of truth for history + specific-version
 * fetches.
 */
export interface SkillVersionDocument {
  /** `${skillGuid}@${version}` — uniqueness guaranteed via `_id`. */
  _id: string;
  skillGuid: string;
  /** "<major>.<minor>" string, e.g. "1.2". */
  version: string;
  majorVersion: number;
  minorVersion: number;
  /** Storage key unique to this version — versions are immutable. */
  storageKey: string;
  skillHash: string;
  metadata: SkillMetadata;
  license: string | null;
  compatibility: string | null;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: Date;
}

export interface SkillMetadata {
  category: string;
  outputType?: "text" | "file";
  runtimes?: Array<{
    runtime: string;
    dependencies?: Array<{ library: string; version: string }>;
    envs?: Array<{ var: string; description: string }>;
  }>;
  tools?: Array<{
    tool: string;
    type: string;
    "mcp-servers"?: Array<{ mcp: string; version: string }>;
  }>;
  tags?: string[];
}

export interface SkillDetailResponse {
  guid: string;
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  skillHash: string;
  presignedPackageUrl: string;
  isPrivate: boolean;
  isSystem?: boolean;
  nyxidServiceId?: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  /**
   * Version of this skill payload: latest when no `?version=` query was
   * passed, otherwise the specifically requested version.
   */
  version: string;
}

export interface SkillSearchItem {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  isSystem?: boolean;
  nyxidServiceId?: string;
  tags: string[];
}

export interface SkillSearchResponse {
  searchMode: string;
  searchScope: string;
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  items: SkillSearchItem[];
}

// ---------------------------------------------------------------------------
// Category / Tag
// ---------------------------------------------------------------------------

export interface CategoryDocument {
  _id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagDocument {
  _id: string;
  name: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GeneratedSkill {
  name: string;
  description: string;
  category: "plain" | "runtime-based";
  outputType?: "text" | "file";
  tags: string[];
  readmeBody: string;
  runtimes: string[];
  dependencies: string[];
  envVars: string[];
  scripts: Array<{ filename: string; content: string }>;
}

export type SkillStreamEvent =
  | { type: "generation_start" }
  | { type: "token"; content: string }
  | { type: "generation_complete"; raw: string }
  | { type: "validation_error"; message: string; retrying: boolean }
  | { type: "error"; message: string };

export type PlaygroundChatEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCall: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool-result"; toolCallId: string; result: string }
  | { type: "file-output"; file: { path: string; content: string; size: number; mimeType: string } }
  | { type: "error"; message: string }
  | { type: "finish"; finishReason: string };

// ---------------------------------------------------------------------------
// Auth Types
// ---------------------------------------------------------------------------

export interface ApiKeyInfo {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

// ---------------------------------------------------------------------------
// Auth Utilities
// ---------------------------------------------------------------------------

export const INTERNAL_AUTH_HEADER = "X-Internal-Auth";

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000;
}

export function createErrorHandler(logger: { error: (...args: unknown[]) => void }) {
  return (err: Error, c: { json: (body: unknown, status: number) => unknown }) => {
    if (err instanceof AppError) {
      return c.json({ data: null, error: { code: err.code, message: err.message } }, err.statusCode);
    }
    logger.error(err, "Unhandled error");
    return c.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  };
}

