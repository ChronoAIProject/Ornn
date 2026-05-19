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
    return new AppError(413, "payload_too_large", message);
  }

  static internal(message: string): AppError {
    return new AppError(500, "internal_error", message);
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
   * The actual person who authored the skill. ALWAYS a person user_id —
   * never an org. Authors are the only non-admin principals allowed to
   * manage their skill (edit package, toggle public, change permissions,
   * delete). #581 removed the legacy `ownerId` mirror of this field.
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
  /**
   * NyxID service this skill is tied to. Null/undefined when untied.
   * The tied service determines whether the skill is a "system" skill:
   * tying to a service with `visibility: "public"` (admin/platform-wide)
   * sets `isSystemSkill: true` and forces `isPrivate: false`; tying to a
   * private service the caller owns leaves privacy alone.
   */
  nyxidServiceId?: string | null;
  /** Cached service slug for cheap card/list rendering. */
  nyxidServiceSlug?: string | null;
  /** Cached service label for cheap card/list rendering. */
  nyxidServiceLabel?: string | null;
  /**
   * Cached: true iff `nyxidServiceId` points at an admin/platform-wide
   * service (NyxID `visibility: "public"`). System skills are always
   * `isPrivate: false`. Maintained at tie-time; slight staleness is
   * accepted if NyxID flips a service's visibility — re-tie refreshes.
   */
  isSystemSkill?: boolean;
  /**
   * Per-skill GitHub mirror state. Set by `MirrorService` after a
   * successful publish/reconcile commit lands; unset (`$unset`) when
   * the skill is removed from the mirror (privacy flipped to private,
   * skill deleted, or admin reset).
   *
   * Absent ⇒ this skill has never been mirrored, or was un-mirrored.
   * Present ⇒ the named version was committed to the GitHub mirror at
   * `syncedAt` under `commitSha`.
   *
   * `version` may lag behind `latestVersion` between a fresh publish
   * and the next mirror sync — the frontend uses that gap to render a
   * "lagging" chip.
   */
  mirrorSync?: {
    version: string;
    syncedAt: Date;
    commitSha: string;
  };
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
      /**
       * ISO timestamp of the most recent successful pull / refresh.
       * Absent when the source pointer was attached without an immediate
       * sync (the user can save a GitHub link first and trigger the sync
       * later from the detail-page advanced options).
       */
      lastSyncedAt?: Date;
      /**
       * Commit SHA that was fetched at `lastSyncedAt`. Allows drift
       * detection. Absent in the same "linked but not yet synced" state.
       */
      lastSyncedCommit?: string;
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
  /**
   * AgentSeal scan record (#253). Persisted on first publish + every
   * subsequent version publish. Null when the scan hasn't run yet
   * (legacy versions or rows where AgentSeal failed / was disabled).
   * v1 is warn-only — score is advisory, not a gate.
   */
  agentsealScan?: AgentsealScanSnapshot | null;
}

/**
 * Persisted-on-version-doc snapshot of an AgentSeal scan run.
 */
export interface AgentsealScanSnapshot {
  /** 0–100. Computed from severity-weighted finding penalties. */
  score: number;
  /** Findings array from the per-file SkillScanner sweep. */
  findings: ReadonlyArray<Record<string, unknown>>;
  /** ISO timestamp of completion. */
  scannedAt: string;
  /** Pinned AgentSeal package version. */
  agentsealVersion: string;
  /** Count of files actually scanned in this run. Optional for back-compat. */
  scannedFiles?: number;
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
    /**
     * Absent when the skill was linked but not yet synced (the user can
     * attach a GitHub URL via PUT /skills/:id/source first and trigger
     * the sync separately via POST /skills/:id/refresh).
     */
    lastSyncedAt?: string;
    /** Absent in the same "linked but never synced" state. */
    lastSyncedCommit?: string;
  };
  /** NyxID service tie (null when untied). See `SkillDocument.nyxidServiceId`. */
  nyxidServiceId?: string | null;
  nyxidServiceSlug?: string | null;
  nyxidServiceLabel?: string | null;
  /** Cached: true iff tied to an admin/platform-wide NyxID service. */
  isSystemSkill?: boolean;
  /**
   * AgentSeal trust score for the resolved version (#253). Null when
   * the version hasn't been scanned (legacy / disabled). Frontend
   * renders a color-coded badge from this — see DESIGN.md.
   */
  agentsealScan?: AgentsealScanSnapshot | null;
  /**
   * Per-skill GitHub mirror state. Absent ⇒ never mirrored (or
   * un-mirrored after a privacy flip / explicit reset). Present ⇒ the
   * named version was committed to the GitHub mirror at `syncedAt`.
   * `commitSha` is the GitHub commit pointer for that sync, suitable
   * for an audit-link from the UI.
   *
   * Front-end chip semantics:
   *   - skill `isPrivate` ⇒ chip hidden entirely
   *   - `mirrorSync` absent ⇒ "Never synced"
   *   - `mirrorSync.version === SkillDetailResponse.version` ⇒ "Synced"
   *   - `mirrorSync.version !== version` ⇒ "Lagging" (mirror push pending)
   */
  mirrorSync?: {
    version: string;
    syncedAt: string;
    commitSha: string;
  };
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
  /**
   * NyxID service tie surfaced on the search row so cards can render the
   * "⚙ <serviceLabel>" chip without a second round-trip. `null` when
   * untied.
   */
  nyxidServiceId?: string | null;
  nyxidServiceSlug?: string | null;
  nyxidServiceLabel?: string | null;
  /** Cached: true iff tied to an admin/platform-wide NyxID service. */
  isSystemSkill?: boolean;
  /**
   * True when the skill has a `source` pointer of type "github". The
   * card UI uses this to render a small non-clickable GitHub mark; the
   * actual repo URL is not exposed in search results — callers drill
   * into the detail page if they want to follow the link.
   */
  hasGithubSource?: boolean;
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
// Auth Utilities
// ---------------------------------------------------------------------------

// `ApiKeyInfo` + `INTERNAL_AUTH_HEADER` were removed in #581. They
// existed only to support the dead `clients/nyxid/auth.ts` AuthClient,
// itself an unmounted middleware leftover.
//
// `createErrorHandler` was also removed — the live error handler lives
// on the Hono app via `app.onError(...)` in bootstrap.ts; no route
// imported this function.

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000;
}
