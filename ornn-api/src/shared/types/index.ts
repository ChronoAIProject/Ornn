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
  /**
   * Legacy back-compat field. Was used by an earlier "org-as-owner" design
   * to drive visibility; visibility logic no longer consults it. New skills
   * copy `createdBy` into it; safe to drop in a future cleanup migration.
   */
  ownerId: string;
  /**
   * The actual person who authored the skill. ALWAYS a person user_id —
   * never an org. Authors are the only non-admin principals allowed to
   * manage their skill (edit package, toggle public, change permissions,
   * delete).
   */
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: Date;
  updatedBy: string;
  updatedOn: Date;
  /**
   * False = fully public (anyone can read). True = private, with the
   * `sharedWithUsers` + `sharedWithOrgs` lists acting as an allow-list on
   * top of author + platform admin.
   */
  isPrivate: boolean;
  /**
   * Explicit per-user grants. Each entry is a NyxID person user_id. An
   * actor whose `userId` is in this list can read the skill even when
   * `isPrivate === true`. Author is implicitly included; do not duplicate
   * the author id in here.
   */
  sharedWithUsers: string[];
  /**
   * Explicit per-org grants. Each entry is a NyxID org user_id. An actor
   * who is an admin or member of any listed org can read the skill. Org
   * membership is resolved per-request via the NyxID lookup middleware.
   */
  sharedWithOrgs: string[];
  /**
   * Cached pointer to the highest version published for this skill, e.g. "1.2".
   * The `skill_versions` collection is the source of truth; this field exists
   * for fast default-read access and must be kept in sync by the service layer.
   */
  latestVersion: string;
  /**
   * Optional origin metadata. When a skill was created or last refreshed by
   * pulling from an external source (public GitHub repo today, potentially
   * other Git hosts later), we record where it came from so the refresh
   * endpoint knows what to re-fetch.
   *
   * Absent for hand-uploaded skills.
   */
  source?: SkillSource;
}

/**
 * Origin metadata for a skill pulled from an external source. The `type`
 * discriminator lets future additions (GitLab, Bitbucket, ...) live
 * alongside `github` without touching callers that only care about one.
 */
export type SkillSource =
  | {
      type: "github";
      /** `owner/name`. */
      repo: string;
      /** Branch, tag, or commit SHA. The actual commit SHA at pull time lives in `lastSyncedCommit`. */
      ref: string;
      /** Subdirectory inside the repo that contains SKILL.md. Empty string = repo root. */
      path: string;
      /** ISO timestamp of the most recent successful pull / refresh. */
      lastSyncedAt: Date;
      /** Commit SHA that was fetched at `lastSyncedAt`. Allows drift detection. */
      lastSyncedCommit: string;
    };

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
  /**
   * Mutable deprecation flag (phase 2). Absent/undefined means "not deprecated".
   * Deprecation only warns consumers — it does not hide the version from
   * `GET /versions` or exclude it from latest-resolution.
   */
  isDeprecated?: boolean;
  /** Optional human-readable explanation surfaced with the warning. */
  deprecationNote?: string | null;
  /**
   * Author-supplied release notes for this specific version. Read at
   * publish time from SKILL.md frontmatter (`release-notes` or
   * `releaseNotes`). Plain text, max 2000 chars. Null when the author
   * omitted it.
   */
  releaseNotes?: string | null;
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
  /** Legacy back-compat field. Not used for visibility; equals `createdBy` on new skills. */
  ownerId: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  /** Person user_ids granted explicit access. Same semantics as on `SkillDocument`. */
  sharedWithUsers: string[];
  /** Org user_ids granted access — every admin/member of these orgs can read the skill. */
  sharedWithOrgs: string[];
  /**
   * Version of this skill payload: latest when no `?version=` query was
   * passed, otherwise the specifically requested version.
   */
  version: string;
  /** True when the resolved version is marked deprecated by the author. */
  isDeprecated?: boolean;
  /** Optional note the author left when deprecating this version. */
  deprecationNote?: string | null;
  /**
   * Present when the skill was created or refreshed by pulling from an
   * external source (e.g. a public GitHub repo). Clients use this to
   * render a "source" link on the detail page and to power "Refresh from
   * source" actions. Serialized form — `lastSyncedAt` is an ISO string.
   */
  source?: {
    type: "github";
    repo: string;
    ref: string;
    path: string;
    lastSyncedAt: string;
    lastSyncedCommit: string;
  };
}

export interface SkillSearchItem {
  guid: string;
  name: string;
  description: string;
  /** Owner entity — person user_id or org user_id. */
  ownerId: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
  /**
   * Why the current caller can see this skill. Populated on search responses
   * where the caller is authenticated; omitted for anonymous callers.
   *   - "owner"          — caller authored it (or is platform admin).
   *   - "public"         — visible to everyone; caller has no special grant.
   *   - "shared-direct"  — private skill, caller is in `sharedWithUsers`.
   *   - "shared-via-org" — private skill, one of caller's orgs is in
   *                        `sharedWithOrgs`; `sharedViaOrgId` names the org.
   */
  myAccessReason?: "owner" | "public" | "shared-direct" | "shared-via-org";
  /** Present when `myAccessReason === "shared-via-org"`. */
  sharedViaOrgId?: string;
  /**
   * True when any of this skill's tags matches the slug of a NyxID service
   * the caller can manage (personal or org-inherited). Derived per-request
   * against `/api/me/nyxid-services`.
   */
  isSystemForMe?: boolean;
  /**
   * When `isSystemForMe`, the first matching service. Used by the UI to
   * render a "⚙️ <label>" chip without a second round-trip. Multiple
   * matches are possible; the first one wins.
   */
  systemForService?: { id: string; slug: string; label: string };
  /**
   * Compact view of the skill's ACL state. Cheap to compute (lengths
   * already on the doc) and lets card UIs render permission chips without
   * re-fetching the full skill.
   */
  permissionSummary?: {
    isPrivate: boolean;
    sharedUserCount: number;
    sharedOrgCount: number;
  };
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

