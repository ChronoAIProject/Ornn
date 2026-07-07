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

/**
 * Permission level a grant confers on a skill / skillset (#1123).
 * - `read`       → view / pull / execute / read versions.
 * - `write` → READ plus update the skill's content & metadata. Does
 *   NOT include any admin / danger-zone operation (change permissions,
 *   transfer ownership, delete skill/version, toggle deprecation, manage
 *   dist-tags, bind NyxID service) — those stay with the owner (`createdBy`)
 *   and platform admins only.
 */
export type SkillPermissionLevel = "read" | "write";

/** The kind of principal a grant targets. */
export type SkillGrantPrincipalType = "user" | "org";

/**
 * One typed access grant on a skill / skillset (#1123). The canonical shape
 * that replaces the legacy read-only `sharedWithUsers` / `sharedWithOrgs`
 * allow-lists: every grant pairs a principal with a permission `level`.
 *
 * - `type` — `user` (NyxID person user_id) or `org` (NyxID org user_id).
 * - `id`   — the principal's NyxID id.
 * - `level`— `read` or `write`.
 *
 * The author (`createdBy`) is never represented here — they hold implicit
 * ADMIN. Public skills (`isPrivate === false`) are readable by everyone
 * regardless of grants; `write` only ever applies to explicit grants.
 */
export interface SkillGrant {
  type: SkillGrantPrincipalType;
  id: string;
  level: SkillPermissionLevel;
}

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
  // Optionals widen to `T | undefined` so partial-update / Zod-inferred
  // shapes assign cleanly under exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
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
   * Typed access grants (#1123) — the canonical source of truth for who can
   * read vs. write the skill, beyond the author + platform admin.
   *
   * Optional for back-compat: skills created before #1123 carry only the
   * legacy `sharedWithUsers` / `sharedWithOrgs` read lists. Readers MUST fall
   * back to deriving read-level grants from those lists when this field is
   * absent — see `effectiveGrants` in `crud/grants.ts`. The boot migration
   * backfills it; the repository dual-writes the legacy lists so older code
   * keeps resolving read visibility during a rolling deploy.
   */
  grants?: SkillGrant[] | undefined;
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
  source?: SkillSource | undefined;
  /**
   * NyxID service this skill is tied to. Null/undefined when untied.
   * The tied service determines whether the skill is a "system" skill:
   * tying to a service with `visibility: "public"` (admin/platform-wide)
   * sets `isSystemSkill: true` and forces `isPrivate: false`; tying to a
   * private service the caller owns leaves privacy alone.
   */
  nyxidServiceId?: string | null | undefined;
  /** Cached service slug for cheap card/list rendering. */
  nyxidServiceSlug?: string | null | undefined;
  /** Cached service label for cheap card/list rendering. */
  nyxidServiceLabel?: string | null | undefined;
  /**
   * Cached: true iff `nyxidServiceId` points at an admin/platform-wide
   * service (NyxID `visibility: "public"`). System skills are always
   * `isPrivate: false`. Maintained at tie-time; slight staleness is
   * accepted if NyxID flips a service's visibility — re-tie refreshes.
   */
  isSystemSkill?: boolean | undefined;
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
  mirrorSync?:
    | {
        version: string;
        syncedAt: Date;
        commitSha: string;
      }
    | undefined;
  /**
   * Dist-tags per #463 — npm-style aliases that resolve to a concrete
   * version. Lets callers pin to a stable channel without enumerating
   * versions.
   *
   * - `latest` is **auto-managed**: every successful version publish
   *   sets `distTags.latest` to the new version. Cannot be PUT/DELETEd
   *   via the API (those return `dist_tag_immutable`).
   * - Other tags (`stable`, `beta`, `rc1`, ...) are owner-managed via
   *   `PUT /v1/skills/:id/dist-tags/:tag` and freely deletable.
   *
   * Absent on legacy skills published before #463 — readers treat
   * absence as `{ latest: <skill.latestVersion> }`.
   */
  distTags?: Record<string, string> | undefined;
}

/**
 * Cached drift verdict from the most recent source-drift check (#1175).
 * - `in_sync` — upstream HEAD equals `lastSyncedCommit`.
 * - `drifted` — upstream moved; a re-pull would publish a new version.
 * - `changed_unversioned` — upstream changed but `SKILL.md` version did not
 *   advance (reserved for the auto-publish phase #1177).
 * - `broken` — the source repo/ref could not be resolved (404 / made
 *   private / deleted).
 */
export type SkillSourceDriftState =
  | "in_sync"
  | "drifted"
  | "changed_unversioned"
  | "broken";

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
      lastSyncedAt?: Date | undefined;
      /**
       * Commit SHA that was fetched at `lastSyncedAt`. Allows drift
       * detection. Absent in the same "linked but not yet synced" state.
       */
      lastSyncedCommit?: string | undefined;
      /**
       * Upstream HEAD commit SHA observed by the most recent drift check
       * (#1175). When present and different from `lastSyncedCommit`, the
       * upstream has moved. Written by `checkSourceDrift`; never mutates
       * the package itself.
       */
      upstreamHeadSha?: string | undefined;
      /**
       * ETag returned by the last `git/ref` probe, replayed via
       * `If-None-Match` so an unchanged upstream answers with a free `304`.
       */
      etag?: string | undefined;
      /** Wall-clock time of the most recent drift check. */
      lastCheckedAt?: Date | undefined;
      /** Cached drift verdict from the last check. See {@link SkillSourceDriftState}. */
      driftState?: SkillSourceDriftState | undefined;
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
  // Optionals widen to `T | undefined` so partial-update / Zod-inferred
  // shapes assign cleanly under exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
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
  /**
   * Skill dependencies (#968). Each entry pins another skill by
   * `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>` (the
   * `metadata.depends-on` frontmatter field, kebab→camel mapped on
   * extract). Persisted per immutable version inside
   * `SkillVersionDocument.metadata`, so no new version-doc field or
   * migration is needed — a version published before #968 simply reads
   * back with `dependsOn` absent. Empty/omitted = no dependencies.
   */
  dependsOn?: string[];
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
  // Package bytes are fetched via `GET /skills/:idOrName/versions/:version/
  // download` (#1196) — the response no longer carries a presigned URL.
  isPrivate: boolean;
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: string;
  updatedOn: string;
  /** Person user_ids granted explicit access. Same semantics as on `SkillDocument`. */
  sharedWithUsers: string[];
  /** Org user_ids granted access — every admin/member of these orgs can read the skill. */
  sharedWithOrgs: string[];
  /**
   * Typed access grants (#1123) — the canonical read/write ACL. Always
   * present in responses (the service emits `effectiveGrants(skill)` so even
   * an un-migrated skill surfaces its legacy lists as read grants here).
   */
  grants?: SkillGrant[] | undefined;
  /**
   * Version of this skill payload: latest when no `?version=` query was
   * passed, otherwise the specifically requested version.
   */
  version: string;
  /** True when the resolved version is marked deprecated by the author. */
  isDeprecated?: boolean | undefined;
  /** Optional note the author left when deprecating this version. */
  deprecationNote?: string | null | undefined;
  /**
   * Present when the skill was created or refreshed by pulling from an
   * external source (e.g. a public GitHub repo). Clients use this to
   * render a "source" link on the detail page and to power "Refresh from
   * source" actions. Serialized form — `lastSyncedAt` is an ISO string.
   */
  source?:
    | {
        type: "github";
        repo: string;
        ref: string;
        path: string;
        /**
         * Absent when the skill was linked but not yet synced.
         */
        lastSyncedAt?: string | undefined;
        /** Absent in the same "linked but never synced" state. */
        lastSyncedCommit?: string | undefined;
        /** Upstream HEAD from the last drift check (#1175). */
        upstreamHeadSha?: string | undefined;
        /** Wall-clock time of the last drift check (ISO string). */
        lastCheckedAt?: string | undefined;
        /** Cached drift verdict. See `SkillSourceDriftState`. */
        driftState?: SkillSourceDriftState | undefined;
      }
    | undefined;
  /** NyxID service tie (null when untied). See `SkillDocument.nyxidServiceId`. */
  nyxidServiceId?: string | null | undefined;
  nyxidServiceSlug?: string | null | undefined;
  nyxidServiceLabel?: string | null | undefined;
  /** Cached: true iff tied to an admin/platform-wide NyxID service. */
  isSystemSkill?: boolean | undefined;
  /**
   * AgentSeal trust score for the resolved version (#253). Null when
   * the version hasn't been scanned (legacy / disabled). Frontend
   * renders a color-coded badge from this — see DESIGN.md.
   */
  agentsealScan?: AgentsealScanSnapshot | null | undefined;
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
  mirrorSync?:
    | {
        version: string;
        syncedAt: string;
        commitSha: string;
      }
    | undefined;
  /**
   * Dist-tags for this skill (#463). Keys are tag names (`latest`,
   * `stable`, `beta`, ...); values are the concrete version each tag
   * currently points at. `latest` is always present and auto-managed
   * server-side. Absent on legacy skills published before #463.
   */
  distTags?: Record<string, string> | undefined;
}

export interface SkillSearchItem {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
  myAccessReason?: "owner" | "public" | "shared-direct" | "shared-via-org" | undefined;
  sharedViaOrgId?: string | undefined;
  /**
   * True when any of this skill's tags matches the slug of a NyxID service
   * the caller can manage (personal or org-inherited). Derived per-request
   * against `/api/me/nyxid-services`.
   */
  isSystemForMe?: boolean | undefined;
  systemForService?: { id: string; slug: string; label: string } | undefined;
  permissionSummary?:
    | {
        isPrivate: boolean;
        sharedUserCount: number;
        sharedOrgCount: number;
      }
    | undefined;
  nyxidServiceId?: string | null | undefined;
  nyxidServiceSlug?: string | null | undefined;
  nyxidServiceLabel?: string | null | undefined;
  /** Cached: true iff tied to an admin/platform-wide NyxID service. */
  isSystemSkill?: boolean | undefined;
  /**
   * True when the skill has a `source` pointer of type "github". The
   * card UI uses this to render a small non-clickable GitHub mark; the
   * actual repo URL is not exposed in search results — callers drill
   * into the detail page if they want to follow the link.
   */
  hasGithubSource?: boolean | undefined;
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

// ---------------------------------------------------------------------------
// RFC 7807 error body (#456)
// ---------------------------------------------------------------------------

/**
 * Wire shape of the RFC 7807 `application/problem+json` body the API
 * emits on every 4xx/5xx response. Fields at the root, not inside an
 * envelope. See CONVENTIONS.md §1.3 and docs/ERRORS.md.
 */
export interface ProblemJsonBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
  readonly requestId: string | null;
  readonly errors?: ReadonlyArray<{ path?: string; code?: string; message: string }>;
}

/**
 * Short human-readable summary for the RFC 7807 `title` field. Used by
 * the live bootstrap handler AND the per-domain test stubs so they stay
 * in lockstep on the wire shape.
 */
export function rfc7807TitleForStatus(status: number): string {
  if (status === 400) return "Validation failed";
  if (status === 401) return "Authentication required";
  if (status === 403) return "Permission denied";
  if (status === 404) return "Resource not found";
  if (status === 409) return "Resource conflict";
  if (status === 413) return "Payload too large";
  if (status === 415) return "Unsupported media type";
  if (status === 429) return "Rate limited";
  if (status >= 500 && status < 600) return "Server error";
  return "Request failed";
}

/**
 * Build the canonical RFC 7807 body from an `AppError`-like + the path
 * the request hit. Shared between bootstrap.ts (live) and per-domain
 * test stubs so wire shape never drifts between dev and CI.
 */
export function buildProblemJsonBody(input: {
  statusCode: number;
  code: string;
  message: string;
  instance: string;
  requestId: string | null;
}): ProblemJsonBody {
  return {
    type: `https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#${input.code}`,
    title: rfc7807TitleForStatus(input.statusCode),
    status: input.statusCode,
    detail: input.message,
    instance: input.instance,
    code: input.code,
    requestId: input.requestId,
  };
}
