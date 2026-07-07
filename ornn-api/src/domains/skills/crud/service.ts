/**
 * Skill CRUD service. Uses chrono-storage via StorageClient (bucket-based API).
 * Replaces direct S3 access. Uses storageKey instead of s3Url.
 * @module domains/skills/crud/service
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { SkillRepository, UpdateSkillData } from "./repository";
import type { SkillVersionRepository } from "./skillVersionRepository";
import type { IStorageClient } from "../../../clients/storageClient";
import type { SkillDocument, SkillMetadata, SkillDetailResponse, SkillVersionDocument, SkillSource } from "../../../shared/types/index";
import { AppError } from "../../../shared/types/index";
import { fetchSkillFromGitHub, parseGithubUrl, type GitHubPullInput } from "./utils/githubPull";
import {
  runSourceDriftCheck,
  pickSourceSyncToken,
  SYSTEM_SYNC_ACTOR,
  type SourceDriftResult,
  type AutoPublishOutcome,
} from "./sourceDrift";
import type { SourceSyncSection } from "../../settings/sections/sourceSync";
import { computeVersionDiff, type VersionDiffResult } from "./utils/versionDiff";
import { isReservedVerb } from "../../../shared/reservedVerbs";
import { canReadSkill, isMemberOfOrg, SYSTEM_ACTOR, type ActorContext } from "./authorize";
import { effectiveGrants, normalizeGrants, resolvePermissionGrants, type PermissionsPayload } from "./grants";
import {
  resolveClosure,
  type LoadVersion,
  type ResolvedVersion,
  type ClosureNode,
} from "../closure/resolver";

/**
 * Convert the stored hex `skillHash` into npm-style Subresource Integrity
 * (#461): `sha256-<base64-of-raw-digest>`. Equivalent to
 * `package-lock.json`'s `integrity:` field — clients verify a downloaded
 * package byte-for-byte before installing.
 */
function hexToIntegrity(hex: string): string {
  if (!hex || hex.length === 0) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return `sha256-${Buffer.from(bytes).toString("base64")}`;
}
import {
  validateSkillFrontmatter,
  SKILL_NAME_REGEX,
  SKILL_NAME_MAX,
  SKILL_VERSION_REGEX,
  DEPENDS_ON_REF_REGEX,
} from "../../../shared/schemas/skillFrontmatter";
import { resolveZipRoot } from "../../../shared/utils/zip";
import { enforceZipLimits, type ZipLimitsConfig } from "../../../shared/utils/zipLimits";
import { parseVersion, isGreater } from "./version";
import { diffSkillInterface, type InterfaceChange } from "./interfaceDiff";
import type { AnalyticsEmitter } from "../../../infra/analytics";
import type { IAgentSealScanner } from "../../../infra/agentseal";
import { parse as parseYaml } from "yaml";
import JSZip from "jszip";
import { createLogger } from "../../../shared/logger";
const logger = createLogger("skillCrudService");

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Versioned storage key layout: `skills/{guid}/{version}.zip`.
 * Keeps every published version as its own immutable blob.
 * Legacy, pre-migration skills may still live at `skills/{guid}.zip`; the
 * migration script preserves that key when backfilling a version row.
 */
function buildVersionedStorageKey(guid: string, version: string): string {
  return `skills/${guid}/${version}.zip`;
}

function formatInterfaceChanges(changes: InterfaceChange[]): string {
  return changes.map((c) => `${c.field} ${c.kind} ${c.detail}`).join("; ");
}

/**
 * Dist-tag name rule (#463): npm-style — lowercase ASCII, leading
 * letter, optional hyphens, max 50 chars. The leading-letter rule
 * stops tags from looking like version numbers (`1`, `0.5`).
 */
const DIST_TAG_NAME_RE = /^[a-z][a-z0-9-]{0,49}$/;

export function isValidTagName(tag: string): boolean {
  return typeof tag === "string" && DIST_TAG_NAME_RE.test(tag);
}

/**
 * Map the `version` query-param value to the concrete version the
 * caller wants. Recognized forms (#463):
 *   - undefined / empty → undefined (caller wants latest, handled upstream)
 *   - `@<tag>` → resolved via `skill.distTags`, or fallback to
 *     `latestVersion` when `tag === "latest"` and the skill predates
 *     the dist-tags feature
 *   - everything else → returned verbatim (literal `<major>.<minor>`)
 *
 * Returning undefined here means "caller didn't specify"; returning a
 * concrete string means "use exactly this version". A missing tag
 * resolves to `null` and we surface it as an explicit 404 from the
 * caller so the user sees `Tag 'beta' not found` rather than `Version
 * '@beta' not found` — the latter would be confusing.
 */
export function resolveDistTag(skill: SkillDocument, version: string): string | undefined {
  if (version.length === 0) return undefined;
  if (!version.startsWith("@")) return version;
  const tag = version.slice(1);
  if (!tag) {
    throw AppError.badRequest("invalid_dist_tag", "Dist-tag name is empty");
  }
  const resolved = skill.distTags?.[tag];
  if (resolved) return resolved;
  // Legacy compatibility: `@latest` on a pre-#463 skill (no distTags
  // field) falls back to the cached `latestVersion` pointer.
  if (tag === "latest") return skill.latestVersion;
  throw AppError.notFound(
    "skill_version_not_found",
    `Dist-tag '${tag}' is not set for skill '${skill.name}'`,
  );
}

/**
 * Narrow settings surface the source-drift path needs (#1175). Decoupled
 * from the full SettingsService so tests stub just this one method — same
 * pattern as `MirrorSettingsReader`.
 */
export interface SourceSyncSettingsReader {
  getSourceSync(): Promise<SourceSyncSection>;
}

export interface SkillServiceDeps {
  skillRepo: SkillRepository;
  skillVersionRepo: SkillVersionRepository;
  storageClient: IStorageClient;
  /**
   * Resolves the active storage bucket from admin settings (services
   * section). Awaited at every storage I/O site so a bucket rename
   * lands without a redeploy.
   */
  storageBucketResolver: () => Promise<string>;
  /**
   * PostHog emitter for `api.skill.published` (#252). Optional — when
   * absent the publish path skips the emit. Always async/safe; failures
   * never bubble up.
   */
  analyticsEmitter?: AnalyticsEmitter;
  /**
   * AgentSeal scanner (#253). Invoked on first-create and every publish.
   * Result is persisted on the version doc; failures are warn-only and
   * never block the publish path.
   */
  agentsealScanner?: IAgentSealScanner;

  // ---- Zip-bomb defense caps (#632) — env-overridable. ----
  // Threaded down from `loadConfig()` so the ingestion chokepoint
  // (`createSkill` / `updateSkill`, which every upload + GitHub
  // pull/refresh funnels through) enforces the same caps the route layer
  // used to. All optional (exactOptionalPropertyTypes): when omitted the
  // guard falls back to the baked-in defaults in `zipLimits.ts`.
  maxPackageUncompressedBytes?: number;
  maxEntryUncompressedBytes?: number;
  maxPackageFileCount?: number;
  maxCompressionRatio?: number;

  /**
   * Source-sync settings reader (#1175). Optional — when absent the GitHub
   * source reads/drift checks fall back to the env token (below) or run
   * anonymously. Production bootstrap passes the SettingsService.
   */
  sourceSyncSettings?: SourceSyncSettingsReader;
  /**
   * Env-provided GitHub token fallback (`ORNN_SOURCE_SYNC_GITHUB_TOKEN`),
   * used only when the settings `githubToken` is empty. Lets ops supply the
   * credential without the admin UI. Never hardcoded, never logged.
   */
  sourceSyncGithubTokenFallback?: string;
}

export class SkillService {
  private readonly skillRepo: SkillRepository;
  private readonly skillVersionRepo: SkillVersionRepository;
  private readonly storageClient: IStorageClient;
  private readonly storageBucketResolver: () => Promise<string>;
  // exactOptionalPropertyTypes (#657): widen to `T | undefined`.
  private readonly analyticsEmitter: AnalyticsEmitter | undefined;
  private readonly agentsealScanner: IAgentSealScanner | undefined;
  // Zip-bomb caps (#632) — undefined means "use zipLimits.ts defaults".
  private readonly maxPackageUncompressedBytes: number | undefined;
  private readonly maxEntryUncompressedBytes: number | undefined;
  private readonly maxPackageFileCount: number | undefined;
  private readonly maxCompressionRatio: number | undefined;
  private readonly sourceSyncSettings: SourceSyncSettingsReader | undefined;
  private readonly sourceSyncGithubTokenFallback: string | undefined;

  constructor(deps: SkillServiceDeps) {
    this.skillRepo = deps.skillRepo;
    this.skillVersionRepo = deps.skillVersionRepo;
    this.storageClient = deps.storageClient;
    this.storageBucketResolver = deps.storageBucketResolver;
    this.analyticsEmitter = deps.analyticsEmitter;
    this.agentsealScanner = deps.agentsealScanner;
    this.maxPackageUncompressedBytes = deps.maxPackageUncompressedBytes;
    this.maxEntryUncompressedBytes = deps.maxEntryUncompressedBytes;
    this.maxPackageFileCount = deps.maxPackageFileCount;
    this.maxCompressionRatio = deps.maxCompressionRatio;
    this.sourceSyncSettings = deps.sourceSyncSettings;
    this.sourceSyncGithubTokenFallback = deps.sourceSyncGithubTokenFallback;
  }

  /**
   * Resolve the GitHub token for authenticated source reads (#1175): the
   * admin-set settings value wins; the env fallback is next; empty ⇒ run
   * anonymous (rate-limited). Trimmed so stray whitespace never becomes a
   * bogus `Authorization` header. NEVER logged.
   */
  private async resolveSourceSyncToken(): Promise<string> {
    const settingsToken = (await this.sourceSyncSettings?.getSourceSync())?.githubToken;
    return pickSourceSyncToken(settingsToken, this.sourceSyncGithubTokenFallback);
  }

  /**
   * Read-only drift check for a GitHub-sourced skill (#1175). Probes the
   * upstream HEAD via the cheap `git/ref` endpoint, compares it to the
   * last-synced commit, and persists the verdict on `source`. NEVER
   * re-pulls or publishes — the scheduler (#1176) and auto-publish (#1177)
   * consume the state this writes.
   */
  async checkSourceDrift(guid: string): Promise<SourceDriftResult> {
    const token = await this.resolveSourceSyncToken();
    return runSourceDriftCheck({ skillRepo: this.skillRepo }, guid, token);
  }

  /**
   * Unattended auto-publish of a drifted GitHub-sourced skill (#1177). Called
   * by the drift scheduler when `sourceSync.autoPublish` is on. Re-pulls the
   * upstream and publishes a new version under the system source-sync actor,
   * running the SAME validation the manual refresh runs.
   *
   * Never throws for known outcomes — returns a typed {@link AutoPublishOutcome}
   * the caller maps to a notification + telemetry:
   *  - `published`           — a new version shipped (from → to).
   *  - `changed_unversioned` — upstream changed but SKILL.md version not bumped;
   *    the immutable current version is left untouched (updateSkill's
   *    VERSION_NOT_INCREMENTED guard fires BEFORE any storage write).
   *  - `validation_failed`   — the pulled package was rejected by the publish
   *    rules (validation / breaking-change / deps); nothing was written.
   *  - `skipped`             — no github source, not drifted, or already synced
   *    (idempotency guard against a concurrent pod).
   *  - `error`               — a mechanical/transient failure; drift state is
   *    left `drifted` so the next tick retries. Never publishes bad content.
   */
  async autoPublishFromSource(guid: string): Promise<AutoPublishOutcome> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing || existing.source?.type !== "github") {
      return { status: "skipped", reason: "no_github_source" };
    }
    const source = existing.source;
    if (source.driftState !== "drifted") {
      return { status: "skipped", reason: `not_drifted:${source.driftState ?? "unknown"}` };
    }
    // Idempotency: a concurrent pod may have already published this HEAD.
    if (source.upstreamHeadSha && source.upstreamHeadSha === source.lastSyncedCommit) {
      return { status: "skipped", reason: "already_synced" };
    }

    const fromVersion = existing.latestVersion;
    const now = new Date();
    try {
      // skipValidation deliberately unset — the auto path MUST validate.
      const detail = await this.refreshSkillFromSource(guid, SYSTEM_SYNC_ACTOR.userId, {
        userEmail: SYSTEM_SYNC_ACTOR.userEmail,
        userDisplayName: SYSTEM_SYNC_ACTOR.userDisplayName,
      });
      // refreshSkillFromSource rewrites `source` without the drift fields, so
      // stamp the resolved verdict back on.
      await this.skillRepo.updateSourceDriftState(guid, {
        driftState: "in_sync",
        lastCheckedAt: now,
      });
      logger.info(
        { guid, fromVersion, toVersion: detail.version, actor: SYSTEM_SYNC_ACTOR.userId },
        "auto-sync published new version",
      );
      return { status: "published", fromVersion, toVersion: detail.version };
    } catch (err) {
      if (err instanceof AppError && err.code === "VERSION_NOT_INCREMENTED") {
        await this.skillRepo.updateSourceDriftState(guid, {
          driftState: "changed_unversioned",
          lastCheckedAt: now,
        });
        logger.warn({ guid }, "auto-sync skipped: upstream changed but SKILL.md version not bumped");
        return { status: "changed_unversioned" };
      }
      if (err instanceof AppError) {
        // A deliberate publish-rule rejection (validation / breaking change /
        // deps). The upstream content is unacceptable — never publish it. The
        // guard fired before any storage write, so nothing partial landed.
        await this.skillRepo.updateSourceDriftState(guid, {
          driftState: "broken",
          lastCheckedAt: now,
        });
        logger.warn({ guid, code: err.code }, "auto-sync refused: pulled package failed publish rules");
        return { status: "validation_failed", reason: `${err.code}: ${err.message}` };
      }
      // Mechanical/transient (network, rate limit, malformed fetch) — leave
      // driftState `drifted` so the next tick retries. Never mislabel or publish.
      logger.error(
        { guid, err: err instanceof Error ? err.message : String(err) },
        "auto-sync errored unexpectedly — leaving drifted for retry",
      );
      return { status: "error", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Map the configured caps onto the `ZipLimitsConfig` shape consumed by
   * `enforceZipLimits`. Any cap left undefined falls through to the
   * baked-in default inside `zipLimits.ts` (50 MiB / 25 MiB / 1000 / 100×).
   *
   * exactOptionalPropertyTypes (#657): build the object conditionally so
   * we never assign `undefined` to an optional field — `enforceZipLimits`
   * already `?? DEFAULT`s any missing key.
   */
  private zipLimitsConfig(): ZipLimitsConfig {
    const cfg: ZipLimitsConfig = {};
    if (this.maxPackageUncompressedBytes !== undefined) {
      cfg.maxTotalUncompressedBytes = this.maxPackageUncompressedBytes;
    }
    if (this.maxEntryUncompressedBytes !== undefined) {
      cfg.maxEntryUncompressedBytes = this.maxEntryUncompressedBytes;
    }
    if (this.maxPackageFileCount !== undefined) {
      cfg.maxFileCount = this.maxPackageFileCount;
    }
    if (this.maxCompressionRatio !== undefined) {
      cfg.maxCompressionRatio = this.maxCompressionRatio;
    }
    return cfg;
  }

  /**
   * Public zip-bomb guard for standalone read paths that don't flow
   * through `createSkill`/`updateSkill` — today only the
   * `POST /skill-format/validate` endpoint, which parses a ZIP without
   * persisting it. Delegates to {@link enforceZipLimits} with the same
   * env-driven caps the ingestion chokepoint uses, so the validate path
   * can't be slowed down by a pathological ZIP that the publish path
   * would reject. Throws `AppError.payloadTooLarge` (413) on any
   * violation; `invalid_zip` (400) on an unparseable buffer.
   */
  async enforceZipLimits(zipBuffer: Uint8Array): Promise<void> {
    await enforceZipLimits(zipBuffer, this.zipLimitsConfig());
  }

  async createSkill(
    zipBuffer: Uint8Array,
    userId: string,
    // Optionals accept `| undefined` so route layers passing
    // Zod-inferred values fit under exactOptionalPropertyTypes (#657).
    options?: {
      skipValidation?: boolean | undefined;
      userEmail?: string | undefined;
      userDisplayName?: string | undefined;
      /** Origin metadata stamped on the skill doc when created from an external pull. */
      source?: import("../../../shared/types/index").SkillSource | undefined;
    },
  ): Promise<{ guid: string }> {
    // 0. Zip-bomb defense (#632) — the ingestion chokepoint. EVERY upload
    //    AND every GitHub pull (`createSkillFromGitHub` → here) funnels
    //    through this method, so enforcing the caps here closes the
    //    route-layer bypass. Runs REGARDLESS of skipValidation: it's a
    //    DoS guard, not format validation, so an "import as-is" toggle
    //    must not disarm it. Walks the central directory without
    //    extracting; throws 413 before any storage upload / AgentSeal
    //    subprocess. We never log payload bytes.
    await enforceZipLimits(zipBuffer, this.zipLimitsConfig());

    // 1. Validate ZIP format rules
    if (!options?.skipValidation) {
      const violations = await this.validateZipFormat(zipBuffer);
      if (violations.length > 0) {
        throw AppError.badRequest(
          "validation_failed",
          violations.map((v) => `[${v.rule}] ${v.message}`).join("; "),
        );
      }
    }

    // 2. Parse SKILL.md from ZIP
    // #529 — `skipValidation` extends to the frontmatter Zod check so
    // third-party packages that don't conform to Ornn's schema (e.g.
    // imported from outside the platform via "Import from GitHub"
    // with skip-validation toggled) can still land. YAML syntax
    // errors still fail loudly — we can't import what we can't parse.
    const { name, description, version, license, compatibility, metadata, releaseNotes } = await this.extractSkillInfo(zipBuffer, !!options?.skipValidation);
    const parsedVersion = parseVersion(version);

    // 3a. Reject reserved-verb names — would collide with `/v1/skills/{verb}`
    //     action paths and make the skill unreachable via the canonical read.
    if (isReservedVerb("skill", name)) {
      throw AppError.badRequest(
        "reserved_name",
        `Skill name '${name}' is reserved — pick a different name`,
      );
    }

    // 3b. Check name uniqueness
    const existing = await this.skillRepo.findByName(name);
    if (existing) {
      throw AppError.conflict("skill_name_exists", `Skill '${name}' already exists`);
    }

    // 3c. Skill-dependency validation (#968). Resolve the closure of the
    //     declared `depends-on` refs BEFORE any storage write so a missing
    //     dependency / cycle / version conflict fails the publish early.
    //     No-op when the skill declares no dependencies.
    await this.validatePublishDependencies(metadata, { name, version });

    // 4. Generate GUID and hash
    const guid = randomUUID();
    const skillHash = createHash("sha256").update(zipBuffer).digest("hex");

    // 5. Upload ZIP to chrono-storage under a versioned key (versions are immutable).
    const storageKey = buildVersionedStorageKey(guid, version);
    await this.storageClient.upload((await this.storageBucketResolver()), storageKey, zipBuffer, "application/zip");
    logger.info({ guid, storageKey, version }, "Skill package uploaded to storage");

    // 6. Save the skill document.
    await this.skillRepo.create({
      guid,
      name,
      description,
      license: license ?? undefined,
      compatibility: compatibility ?? undefined,
      metadata,
      skillHash,
      storageKey,
      createdBy: userId,
      createdByEmail: options?.userEmail,
      createdByDisplayName: options?.userDisplayName,
      isPrivate: true,
      latestVersion: version,
      source: options?.source,
    });

    // 7. Record the initial version row.
    await this.skillVersionRepo.create({
      skillGuid: guid,
      version,
      majorVersion: parsedVersion.major,
      minorVersion: parsedVersion.minor,
      storageKey,
      skillHash,
      metadata,
      license,
      compatibility,
      createdBy: userId,
      createdByEmail: options?.userEmail,
      createdByDisplayName: options?.userDisplayName,
      releaseNotes,
    });

    // Seed `distTags.latest` so the auto-managed tag exists from the
    // first publish (#463). Custom tags (`stable`, `beta`, ...) are
    // owner-managed via the `/dist-tags/:tag` routes.
    await this.skillRepo.setDistTag(guid, "latest", version);

    // 8. Fire-and-forget product-analytics + AgentSeal trust scan. Both are
    //    deliberately not awaited so a slow PostHog backend or AgentSeal
    //    subprocess can't block the response. Failures inside either path
    //    are caught and logged at the dependency layer.
    this.analyticsEmitter?.trackSkillPublished({
      userId,
      skillId: guid,
      skillName: name,
      skillVersion: version,
      isNewSkill: true,
    });
    void this.runAgentsealScan(guid, version, zipBuffer);

    return { guid };
  }

  /**
   * Read a skill. Without `version` returns the latest (the skill doc's
   * cached pointer). With `version`, reads from the `skill_versions` collection
   * and overlays that version's storageKey / metadata / hash on the identity
   * fields from the skill doc.
   *
   * Dist-tag resolution (#463): when `version` starts with `@`, the
   * remainder is looked up in `skill.distTags`. Failed lookup is a 404
   * (`skill_version_not_found`) — same error as a missing literal
   * version, since from the caller's perspective both mean "no such
   * version".
   */
  async getSkill(idOrName: string, version?: string): Promise<SkillDetailResponse> {
    const skill = await this.findSkillByIdOrName(idOrName);
    const resolvedVersion = version === undefined ? undefined : resolveDistTag(skill, version);
    if (resolvedVersion !== undefined) {
      // Validate format early so clients get a clear 400, not a 404.
      parseVersion(resolvedVersion);
      const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, resolvedVersion);
      if (!versionDoc) {
        throw AppError.notFound(
          "skill_version_not_found",
          `Version '${resolvedVersion}' not found for skill '${skill.name}'`,
        );
      }
      return this.buildDetailResponse(skill, versionDoc);
    }
    return this.buildDetailResponse(skill);
  }

  /**
   * Read the dist-tags map for a skill (#463). Read-only — no auth
   * check here; the route layer applies the same visibility rules as
   * the read endpoint (anonymous can see public, etc.).
   *
   * Always returns `latest` (synthesized from `latestVersion` for
   * legacy skills predating #463 that never had the field set).
   */
  async getDistTags(idOrName: string): Promise<Record<string, string>> {
    const skill = await this.findSkillByIdOrName(idOrName);
    const tags: Record<string, string> = { ...(skill.distTags ?? {}) };
    if (!tags.latest) {
      tags.latest = skill.latestVersion;
    }
    return tags;
  }

  /**
   * Set a dist-tag → version mapping (#463). Owner / platform-admin
   * only — the route layer enforces that. `latest` is auto-managed by
   * the publish path and cannot be set via this endpoint.
   *
   * The version must already exist on the `skill_versions` collection;
   * otherwise we'd be creating a dangling tag.
   */
  async setDistTag(
    idOrName: string,
    tag: string,
    version: string,
  ): Promise<Record<string, string>> {
    if (!isValidTagName(tag)) {
      throw AppError.badRequest(
        "invalid_dist_tag",
        `Dist-tag '${tag}' is invalid — must match /^[a-z][a-z0-9-]{0,49}$/`,
      );
    }
    if (tag === "latest") {
      throw AppError.badRequest(
        "dist_tag_immutable",
        "`latest` is auto-managed on publish and cannot be set directly",
      );
    }
    // Format-validate the version before hitting Mongo.
    parseVersion(version);
    const skill = await this.findSkillByIdOrName(idOrName);
    const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, version);
    if (!versionDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${version}' not found for skill '${skill.name}'`,
      );
    }
    await this.skillRepo.setDistTag(skill.guid, tag, version);
    return this.getDistTags(skill.guid);
  }

  /**
   * Remove a dist-tag (#463). `latest` is refused with
   * `dist_tag_immutable` to preserve the invariant that every skill
   * has a `latest` pointer.
   */
  async deleteDistTag(idOrName: string, tag: string): Promise<Record<string, string>> {
    if (tag === "latest") {
      throw AppError.badRequest(
        "dist_tag_immutable",
        "`latest` is auto-managed and cannot be deleted",
      );
    }
    if (!isValidTagName(tag)) {
      throw AppError.badRequest(
        "invalid_dist_tag",
        `Dist-tag '${tag}' is invalid — must match /^[a-z][a-z0-9-]{0,49}$/`,
      );
    }
    const skill = await this.findSkillByIdOrName(idOrName);
    await this.skillRepo.deleteDistTag(skill.guid, tag);
    return this.getDistTags(skill.guid);
  }

  /**
   * List every published version for a skill, newest first. Includes the
   * deprecation flag + note so consumers can render a warning without another
   * round-trip.
   */
  async listSkillVersions(idOrName: string): Promise<Array<{
    version: string;
    skillHash: string;
    /**
     * npm-style Subresource Integrity (#461). `sha256-<base64(skillHash)>`.
     * Clients verify a downloaded package matches this value byte-for-byte
     * before installing. Equivalent in spirit to npm's `integrity:` field
     * on `package-lock.json` and PyPI's `sha256_digest` per file.
     */
    integrity: string;
    createdBy: string;
    // exactOptionalPropertyTypes (#657)
    createdByEmail?: string | undefined;
    createdByDisplayName?: string | undefined;
    createdOn: string;
    isDeprecated: boolean;
    deprecationNote: string | null;
    releaseNotes: string | null;
  }>> {
    const skill = await this.findSkillByIdOrName(idOrName);
    const versions = await this.skillVersionRepo.listBySkill(skill.guid);
    return versions.map((v) => ({
      version: v.version,
      skillHash: v.skillHash,
      integrity: hexToIntegrity(v.skillHash),
      createdBy: v.createdBy,
      createdByEmail: v.createdByEmail,
      createdByDisplayName: v.createdByDisplayName,
      createdOn: v.createdOn instanceof Date ? v.createdOn.toISOString() : String(v.createdOn),
      isDeprecated: v.isDeprecated === true,
      deprecationNote: v.deprecationNote ?? null,
      releaseNotes: v.releaseNotes ?? null,
    }));
  }

  /**
   * Mutate the deprecation flag on a single version. Caller is responsible
   * for the owner/admin auth gate — we only validate the target exists.
   *
   * Returns a lightweight view; callers that need the full version doc can
   * subsequently call `getSkill(idOrName, version)`.
   */
  async setVersionDeprecation(
    idOrName: string,
    version: string,
    isDeprecated: boolean,
    deprecationNote: string | null | undefined,
  ): Promise<{
    skillGuid: string;
    skillName: string;
    version: string;
    isDeprecated: boolean;
    deprecationNote: string | null;
  }> {
    // Validate version format up-front so clients get 400 rather than 404.
    parseVersion(version);
    const skill = await this.findSkillByIdOrName(idOrName);
    const updated = await this.skillVersionRepo.setDeprecation(
      skill.guid,
      version,
      isDeprecated,
      deprecationNote ?? null,
    );
    return {
      skillGuid: skill.guid,
      skillName: skill.name,
      version: updated.version,
      isDeprecated: updated.isDeprecated === true,
      deprecationNote: updated.deprecationNote ?? null,
    };
  }

  private async findSkillByIdOrName(idOrName: string): Promise<SkillDocument> {
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) {
      skill = await this.skillRepo.findByName(idOrName);
    }
    if (!skill) {
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }
    return skill;
  }

  /**
   * Replace the per-skill permission model in a single atomic write. The
   * route layer has already enforced the write gate (author/admin); the
   * service just validates the inputs and persists them.
   *
   * Ownership (`createdBy`) is left untouched — permissions don't
   * change who wrote the skill, they just widen who can read it.
   *
   * CWE-862 (#815): in addition to the route write gate, this method now
   * enforces that the caller may only share a skill into orgs they are a
   * member of — every `sharedWithOrgs` id is intersected against the
   * caller's memberships (platform admins exempt). Defense-in-depth: the
   * check lives here so any future caller of the service is covered, not
   * just the current route.
   */
  async setSkillPermissions(
    guid: string,
    userId: string,
    // Accept either the canonical typed `grants` or the legacy lists
    // (back-compat); both resolve to the same normalized grants (#1123).
    permissions: { isPrivate: boolean } & PermissionsPayload,
    actor: ActorContext,
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }

    // System-skill invariant: a skill tied to an admin NyxID service is
    // always public. Reject attempts to flip it back to private without
    // first untying — keeps the "system skill ⇒ visible to everyone"
    // mental model tight.
    if (existing.isSystemSkill === true && permissions.isPrivate === true) {
      throw AppError.badRequest(
        "SYSTEM_SKILL_MUST_BE_PUBLIC",
        "This skill is tied to an admin NyxID service and must remain public. Untie the service before making it private.",
      );
    }

    // Resolve to canonical normalized grants, then drop any self-reference:
    // the author always has implicit ADMIN, so a grant naming them is
    // redundant and noisy for downstream debugging.
    const grants = resolvePermissionGrants(permissions).filter(
      (g) => !(g.type === "user" && g.id === existing.createdBy),
    );
    const orgGrantIds = grants.filter((g) => g.type === "org").map((g) => g.id);

    // CWE-862 (#815): an owner may only share into orgs they belong to.
    // isMemberOfOrg is membership-only (does not consider platform admin), so
    // gate the whole check behind the admin bypass.
    if (!actor.isPlatformAdmin) {
      // #842: an unresolved org-membership lookup (forwarded token absent or
      // NyxID unreachable) leaves `memberships` empty for a non-membership
      // reason. Validating a share into orgs against that empty list would
      // wrongly 403 a legitimate member, so fail closed with a retryable 503
      // instead — but only when the caller actually asked to share into an
      // org. A public / user-only change (no org grants) needs no membership
      // data and proceeds even while the lookup is unresolved.
      if (orgGrantIds.length > 0 && !actor.membershipsResolved) {
        logger.warn(
          { guid, userId },
          "Org membership unresolved; cannot validate share into orgs (#842)",
        );
        throw AppError.serviceUnavailable(
          "org_membership_unavailable",
          "Could not verify your organization memberships right now. Retry shortly.",
        );
      }
      const nonMember = orgGrantIds.filter((orgId) => !isMemberOfOrg(actor, orgId));
      if (nonMember.length > 0) {
        logger.warn({ guid, userId, nonMember }, "Rejected skill share into non-member org(s) (#815)");
        throw AppError.forbidden(
          "not_org_member",
          `Cannot share skill into org(s) you are not a member of: ${nonMember.join(", ")}`,
        );
      }
    }

    const updated = await this.skillRepo.update(guid, {
      isPrivate: permissions.isPrivate,
      grants,
      updatedBy: userId,
    });
    return this.buildDetailResponse(updated);
  }

  /**
   * Transfer skill ownership to another user (#1123).
   *
   * The caller (route) has already gated `canManageSkill` (owner / platform
   * admin) and resolved the target's identity from the user directory. Here
   * we own the data mutation: reassign `createdBy`, refresh the cached owner
   * labels, and recompute the ACL so the prior owner keeps READ access while
   * the new owner is dropped from any grant (they now hold implicit ADMIN).
   *
   * Rejects a no-op transfer (target already owns it) with `ownership_conflict`.
   */
  async transferSkillOwnership(
    guid: string,
    newOwner: { userId: string; email?: string | undefined; displayName?: string | undefined },
    actor: ActorContext,
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }
    if (newOwner.userId === existing.createdBy) {
      throw AppError.conflict("ownership_conflict", "This user already owns the skill");
    }

    // New ACL: keep every existing grant EXCEPT one naming the new owner
    // (they become owner → implicit ADMIN), and append the prior owner as a
    // READ grantee so they retain visibility but not edit/admin rights.
    const priorOwner = existing.createdBy;
    const grants = normalizeGrants([
      ...effectiveGrants(existing).filter(
        (g) => !(g.type === "user" && g.id === newOwner.userId),
      ),
      { type: "user", id: priorOwner, level: "read" },
    ]);

    const updated = await this.skillRepo.transferOwnership(guid, {
      newOwnerId: newOwner.userId,
      newOwnerEmail: newOwner.email ?? null,
      newOwnerDisplayName: newOwner.displayName ?? null,
      grants,
      updatedBy: actor.userId,
    });
    logger.info(
      { guid, priorOwner, newOwnerId: newOwner.userId, by: actor.userId },
      "Skill ownership transferred",
    );
    return this.buildDetailResponse(updated);
  }

  async updateSkill(
    guid: string,
    userId: string,
    // exactOptionalPropertyTypes (#657): allow `T | undefined` on all
    // optionals so route layers can pass Zod-inferred values directly.
    options: {
      zipBuffer?: Uint8Array | undefined;
      isPrivate?: boolean | undefined;
      skipValidation?: boolean | undefined;
      userEmail?: string | undefined;
      userDisplayName?: string | undefined;
      /** Refresh-from-source path stamps this so lastSyncedAt/Commit move forward. */
      source?: import("../../../shared/types/index").SkillSource | undefined;
    },
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }

    // System-skill invariant — same as setSkillPermissions. Block
    // `PUT /skills/:id` body that flips a system skill private.
    if (
      existing.isSystemSkill === true &&
      options.isPrivate === true
    ) {
      throw AppError.badRequest(
        "SYSTEM_SKILL_MUST_BE_PUBLIC",
        "This skill is tied to an admin NyxID service and must remain public. Untie the service before making it private.",
      );
    }

    const updateData: UpdateSkillData = { updatedBy: userId };

    if (options.zipBuffer) {
      // Zip-bomb defense (#632) — same chokepoint guard as createSkill.
      // The GitHub refresh path (`refreshSkillFromSource` → here) and
      // admin re-upload both land here, so the route-layer bypass is
      // closed for updates too. Runs REGARDLESS of skipValidation
      // (DoS guard, not format validation), ahead of storage upload /
      // AgentSeal. No payload bytes are logged.
      await enforceZipLimits(options.zipBuffer, this.zipLimitsConfig());

      if (!options.skipValidation) {
        const violations = await this.validateZipFormat(options.zipBuffer);
        if (violations.length > 0) {
          throw AppError.badRequest(
            "validation_failed",
            violations.map((v) => `[${v.rule}] ${v.message}`).join("; "),
          );
        }
      }

      // #529 — same skipValidation extension as createSkill above so
      // `PUT /skills/:id` (replace-package on an existing skill, used by
      // GitHub refresh + admin re-upload) honours the flag too.
      const { name, description, version, license, compatibility, metadata, releaseNotes } = await this.extractSkillInfo(options.zipBuffer, !!options.skipValidation);
      const parsedNewVersion = parseVersion(version);

      // Enforce strictly-incrementing version on every package update.
      const currentLatest = await this.skillVersionRepo.findLatestBySkill(guid);
      if (currentLatest) {
        const parsedCurrent = parseVersion(currentLatest.version);
        if (!isGreater(parsedNewVersion, parsedCurrent)) {
          throw AppError.conflict(
            "VERSION_NOT_INCREMENTED",
            `New version '${version}' must be strictly greater than the current latest '${currentLatest.version}'. Bump the version in SKILL.md.`,
          );
        }
        // Breaking-change check: any interface diff requires a major bump.
        const changes = diffSkillInterface(currentLatest.metadata, metadata);
        if (changes.length > 0 && parsedNewVersion.major === parsedCurrent.major) {
          throw AppError.conflict(
            "BREAKING_CHANGE_WITHOUT_MAJOR_BUMP",
            `Detected breaking interface change(s) between ${currentLatest.version} and ${version}. ` +
              `A major-version bump is required for: ${formatInterfaceChanges(changes)}. ` +
              `Either revert the change or bump the major version in SKILL.md.`,
          );
        }
      }

      // Skill-dependency validation (#968) — same gate as createSkill,
      // applied to the new version's declared deps before any storage
      // write. No-op when the version declares no dependencies.
      await this.validatePublishDependencies(metadata, { name, version });

      const skillHash = createHash("sha256").update(options.zipBuffer).digest("hex");

      // Upload under a new, versioned storage key — versions are immutable.
      const storageKey = buildVersionedStorageKey(guid, version);
      await this.storageClient.upload((await this.storageBucketResolver()), storageKey, options.zipBuffer, "application/zip");
      logger.info({ guid, storageKey, version }, "Skill package updated in storage");

      // Record the new version row.
      await this.skillVersionRepo.create({
        skillGuid: guid,
        version,
        majorVersion: parsedNewVersion.major,
        minorVersion: parsedNewVersion.minor,
        storageKey,
        skillHash,
        metadata,
        license,
        compatibility,
        createdBy: userId,
        createdByEmail: options.userEmail,
        createdByDisplayName: options.userDisplayName,
        releaseNotes,
      });

      // Fire-and-forget analytics + scan on every version publish.
      this.analyticsEmitter?.trackSkillPublished({
        userId,
        skillId: guid,
        skillName: name,
        skillVersion: version,
        isNewSkill: false,
      });
      void this.runAgentsealScan(guid, version, options.zipBuffer);

      Object.assign(updateData, {
        name,
        description,
        license,
        compatibility,
        metadata,
        skillHash,
        storageKey,
        latestVersion: version,
      });

      // Keep `distTags.latest` in lockstep with `latestVersion` on
      // every publish (#463). The two writes can briefly race the
      // doc-level `update` below, but readers tolerate a transient
      // mismatch (resolution falls back to `latestVersion` when the
      // tag isn't set) so we don't bother with a transaction.
      await this.skillRepo.setDistTag(guid, "latest", version);
    }

    if (options.isPrivate !== undefined) {
      updateData.isPrivate = options.isPrivate;
    }

    if (options.source !== undefined) {
      updateData.source = options.source;
    }

    const updated = await this.skillRepo.update(guid, updateData);
    return this.buildDetailResponse(updated);
  }

  /**
   * Pull a skill package from a public GitHub repo and publish it as a new
   * skill. Returns the created skill's GUID + the source manifest that was
   * stamped on the doc so callers can show "linked to X".
   *
   * Distinct from `createSkill` because the caller doesn't provide the ZIP —
   * this method builds it from the repo contents via
   * {@link fetchSkillFromGitHub} and then hands off to `createSkill` with
   * the source stamped.
   */
  async createSkillFromGitHub(
    input: GitHubPullInput,
    userId: string,
    // exactOptionalPropertyTypes (#657)
    options?: {
      userEmail?: string | undefined;
      userDisplayName?: string | undefined;
      skipValidation?: boolean | undefined;
    },
  ): Promise<{ guid: string; source: SkillSource }> {
    // Authenticate the pull when a token is configured (#1175) — lifts the
    // 60/hr anonymous ceiling. An explicit input token (tests) wins.
    const token = await this.resolveSourceSyncToken();
    const pulled = await fetchSkillFromGitHub({ ...input, token: input.token ?? token });
    const source: SkillSource = {
      type: "github",
      repo: pulled.source.repo,
      ref: pulled.source.ref,
      path: pulled.source.path,
      lastSyncedAt: new Date(),
      lastSyncedCommit: pulled.resolvedCommitSha,
    };
    const { guid } = await this.createSkill(pulled.zipBuffer, userId, {
      skipValidation: options?.skipValidation,
      userEmail: options?.userEmail,
      userDisplayName: options?.userDisplayName,
      source,
    });
    return { guid, source };
  }

  /**
   * Re-pull the skill's stored GitHub source and publish the fetched package
   * as a new version. Fails if the skill has no `source` or the source is
   * not of type `github`.
   */
  async refreshSkillFromSource(
    guid: string,
    userId: string,
    // exactOptionalPropertyTypes (#657)
    options?: {
      userEmail?: string | undefined;
      userDisplayName?: string | undefined;
      skipValidation?: boolean | undefined;
    },
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }
    if (!existing.source || existing.source.type !== "github") {
      throw AppError.badRequest(
        "NO_SOURCE",
        "Skill has no linked GitHub source; use POST /api/v1/skills/pull to create a new linked skill",
      );
    }

    const pulled = await fetchSkillFromGitHub({
      repo: existing.source.repo,
      ref: existing.source.ref,
      path: existing.source.path,
      // Authenticated re-pull when a token is configured (#1175).
      token: await this.resolveSourceSyncToken(),
    });

    const newSource: SkillSource = {
      type: "github",
      repo: existing.source.repo,
      ref: existing.source.ref,
      path: existing.source.path,
      lastSyncedAt: new Date(),
      lastSyncedCommit: pulled.resolvedCommitSha,
    };

    return this.updateSkill(guid, userId, {
      zipBuffer: pulled.zipBuffer,
      skipValidation: options?.skipValidation,
      userEmail: options?.userEmail,
      userDisplayName: options?.userDisplayName,
      source: newSource,
    });
  }

  /**
   * Attach (or clear) a GitHub source pointer on an existing skill without
   * pulling. Lets a user link an originally-uploaded skill to its GitHub
   * source first and trigger the actual sync separately. Pass `null` to
   * unlink. The pointer is parsed from a GitHub URL (e.g.
   * `https://github.com/owner/repo/tree/<ref>/<path>`); `lastSyncedAt` /
   * `lastSyncedCommit` are intentionally absent until the first refresh.
   */
  async setSkillSource(
    guid: string,
    githubUrl: string | null,
    userId: string,
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }

    if (githubUrl === null) {
      await this.skillRepo.clearSource(guid, userId);
      return this.getSkill(guid);
    }

    let parsed: { repo: string; ref?: string | undefined; path?: string | undefined };
    try {
      parsed = parseGithubUrl(githubUrl);
    } catch (err) {
      throw AppError.badRequest(
        "invalid_github_url",
        err instanceof Error ? err.message : String(err),
      );
    }

    const newSource: SkillSource = {
      type: "github",
      repo: parsed.repo,
      ref: parsed.ref ?? "HEAD",
      path: parsed.path ?? "",
    };

    await this.skillRepo.update(guid, { source: newSource, updatedBy: userId });
    return this.getSkill(guid);
  }

  /**
   * Dry-run a refresh: pull the latest content from the skill's stored
   * GitHub source, compute a structured diff against the current latest
   * version, and return the diff without persisting anything. Drives the
   * "preview-then-confirm" UI flow on the detail-page advanced settings.
   *
   * Throws NO_SOURCE if the skill has no `source`. Throws PULL_FAILED with
   * a useful message if the upstream folder no longer exists / responds.
   */
  async previewRefreshFromSource(guid: string): Promise<{
    skill: { guid: string; name: string };
    source: SkillSource;
    pendingVersion: string;
    hasChanges: boolean;
    diff: VersionDiffResult;
  }> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }
    if (!existing.source || existing.source.type !== "github") {
      throw AppError.badRequest(
        "NO_SOURCE",
        "Skill has no linked GitHub source. Link one via PUT /api/v1/skills/:id/source first.",
      );
    }

    const pulled = await fetchSkillFromGitHub({
      repo: existing.source.repo,
      ref: existing.source.ref,
      path: existing.source.path,
    });

    const latestVersionDoc = await this.skillVersionRepo.findBySkillAndVersion(
      existing.guid,
      existing.latestVersion,
    );
    if (!latestVersionDoc) {
      throw AppError.internalError(
        "MISSING_VERSION",
        `Latest version '${existing.latestVersion}' has no version row`,
      );
    }
    const latestZip = await this.downloadPackage(latestVersionDoc.storageKey);
    const diff = await computeVersionDiff(latestZip, pulled.zipBuffer);

    const hasChanges =
      diff.files.added.length > 0 ||
      diff.files.removed.length > 0 ||
      diff.files.modified.length > 0;

    // Predict what the next version label will be. The actual bump
    // happens inside `updateSkill` from the SKILL.md frontmatter, which
    // is what the user already edited in the GitHub repo. We extract it
    // out of the pulled ZIP so the UI can show "you'll create v1.2".
    let pendingVersion = existing.latestVersion;
    try {
      // Preview is dry-run — we just want the predicted version label.
      // Pass skipValidation=true so a third-party-shaped SKILL.md
      // doesn't kill the preview; the real refresh path enforces the
      // caller's flag separately.
      const info = await this.extractSkillInfo(pulled.zipBuffer, true);
      pendingVersion = info.version;
    } catch (err) {
      // If the package can't be parsed (e.g. malformed frontmatter),
      // fall back to the existing latest. The actual sync will surface
      // the validation error properly. Log so we can spot a pulled
      // source repo that's been broken for a while (#579).
      logger.debug(
        { err, skillGuid: existing.guid },
        "preview-refresh: pulled ZIP parse failed, falling back to existing version",
      );
    }

    return {
      skill: { guid: existing.guid, name: existing.name },
      source: { ...existing.source, lastSyncedCommit: pulled.resolvedCommitSha },
      pendingVersion,
      hasChanges,
      diff,
    };
  }

  /**
   * Compute a structured diff between two versions of a skill.
   *
   * Downloads both version ZIPs from storage, extracts, and compares
   * file-level (added / removed / modified). For text files the diff
   * includes both sides' contents so the UI can render side-by-side or
   * any line-level diff it wants client-side.
   *
   * Throws NOT_FOUND when the skill or either version is unknown; throws
   * BAD_REQUEST when `from` and `to` are the same.
   */
  async diffVersions(
    idOrName: string,
    fromVersion: string,
    toVersion: string,
  ): Promise<{
    skill: { guid: string; name: string };
    from: { version: string; hash: string; createdOn: string; isDeprecated: boolean; releaseNotes: string | null };
    to: { version: string; hash: string; createdOn: string; isDeprecated: boolean; releaseNotes: string | null };
    diff: VersionDiffResult;
  }> {
    if (fromVersion === toVersion) {
      throw AppError.badRequest(
        "same_version",
        `'from' and 'to' refer to the same version '${fromVersion}'`,
      );
    }

    const skill = await this.findSkillByIdOrName(idOrName);

    parseVersion(fromVersion);
    parseVersion(toVersion);

    const [fromDoc, toDoc] = await Promise.all([
      this.skillVersionRepo.findBySkillAndVersion(skill.guid, fromVersion),
      this.skillVersionRepo.findBySkillAndVersion(skill.guid, toVersion),
    ]);
    if (!fromDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${fromVersion}' not found for skill '${skill.name}'`,
      );
    }
    if (!toDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${toVersion}' not found for skill '${skill.name}'`,
      );
    }

    const [fromZip, toZip] = await Promise.all([
      this.downloadPackage(fromDoc.storageKey),
      this.downloadPackage(toDoc.storageKey),
    ]);

    const diff = await computeVersionDiff(fromZip, toZip);

    return {
      skill: { guid: skill.guid, name: skill.name },
      from: {
        version: fromDoc.version,
        hash: fromDoc.skillHash,
        createdOn:
          fromDoc.createdOn instanceof Date
            ? fromDoc.createdOn.toISOString()
            : String(fromDoc.createdOn),
        isDeprecated: fromDoc.isDeprecated === true,
        releaseNotes: fromDoc.releaseNotes ?? null,
      },
      to: {
        version: toDoc.version,
        hash: toDoc.skillHash,
        createdOn:
          toDoc.createdOn instanceof Date
            ? toDoc.createdOn.toISOString()
            : String(toDoc.createdOn),
        isDeprecated: toDoc.isDeprecated === true,
        releaseNotes: toDoc.releaseNotes ?? null,
      },
      diff,
    };
  }

  private async downloadPackage(storageKey: string): Promise<Uint8Array> {
    // Proxied through chrono-bucket's streaming download (#1196). The storage
    // client throws on a non-2xx, which we surface as `package_download_failed`
    // to keep the existing error contract for internal byte-consumers.
    try {
      const { bytes } = await this.storageClient.downloadObject(
        (await this.storageBucketResolver()),
        storageKey,
      );
      return bytes;
    } catch (err) {
      throw AppError.internalError(
        "package_download_failed",
        `Failed to download package for key '${storageKey}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Delete a single non-latest version. Constraints:
   *   - The version must exist.
   *   - Cannot delete the **only** version on the skill — the caller should
   *     use `DELETE /skills/:id` for that.
   *   - Cannot delete the **current latest** version — moving the latest
   *     pointer is a write that touches the skill doc and isn't worth the
   *     complexity for a UI prune; ask the owner to publish a new latest
   *     first if they really need to remove what's currently latest.
   * Storage is best-effort cleaned up; failures are logged but do not roll
   * back the version row deletion.
   */
  async deleteVersion(idOrName: string, version: string): Promise<void> {
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) skill = await this.skillRepo.findByName(idOrName);
    if (!skill) {
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }
    const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, version);
    if (!versionDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${version}' not found for skill '${skill.name}'`,
      );
    }
    const allVersions = await this.skillVersionRepo.listBySkill(skill.guid);
    if (allVersions.length <= 1) {
      throw AppError.conflict(
        "SKILL_VERSION_LAST",
        `Cannot delete the only remaining version of '${skill.name}'. Delete the whole skill instead.`,
      );
    }
    // `listBySkill` returns versions sorted latest-first, so index 0 is the
    // current latest pointer. Forbid deleting it; owner must publish a
    // newer version first.
    const latest = allVersions[0]!;
    if (latest.version === version) {
      throw AppError.conflict(
        "SKILL_VERSION_LATEST",
        `Cannot delete v${version}: it is the current latest. Publish a newer version first, then delete v${version}.`,
      );
    }

    if (versionDoc.storageKey) {
      try {
        await this.storageClient.delete((await this.storageBucketResolver()), versionDoc.storageKey);
      } catch (err) {
        logger.warn(
          { skillGuid: skill.guid, version, storageKey: versionDoc.storageKey, err },
          "Best-effort version-storage cleanup failed",
        );
      }
    }
    await this.skillVersionRepo.deleteOne(skill.guid, version);
    logger.info({ skillGuid: skill.guid, version }, "Skill version deleted");
  }

  /**
   * Tie or untie a skill to a NyxID service. `serviceId === null` clears
   * the tie and leaves `isPrivate` alone. When tying to a service:
   *
   * - The route layer has already verified the caller can manage the
   *   skill (author or platform admin).
   * - This method validates that the caller is **eligible** to use the
   *   target service: either it's an admin/platform service
   *   (`visibility: "public"`) the caller can see, or it's a private
   *   service the caller created (`created_by === caller.userId`).
   * - If the target is an admin service, `isPrivate` is forced to
   *   `false` atomically. Personal ties leave `isPrivate` alone.
   *
   * The `lookupService` callback is passed in so the route layer can
   * inject a `NyxidServiceClient` without the service module taking a
   * direct dependency on it. Returns the refreshed `SkillDetailResponse`.
   */
  async tieToNyxidService(
    guid: string,
    serviceId: string | null,
    actor: { userId: string; isPlatformAdmin: boolean },
    lookupService: (id: string) => Promise<{
      id: string;
      slug: string;
      label: string;
      visibility: "public" | "private";
      createdBy: string;
    } | null>,
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }

    // Untie path — wipe all four cached fields, leave `isPrivate` alone.
    if (serviceId === null) {
      const updated = await this.skillRepo.setNyxidService(guid, {
        nyxidServiceId: null,
        nyxidServiceSlug: null,
        nyxidServiceLabel: null,
        isSystemSkill: false,
        updatedBy: actor.userId,
      });
      return this.buildDetailResponse(updated);
    }

    const service = await lookupService(serviceId);
    if (!service) {
      throw AppError.notFound(
        "NYXID_SERVICE_NOT_FOUND",
        `NyxID service '${serviceId}' not found or not visible to caller`,
      );
    }

    const isAdminService = service.visibility === "public";
    const isCallerOwnedPersonal =
      service.visibility === "private" && service.createdBy === actor.userId;

    // Eligibility: admin service (anyone can tie) OR own personal service.
    // Tying to *another user's* personal service is rejected even for
    // platform admins — the spec's #4 explicitly limits admins to "his
    // own personal nyxid service or any admin nyxid services".
    if (!isAdminService && !isCallerOwnedPersonal) {
      throw AppError.forbidden(
        "NYXID_SERVICE_NOT_ELIGIBLE",
        "Caller is not eligible to tie this skill to that NyxID service",
      );
    }

    const updated = await this.skillRepo.setNyxidService(guid, {
      nyxidServiceId: service.id,
      nyxidServiceSlug: service.slug,
      nyxidServiceLabel: service.label,
      isSystemSkill: isAdminService,
      // Admin tie forces public; personal tie leaves privacy alone.
      // exactOptionalPropertyTypes (#657): conditional spread so we
      // never pass `{ isPrivate: undefined }` to a contract that wants
      // `isPrivate?: boolean`.
      ...(isAdminService ? { isPrivate: false } : {}),
      updatedBy: actor.userId,
    });
    return this.buildDetailResponse(updated);
  }

  async deleteSkill(guid: string): Promise<void> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
    }

    // Collect every storage key to clean up: the current pointer on the skill
    // doc plus each versioned key in the skill_versions collection. Using a
    // Set dedupes the overlap between the two.
    const versions = await this.skillVersionRepo.listBySkill(guid);
    const storageKeys = new Set<string>();
    if (existing.storageKey) storageKeys.add(existing.storageKey);
    for (const v of versions) {
      if (v.storageKey) storageKeys.add(v.storageKey);
    }

    for (const key of storageKeys) {
      try {
        await this.storageClient.delete((await this.storageBucketResolver()), key);
      } catch (err) {
        logger.warn({ guid, storageKey: key, err }, "Best-effort storage cleanup failed");
      }
    }
    logger.info({ guid, storageKeys: Array.from(storageKeys) }, "Skill package(s) deleted from storage");

    // Cascade-delete version rows first, then the skill doc.
    await this.skillVersionRepo.deleteAllBySkill(guid);
    await this.skillRepo.hardDelete(guid);
  }

  /**
   * Return the full skill package as a JSON object with all file contents.
   * Used by playground to inject skill context, and by the SkillInstallCard
   * prompt's pull commands.
   *
   * #639 — accepts an optional `version` that may be a literal `<major>.
   * <minor>` or a dist-tag (#463). When provided, the response uses that
   * version's package (`storageKey` + `metadata` from `skill_versions`)
   * instead of the skill doc's "latest" storage key. Identity fields
   * (`name`) still come from the skill doc; `description` falls through
   * to the skill doc too because version docs don't carry one.
   *
   * When `version` is omitted the response is the latest package — same
   * as before.
   *
   * #806 — object-level authorization (BOLA / OWASP API1). `actor` is a
   * REQUIRED arg: the loaded skill doc is run through `canReadSkill`
   * before any storage download, so a private skill the actor cannot
   * read surfaces as `skill_not_found` instead of leaking its package
   * (incl. embedded secrets). Trusted server jobs pass `SYSTEM_ACTOR`.
   */
  async getSkillJson(
    idOrName: string,
    actor: ActorContext,
    version?: string,
  ): Promise<{
    name: string;
    description: string;
    version: string;
    metadata: Record<string, unknown>;
    files: Record<string, string>;
  }> {
    // 1. Get skill doc
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) {
      skill = await this.skillRepo.findByName(idOrName);
    }
    if (!skill) {
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }

    // 1.5 Object-level authorization (#806, BOLA / OWASP API1). The
    //      package-contents path must not be more permissive than the
    //      metadata path: a private skill the actor cannot read is
    //      denied here, before any storage download, with the same
    //      `skill_not_found` shape so existence isn't leaked. Never log
    //      file contents or secrets — only ids.
    if (!canReadSkill(skill, actor)) {
      logger.info({ idOrName, actorUserId: actor.userId }, "getSkillJson visibility denied");
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }

    // 1a. Resolve the requested version (literal or dist-tag, #463) to its
    //     concrete version + storage key + metadata. Empty/undefined → latest.
    const { resolvedVersion, storageKey, metadata } = await this.resolveVersionStorage(
      skill,
      version,
    );

    // 2. Download the ZIP from storage, proxied through chrono-bucket's
    //    streaming endpoint (#1196) — no presigned URL / direct MinIO fetch.
    const zipBuffer = await this.downloadPackage(storageKey);

    // 3. Extract all files
    const zip = await JSZip.loadAsync(zipBuffer);
    const allPaths = Object.keys(zip.files);
    const { rootEntries: _rootEntries } = resolveZipRoot(zip, allPaths);

    const files: Record<string, string> = {};

    // Walk all entries and extract text content
    for (const path of allPaths) {
      const entry = zip.files[path];
      // allPaths is sourced from `Object.keys(zip.files)`, but
      // noUncheckedIndexedAccess (#450) widens the lookup to `T |
      // undefined`. Defensive skip rather than crash.
      if (!entry || entry.dir) continue;

      // Get the relative path (strip root folder prefix if present)
      let relativePath = path;
      const parts = path.split("/");
      if (parts.length > 1) {
        // Check if first part is the root folder
        const possibleRoot = parts[0] + "/";
        if (zip.files[possibleRoot]?.dir) {
          relativePath = parts.slice(1).join("/");
        }
      }

      if (!relativePath) continue;

      try {
        const content = await entry.async("string");
        files[relativePath] = content;
      } catch {
        logger.warn({ path: relativePath }, "Could not extract file as text, skipping");
      }
    }

    logger.info(
      { skillName: skill.name, version: resolvedVersion, fileCount: Object.keys(files).length },
      "Skill jsonized",
    );

    return {
      name: skill.name,
      description: skill.description,
      version: resolvedVersion,
      metadata: metadata as unknown as Record<string, unknown>,
      files,
    };
  }

  /**
   * Resolve a requested version (literal or dist-tag; empty/undefined →
   * latest) to its concrete version string, storage key, and metadata.
   * Shared by the package-content read paths (getSkillJson, getPackageBytes)
   * so version resolution lives in one place (#463, #1196).
   */
  private async resolveVersionStorage(
    skill: SkillDocument,
    version?: string,
  ): Promise<{ resolvedVersion: string; storageKey: string; metadata: SkillMetadata }> {
    if (version === undefined || version.length === 0) {
      return {
        resolvedVersion: skill.latestVersion,
        storageKey: skill.storageKey,
        metadata: skill.metadata,
      };
    }
    const literal = resolveDistTag(skill, version);
    if (!literal) {
      // Defensive — resolveDistTag returns a string for any non-empty input,
      // but the type system widens to `| undefined`.
      throw AppError.badRequest("invalid_version", `Could not resolve version '${version}'`);
    }
    parseVersion(literal); // 400 if malformed, before the Mongo lookup
    const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, literal);
    if (!versionDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${literal}' not found for skill '${skill.name}'`,
      );
    }
    return {
      resolvedVersion: versionDoc.version,
      storageKey: versionDoc.storageKey,
      metadata: versionDoc.metadata,
    };
  }

  /**
   * Resolve a skill version's package ZIP bytes from storage.
   *
   * Enforces the same object-level visibility gate as the metadata / json
   * paths (#806): a private skill the actor cannot read 404s as
   * `skill_not_found` before any storage read. `version` may be a literal or
   * dist-tag; empty/undefined → latest. Bytes are streamed from chrono-bucket
   * via the storage client — no presigned URL ever leaves the server (#1196).
   * Backs `GET /skills/:idOrName/versions/:version/download` and the audit
   * pipeline. Trusted server jobs pass `SYSTEM_ACTOR`.
   */
  async getPackageBytes(
    idOrName: string,
    actor: ActorContext,
    version?: string,
  ): Promise<{ bytes: Uint8Array; name: string; version: string }> {
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) skill = await this.skillRepo.findByName(idOrName);
    if (!skill) {
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }
    if (!canReadSkill(skill, actor)) {
      logger.info({ idOrName, actorUserId: actor.userId }, "getPackageBytes visibility denied");
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }
    const { resolvedVersion, storageKey } = await this.resolveVersionStorage(skill, version);
    if (!storageKey) {
      throw AppError.notFound(
        "skill_package_not_found",
        `No package stored for skill '${skill.name}'`,
      );
    }
    const bytes = await this.downloadPackage(storageKey);
    return { bytes, name: skill.name, version: resolvedVersion };
  }

  /**
   * Manually re-trigger an AgentSeal scan on a single version (#253). Used
   * by the admin endpoint when a false positive needs re-checking after a
   * rule update or an AgentSeal version bump. Synchronous (admin waits
   * for the scan); on success the persisted record is returned.
   *
   * Throws AppError.notFound when the skill or version doesn't exist.
   * Returns `{ scan: null }` when the scanner itself failed (timeout,
   * crash, output unparseable). Authorization is enforced by the caller.
   */
  async rescanVersion(
    idOrName: string,
    version: string,
  ): Promise<{
    skillGuid: string;
    skillName: string;
    version: string;
    scan: import("../../../shared/types/index").AgentsealScanSnapshot | null;
  }> {
    parseVersion(version);
    const skill = await this.findSkillByIdOrName(idOrName);
    const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, version);
    if (!versionDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${version}' not found for skill '${skill.name}'`,
      );
    }

    if (!this.agentsealScanner) {
      logger.warn({ skillGuid: skill.guid, version }, "AgentSeal rescan called without scanner — returning null");
      return { skillGuid: skill.guid, skillName: skill.name, version, scan: null };
    }

    const zipBuffer = await this.downloadPackage(versionDoc.storageKey);
    const result = await this.agentsealScanner.scan({
      skillGuid: skill.guid,
      version,
      zipBuffer,
    });
    if (!result) {
      return { skillGuid: skill.guid, skillName: skill.name, version, scan: null };
    }
    const updated = await this.skillVersionRepo.setAgentsealScan(skill.guid, version, {
      score: result.score,
      findings: result.findings,
      scannedAt: result.scannedAt,
      agentsealVersion: result.agentsealVersion,
      scannedFiles: result.scannedFiles,
    });
    return {
      skillGuid: skill.guid,
      skillName: skill.name,
      version,
      scan: updated?.agentsealScan ?? null,
    };
  }

  /**
   * Fire-and-forget AgentSeal scan launched from the create + update
   * publish paths. Catches every error so a failed scan never bubbles
   * into the response (v1 is warn-only).
   */
  private async runAgentsealScan(
    skillGuid: string,
    version: string,
    zipBuffer: Uint8Array,
  ): Promise<void> {
    if (!this.agentsealScanner) return;
    try {
      const result = await this.agentsealScanner.scan({ skillGuid, version, zipBuffer });
      if (!result) return; // already logged at scanner level
      await this.skillVersionRepo.setAgentsealScan(skillGuid, version, {
        score: result.score,
        findings: result.findings,
        scannedAt: result.scannedAt,
        agentsealVersion: result.agentsealVersion,
        scannedFiles: result.scannedFiles,
      });
    } catch (err) {
      logger.warn(
        { err, skillGuid, version },
        "AgentSeal scan/persist failed — publish unaffected (v1 is warn-only)",
      );
    }
  }

  // ==========================================================================
  // Dependency closure (#968)
  // ==========================================================================

  /**
   * Build a {@link LoadVersion} loader over the live skill collections,
   * scoped to what `actor` may read. Resolves a dependency ref
   * (`<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`) into a
   * {@link ResolvedVersion} the closure resolver can walk, or `null` when
   * the skill / version doesn't exist OR isn't visible to the actor.
   *
   * Per-node `canReadSkill` (#806/#968): an anonymous or under-privileged
   * caller resolving the closure of a public skill that transitively
   * depends on a PRIVATE skill gets `null` for that node, surfaced as
   * `skill_dependency_not_found` — existence isn't leaked. Trusted
   * callers (publish-time validation) pass `SYSTEM_ACTOR`.
   *
   * PUBLIC (#969): the skillsets service injects `SkillService` and
   * reuses this loader to resolve a skillset's member refs against the
   * live skill graph — a skillset member is just a skill ref. Promoting
   * the loader from `private` to a public method means the closure walk
   * stays single-sourced; both surfaces resolve refs (and apply the
   * per-node `canReadSkill` visibility gate) identically.
   */
  createVersionLoader(actor: ActorContext): LoadVersion {
    return async (ref: string): Promise<ResolvedVersion | null> => {
      const at = ref.lastIndexOf("@");
      if (at <= 0 || at === ref.length - 1) return null;
      const idOrName = ref.slice(0, at);
      const versionOrTag = ref.slice(at + 1);

      const skill =
        (await this.skillRepo.findByGuid(idOrName)) ??
        (await this.skillRepo.findByName(idOrName));
      if (!skill) return null;

      // Visibility gate (#806) — a node the actor cannot read is invisible
      // (returns null), not a hard error, so the closure of a public skill
      // never leaks the existence of a private dependency.
      if (!canReadSkill(skill, actor)) return null;

      // Resolve a dist-tag to a literal version; a literal passes through.
      // Dist-tag refs use the `<name>@<tag>` grammar; map them via the
      // skill's distTags. `resolveDistTag` expects an `@`-prefixed tag, so
      // detect the literal-version shape first.
      let literalVersion: string;
      if (SKILL_VERSION_REGEX.test(versionOrTag)) {
        literalVersion = versionOrTag;
      } else {
        const resolved = skill.distTags?.[versionOrTag];
        if (resolved) {
          literalVersion = resolved;
        } else if (versionOrTag === "latest") {
          literalVersion = skill.latestVersion;
        } else {
          return null;
        }
      }

      const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(
        skill.guid,
        literalVersion,
      );
      if (!versionDoc) return null;

      const node: ResolvedVersion = {
        ref: `${skill.name}@${versionDoc.version}`,
        name: skill.name,
        version: versionDoc.version,
        guid: skill.guid,
        skillHash: versionDoc.skillHash,
        // Surfaced for #1136 skillset visibility derivation. The actor here
        // already passed `canReadSkill`; under SYSTEM that's everything, so
        // the flag faithfully reports the skill's own privacy.
        isPrivate: skill.isPrivate,
        dependsOn: versionDoc.metadata?.dependsOn ?? [],
      };
      return node;
    };
  }

  /**
   * Resolve the full transitive dependency closure of a skill version,
   * scoped to what `actor` may read (#968).
   *
   * The roots are the skill's own direct `depends-on` refs at the
   * requested version (NOT the skill itself — the closure describes what
   * the skill *needs*). Returns nodes in deps-first topological order.
   *
   * Throws `skill_not_found` (404) when the root skill / version is
   * unknown, and `dependency_cycle` / `dependency_conflict` /
   * `skill_dependency_not_found` from the resolver.
   */
  async resolveSkillClosure(
    idOrName: string,
    actor: ActorContext,
    version?: string,
  ): Promise<ClosureNode[]> {
    const skill = await this.findSkillByIdOrName(idOrName);
    if (!canReadSkill(skill, actor)) {
      throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
    }

    const resolvedVersion =
      version === undefined || version.length === 0
        ? skill.latestVersion
        : resolveDistTag(skill, version) ?? skill.latestVersion;
    parseVersion(resolvedVersion);

    const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(
      skill.guid,
      resolvedVersion,
    );
    if (!versionDoc) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${resolvedVersion}' not found for skill '${skill.name}'`,
      );
    }

    const roots = versionDoc.metadata?.dependsOn ?? [];
    if (roots.length === 0) {
      logger.info({ idOrName, version: resolvedVersion }, "Closure resolved: no dependencies");
      return [];
    }

    const closure = await resolveClosure(roots, {
      loadVersion: this.createVersionLoader(actor),
    });
    logger.info(
      { idOrName, version: resolvedVersion, nodeCount: closure.length },
      "Skill dependency closure resolved",
    );
    return closure;
  }

  /**
   * Publish-time dependency validation (#968). Walks the closure of the
   * just-extracted `dependsOn` refs to guarantee, BEFORE the version is
   * committed, that every dependency exists, is readable to the author,
   * the graph is acyclic, and no two versions of one skill collide.
   *
   * Runs as `SYSTEM_ACTOR` deliberately: the author may legitimately
   * depend on a private skill they own / were granted; the closure is
   * computed over the full graph and the route layer does NOT expose
   * these results — it only gates the publish. A missing / unresolvable
   * dependency surfaces as `skill_dependency_not_found`, a cycle as
   * `dependency_cycle`, a conflict as `dependency_conflict`.
   *
   * No-op when the new version declares no dependencies.
   */
  private async validatePublishDependencies(
    metadata: SkillMetadata,
    context: { name: string; version: string },
  ): Promise<void> {
    const roots = metadata.dependsOn ?? [];
    if (roots.length === 0) return;
    await resolveClosure(roots, {
      loadVersion: this.createVersionLoader(SYSTEM_ACTOR),
    });
    logger.info(
      { name: context.name, version: context.version, depCount: roots.length },
      "Publish-time dependencies validated",
    );
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async extractSkillInfo(
    zipBuffer: Uint8Array,
    // #529 — when the caller passes `skipValidation: true` (Import from
    // GitHub → "Skip Ornn package format validation"), the strict Zod
    // frontmatter check is downgraded to a best-effort extract. The
    // directory-structure validator was already skipped one layer up
    // in `createSkill`; this brings the frontmatter validator under
    // the same flag so a third-party skill (e.g. Anthropic's official
    // skills repo) that doesn't conform to Ornn's frontmatter schema
    // still imports.
    skipValidation: boolean = false,
  ): Promise<{
    name: string;
    description: string;
    version: string;
    license: string | null;
    compatibility: string | null;
    metadata: SkillMetadata;
    /** Optional author-supplied changelog. Read from SKILL.md frontmatter `release-notes` or `releaseNotes`. Max 2000 chars. */
    releaseNotes: string | null;
  }> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const allPaths = Object.keys(zip.files);
    const { getFile } = resolveZipRoot(zip, allPaths);

    const skillMdEntry = getFile("SKILL.md");
    if (!skillMdEntry) {
      throw AppError.badRequest("missing_skill_md", "SKILL.md not found in package");
    }

    const content = await skillMdEntry.async("string");
    const fmMatch = content.match(FRONTMATTER_REGEX);
    if (!fmMatch) {
      throw AppError.badRequest("missing_frontmatter", "SKILL.md must have a frontmatter section");
    }

    let rawFrontmatter: Record<string, unknown>;
    try {
      // FRONTMATTER_REGEX always has a capture group 1 (the YAML body)
      // when it matches. `!` is safe under noUncheckedIndexedAccess
      // (#450).
      const parsed = parseYaml(fmMatch[1]!);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Frontmatter must be a YAML object");
      }
      rawFrontmatter = parsed as Record<string, unknown>;
    } catch (err) {
      // YAML SYNTAX errors (vs. schema mismatches) still fail loudly
      // even under skipValidation — we can't import a skill we can't
      // parse at all, no matter how lenient we want to be.
      throw AppError.badRequest(
        "INVALID_FRONTMATTER",
        `Invalid frontmatter YAML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Strict Zod validation (#529 — bypassable when skipValidation).
    const validation = validateSkillFrontmatter(rawFrontmatter);
    if (!validation.success) {
      if (!skipValidation) {
        const errorMsg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
        throw AppError.badRequest("frontmatter_validation_failed", errorMsg);
      }
      // skipValidation path — fall through to best-effort field
      // extraction below.
      logger.info(
        { errors: validation.errors.length },
        "Frontmatter validation failed but skipValidation=true; falling back to best-effort extract",
      );
      return this.extractSkillInfoLenient(rawFrontmatter);
    }

    const fm = validation.data;
    const rawMeta = fm.metadata;

    // Build SkillMetadata from validated frontmatter
    const metadata: SkillMetadata = {
      category: rawMeta.category,
    };

    if (rawMeta["output-type"]) {
      metadata.outputType = rawMeta["output-type"];
    }

    if (rawMeta.runtime.length > 0) {
      // Map flat runtime strings to the structured runtimes array
      // Parse runtime-dependency and runtime-env-var into the first runtime entry
      metadata.runtimes = rawMeta.runtime.map((r) => ({
        runtime: r,
        dependencies: rawMeta["runtime-dependency"].map((dep) => ({
          library: dep,
          version: "*",
        })),
        envs: rawMeta["runtime-env-var"].map((envVar) => ({
          var: envVar,
          description: "",
        })),
      }));
    }

    if (rawMeta["tool-list"].length > 0) {
      metadata.tools = rawMeta["tool-list"].map((t) => ({
        tool: t,
        type: "mcp",
      }));
    }

    if (rawMeta.tag.length > 0) {
      metadata.tags = rawMeta.tag;
    }

    // Skill dependencies (#968). Map the kebab `depends-on` frontmatter
    // field onto the camelCase `dependsOn` metadata field. The Zod schema
    // already validated grammar + self-ref + the 50-entry cap, so this is
    // a straight copy. Only set the key when non-empty so legacy / no-dep
    // versions read back clean (absent, not `[]`).
    if (rawMeta["depends-on"].length > 0) {
      metadata.dependsOn = rawMeta["depends-on"];
    }

    // Author-supplied changelog lives next to the formal frontmatter but isn't
    // part of the Zod schema — kept permissive so missing/older SKILL.md files
    // just report null instead of hard-failing. Accepts either `release-notes`
    // (kebab-case to match other frontmatter fields) or `releaseNotes`.
    const rawReleaseNotes =
      rawFrontmatter["release-notes"] ?? rawFrontmatter["releaseNotes"];
    let releaseNotes: string | null = null;
    if (typeof rawReleaseNotes === "string" && rawReleaseNotes.trim().length > 0) {
      const trimmed = rawReleaseNotes.trim();
      releaseNotes = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
    }

    return {
      name: fm.name,
      description: fm.description,
      version: fm.version,
      license: fm.license ?? null,
      compatibility: fm.compatibility ?? null,
      metadata,
      releaseNotes,
    };
  }

  /**
   * Best-effort extract from a raw frontmatter object when the strict
   * Zod schema rejected it (#529). Used by `extractSkillInfo` under
   * `skipValidation: true` so a third-party-shaped SKILL.md still
   * imports.
   *
   * Strategy:
   *   - Pull the canonical Ornn fields by name when present and the
   *     right type; otherwise synthesise a safe default.
   *   - `name` MUST be present (we have no fallback that would be
   *     unique). Reject with the same `frontmatter_validation_failed`
   *     code that the strict path uses.
   *   - `version` defaults to "0.1" if missing — the import has to
   *     start somewhere. Format-validation downstream
   *     (`parseVersion`) still kicks in so genuinely malformed
   *     versions hard-fail.
   *   - `metadata.category` defaults to "plain" — the safest category
   *     (no runtime / tool execution expected). The user can edit
   *     post-import.
   *   - `tags` / `runtime` / `tools` are extracted when they look
   *     plausibly correct, dropped silently otherwise.
   */
  private extractSkillInfoLenient(
    raw: Record<string, unknown>,
  ): {
    name: string;
    description: string;
    version: string;
    license: string | null;
    compatibility: string | null;
    metadata: SkillMetadata;
    releaseNotes: string | null;
  } {
    const name =
      typeof raw.name === "string" && raw.name.trim().length > 0
        ? raw.name.trim()
        : null;
    if (!name) {
      throw AppError.badRequest(
        "frontmatter_validation_failed",
        "name: required (cannot be derived under skipValidation either)",
      );
    }
    // #807 (CWE-22): the strict path rejects non-kebab-case names via the
    // Zod schema; the lenient path bypassed it, so a crafted name (`../`,
    // `/etc/passwd`, `..`) flowed straight into the public-mirror blob
    // paths and could escape the skill's own `<name>/` subtree. Enforce
    // the SAME kebab-case rule here so `skipValidation` can never widen
    // the name surface beyond the strict path.
    if (name.length > SKILL_NAME_MAX || !SKILL_NAME_REGEX.test(name)) {
      logger.warn({ name }, "skipValidation: rejecting non-kebab-case skill name");
      throw AppError.badRequest(
        "frontmatter_validation_failed",
        `name: must be kebab-case (^[a-z0-9][a-z0-9-]*$, <= ${SKILL_NAME_MAX} chars)`,
      );
    }
    const description =
      typeof raw.description === "string" ? raw.description : "";
    const version =
      typeof raw.version === "string" && raw.version.trim().length > 0
        ? raw.version.trim()
        : "0.1";
    const license = typeof raw.license === "string" ? raw.license : null;
    const compatibility =
      typeof raw.compatibility === "string" ? raw.compatibility : null;

    const rawMeta =
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {};
    const category =
      typeof rawMeta.category === "string" ? rawMeta.category : "plain";

    const tags =
      Array.isArray(rawMeta.tag) &&
      rawMeta.tag.every((t): t is string => typeof t === "string")
        ? (rawMeta.tag as string[])
        : undefined;

    const metadata: SkillMetadata = { category };
    if (tags && tags.length > 0) metadata.tags = tags;

    // Skill dependencies (#968) under skipValidation. The strict Zod
    // schema was bypassed, so we re-apply the grammar regex here and keep
    // only well-formed refs (self-refs by name dropped too). A malformed
    // ref is silently discarded rather than failing the import — same
    // best-effort posture as `tags` above. This keeps the closure
    // resolver's input invariant ("every persisted ref parses") even on
    // the lenient path; the dropped refs are logged for diagnosis.
    if (Array.isArray(rawMeta["depends-on"])) {
      const validDeps = (rawMeta["depends-on"] as unknown[]).filter(
        (d): d is string =>
          typeof d === "string" &&
          DEPENDS_ON_REF_REGEX.test(d) &&
          d.slice(0, d.indexOf("@")) !== name,
      );
      const dropped = (rawMeta["depends-on"] as unknown[]).length - validDeps.length;
      if (dropped > 0) {
        logger.info(
          { name, dropped },
          "skipValidation: dropped malformed/self depends-on entries",
        );
      }
      if (validDeps.length > 0) metadata.dependsOn = validDeps.slice(0, 50);
    }

    const rawReleaseNotes = raw["release-notes"] ?? raw["releaseNotes"];
    let releaseNotes: string | null = null;
    if (typeof rawReleaseNotes === "string" && rawReleaseNotes.trim().length > 0) {
      const trimmed = rawReleaseNotes.trim();
      releaseNotes = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
    }

    return {
      name,
      description,
      version,
      license,
      compatibility,
      metadata,
      releaseNotes,
    };
  }

  private async buildDetailResponse(
    skill: SkillDocument,
    versionOverlay?: SkillVersionDocument,
  ): Promise<SkillDetailResponse> {
    // When reading a specific version, swap in that version's package fields;
    // identity fields (name, createdBy, isPrivate, ...) still come from the
    // skill doc.
    //
    // For the latest-read path (no overlay) we issue one indexed lookup against
    // `skill_versions` so the response surfaces `isDeprecated` / `deprecationNote`
    // consistently with the versioned path. Those fields live only on
    // `skill_versions`, so this lookup is the single source of truth — it is not
    // denormalized onto the skill doc on purpose: a copy would introduce a
    // dual-write drift trap (cf. the `distTags.latest` concern). This runs
    // per-detail-read, not as a list fan-out, so the indexed limit(1) is cheap.
    let effectiveOverlay = versionOverlay;
    if (!effectiveOverlay) {
      effectiveOverlay =
        (await this.skillVersionRepo.findLatestBySkill(skill.guid)) ?? undefined;
    }

    // Package downloads are proxied through `GET /skills/:idOrName/versions/
    // :version/download` (#1196); the detail response no longer carries a
    // presigned URL, so there is no per-read storage round-trip here and no
    // direct-to-MinIO URL ever reaches a client.
    const metadata = effectiveOverlay?.metadata ?? skill.metadata;
    const skillHash = effectiveOverlay?.skillHash ?? skill.skillHash;
    const license = effectiveOverlay ? effectiveOverlay.license : skill.license;
    const compatibility = effectiveOverlay ? effectiveOverlay.compatibility : skill.compatibility;
    const version = effectiveOverlay?.version ?? skill.latestVersion;
    const isDeprecated = effectiveOverlay?.isDeprecated === true;
    const deprecationNote = effectiveOverlay?.deprecationNote ?? null;

    const tags: string[] = metadata?.tags ?? [];

    return {
      guid: skill.guid,
      name: skill.name,
      description: skill.description,
      license,
      compatibility,
      metadata: metadata as unknown as Record<string, unknown>,
      tags,
      skillHash,
      isPrivate: skill.isPrivate,
      createdBy: skill.createdBy,
      createdByEmail: skill.createdByEmail,
      createdByDisplayName: skill.createdByDisplayName,
      createdOn: skill.createdOn instanceof Date ? skill.createdOn.toISOString() : String(skill.createdOn),
      updatedOn: skill.updatedOn instanceof Date ? skill.updatedOn.toISOString() : String(skill.updatedOn),
      sharedWithUsers: skill.sharedWithUsers,
      sharedWithOrgs: skill.sharedWithOrgs,
      // Canonical typed ACL (#1123). `effectiveGrants` falls back to deriving
      // read grants from the legacy lists for un-migrated skills, so the
      // response shape is identical regardless of migration state.
      grants: effectiveGrants(skill),
      version,
      isDeprecated,
      deprecationNote,
      source: skill.source
        ? {
            type: "github",
            repo: skill.source.repo,
            ref: skill.source.ref,
            path: skill.source.path,
            // Both fields are optional and absent for the "linked but
            // never synced" state. Only include them when present so
            // we never serialize an Invalid Date.
            ...(skill.source.lastSyncedAt instanceof Date
              ? { lastSyncedAt: skill.source.lastSyncedAt.toISOString() }
              : {}),
            ...(typeof skill.source.lastSyncedCommit === "string" && skill.source.lastSyncedCommit
              ? { lastSyncedCommit: skill.source.lastSyncedCommit }
              : {}),
            // Drift-detection state (#1176/#1177) — surfaced on GET so the
            // frontend renders the auto-sync badge (#1178) from the last
            // scheduled check without a bespoke endpoint. `etag` stays
            // internal (a conditional-request cache detail, not client-facing).
            ...(typeof skill.source.upstreamHeadSha === "string" && skill.source.upstreamHeadSha
              ? { upstreamHeadSha: skill.source.upstreamHeadSha }
              : {}),
            ...(skill.source.lastCheckedAt instanceof Date
              ? { lastCheckedAt: skill.source.lastCheckedAt.toISOString() }
              : {}),
            ...(typeof skill.source.driftState === "string"
              ? { driftState: skill.source.driftState }
              : {}),
          }
        : undefined,
      agentsealScan: effectiveOverlay?.agentsealScan ?? null,
      nyxidServiceId: skill.nyxidServiceId ?? null,
      nyxidServiceSlug: skill.nyxidServiceSlug ?? null,
      nyxidServiceLabel: skill.nyxidServiceLabel ?? null,
      isSystemSkill: skill.isSystemSkill === true,
      // Always surface a `latest` tag — legacy skills predating #463
      // get one synthesized from `latestVersion` so consumers can rely
      // on `distTags.latest` always being set.
      distTags: { latest: skill.latestVersion, ...(skill.distTags ?? {}) },
      ...(skill.mirrorSync && skill.mirrorSync.syncedAt instanceof Date
        ? {
            mirrorSync: {
              version: skill.mirrorSync.version,
              syncedAt: skill.mirrorSync.syncedAt.toISOString(),
              commitSha: skill.mirrorSync.commitSha,
            },
          }
        : {}),
    };
  }

  /**
   * Validate ZIP format rules (structure, required files, frontmatter, etc.).
   *
   * Returns the list of rule violations. An empty array means the package is valid.
   * Public so the `/skill-format/validate` route can call it without an `as any` cast.
   */
  async validateZipFormat(zipBuffer: Uint8Array): Promise<Array<{ rule: string; message: string }>> {
    const violations: Array<{ rule: string; message: string }> = [];

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipBuffer);
    } catch {
      violations.push({ rule: "valid-zip", message: "The uploaded file is not a valid ZIP archive." });
      return violations;
    }

    const allPaths = Object.keys(zip.files);
    const { rootFolderName, rootEntries, getFile } = resolveZipRoot(zip, allPaths);

    // #807: reuse the canonical kebab-case rule (was a duplicate local
    // regex) so folder-name validation can never drift from the name rule
    // enforced on the create/import path.
    const ALLOWED_ROOT = new Set(["SKILL.md", "scripts", "references", "assets"]);

    if (rootFolderName && !SKILL_NAME_REGEX.test(rootFolderName)) {
      violations.push({
        rule: "folder-name-kebab-case",
        message: `Package folder name "${rootFolderName}" must be kebab-case.`,
      });
    }

    const skillMdEntry = getFile("SKILL.md");
    if (!skillMdEntry) {
      const caseMatch = rootEntries.find((e) => e.toLowerCase() === "skill.md");
      violations.push({
        rule: caseMatch ? "skill-md-exact-case" : "skill-md-exists",
        message: caseMatch
          ? `Found "${caseMatch}" but the file must be exactly "SKILL.md".`
          : "SKILL.md must be present at the root of the skill package.",
      });
      return violations;
    }

    if (getFile("README.md")) {
      violations.push({
        rule: "no-readme-md",
        message: "README.md is not allowed at the root.",
      });
    }

    for (const entry of rootEntries) {
      const name = entry.replace(/\/$/, "");
      if (!ALLOWED_ROOT.has(name)) {
        violations.push({
          rule: "allowed-root-items",
          message: `Root item "${name}" is not allowed. Only SKILL.md, scripts/, references/, assets/ permitted.`,
        });
      }
    }

    let skillMdContent: string;
    try {
      skillMdContent = await skillMdEntry.async("string");
    } catch {
      violations.push({ rule: "skill-md-readable", message: "Could not read SKILL.md content." });
      return violations;
    }

    const fmMatch = skillMdContent.match(FRONTMATTER_REGEX);
    if (!fmMatch) {
      violations.push({
        rule: "frontmatter-present",
        message: "SKILL.md must have a frontmatter section delimited by ---.",
      });
      return violations;
    }

    // FRONTMATTER_REGEX always has capture group 1 (the YAML body)
    // when it matches. `!` is safe under noUncheckedIndexedAccess
    // (#450).
    const yamlBlock = fmMatch[1]!;
    if (yamlBlock.includes("<") || yamlBlock.includes(">")) {
      violations.push({
        rule: "no-xml-brackets",
        message: "Frontmatter must not contain XML angle brackets (< or >).",
      });
    }

    let frontmatter: Record<string, unknown>;
    try {
      const parsed = parseYaml(yamlBlock);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        violations.push({ rule: "frontmatter-valid-yaml", message: "Frontmatter must be a valid YAML object." });
        return violations;
      }
      frontmatter = parsed as Record<string, unknown>;
    } catch (e) {
      violations.push({
        rule: "frontmatter-valid-yaml",
        message: `Frontmatter YAML is invalid: ${e instanceof Error ? e.message : String(e)}`,
      });
      return violations;
    }

    // Validate via Zod schema
    const result = validateSkillFrontmatter(frontmatter);
    if (!result.success) {
      for (const err of result.errors) {
        violations.push({ rule: `frontmatter.${err.field}`, message: err.message });
      }
    } else {
      // Cross-check name matches folder
      if (rootFolderName && result.data.name !== rootFolderName) {
        violations.push({
          rule: "name-matches-folder",
          message: `Skill name "${result.data.name}" must match folder name "${rootFolderName}".`,
        });
      }

      // Name must not contain forbidden terms
      const nameLower = result.data.name.toLowerCase();
      if (nameLower.includes("claude") || nameLower.includes("anthropic")) {
        violations.push({
          rule: "name-no-forbidden-terms",
          message: `Skill name must not contain "claude" or "anthropic".`,
        });
      }

      // Description must not contain XML brackets
      if (result.data.description.includes("<") || result.data.description.includes(">")) {
        violations.push({
          rule: "description-no-xml",
          message: "Description must not contain XML angle brackets.",
        });
      }
    }

    return violations;
  }
}
