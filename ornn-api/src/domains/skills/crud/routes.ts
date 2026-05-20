/**
 * Skill CRUD routes with NyxID permission-based auth.
 * POST /api/skills         — create (ornn:skill:create)
 * GET  /api/skills/:idOrName — read  (ornn:skill:read)
 * PUT  /api/skills/:id     — update (ornn:skill:update + owner/admin)
 * DELETE /api/skills/:id   — delete (ornn:skill:delete + owner/admin)
 * @module domains/skills/crud/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SkillService } from "./service";
import type { SkillRepository } from "./repository";
import type { AnalyticsService } from "../../analytics/service";
import type { AnalyticsEmitter, PlatformActivityAction } from "../../../infra/analytics";
import type { NyxidServiceClient } from "../../../clients/nyxid/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  optionalAuthMiddleware,
  requirePermission,
  getAuth,
  readUserOrgMemberships,
  readUserOrgIds,
} from "../../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import { AppError } from "../../../shared/types/index";
import { canReadSkill, canManageSkill } from "./authorize";
import { parseGithubUrl } from "./utils/githubPull";
import { enforceZipLimits } from "../../../shared/utils/zipLimits";
import { createLogger } from "../../../shared/logger";
const deprecationPatchSchema = z.object({
  isDeprecated: z.boolean(),
  deprecationNote: z.string().max(1024).optional(),
});

/**
 * Schema for `PUT /api/skills/:id/permissions`. `isPrivate === false`
 * means fully public; the shared-with lists are still persisted in that
 * case (no reason to wipe them — the author can flip back to private
 * without losing their collaborator list).
 */
const permissionsPatchSchema = z.object({
  isPrivate: z.boolean(),
  sharedWithUsers: z.array(z.string().min(1).max(128)).max(500).default([]),
  sharedWithOrgs: z.array(z.string().min(1).max(128)).max(100).default([]),
});

/**
 * Body for `PUT /api/v1/skills/:id/nyxid-service`. `nyxidServiceId: null`
 * untie; a string ties to that catalog row. The service is validated +
 * resolved server-side (visibility, owner, label).
 */
const nyxidServicePatchSchema = z.object({
  nyxidServiceId: z.string().min(1).max(128).nullable(),
});

/**
 * Body for `PUT /api/v1/skills/:id/dist-tags/:tag` (#463). Just the
 * version string the tag should point at; the service validates that
 * the version exists.
 */
const distTagSetSchema = z.object({
  version: z
    .string()
    .min(1)
    .max(20)
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "version must be <major>.<minor>"),
});

/**
 * Body for `POST /api/v1/skills/pull` (#438). Either `githubUrl` (a
 * single browser-bar URL the server parses into repo/ref/path) OR an
 * explicit `repo` (with optional `ref`/`path`). A cross-field refine
 * checks that at least one is provided so we don't reach the handler
 * with an empty body.
 */
const skillPullSchema = z
  .object({
    githubUrl: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    ref: z.string().optional(),
    path: z.string().optional(),
    skip_validation: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.githubUrl) || Boolean(b.repo), {
    message: "Provide either 'githubUrl' (preferred) or 'repo' (with optional 'ref'/'path').",
  });

/**
 * Body for `POST /api/v1/skills/:id/refresh` (#438). All fields optional.
 * `skipValidation` and `skip_validation` are both accepted for
 * backward compatibility with the original ad-hoc handler.
 */
const skillRefreshSchema = z.object({
  dryRun: z.boolean().optional(),
  skipValidation: z.boolean().optional(),
  skip_validation: z.boolean().optional(),
});

/**
 * Body for `PUT /api/v1/skills/:id/source` (#438). The url field is
 * a discriminated union: `string` to link, `null` to clear. Anything
 * else is rejected with a clear ZodIssue.
 */
const skillSourceSchema = z.object({
  githubUrl: z.union([z.string().min(1), z.null()]),
});

/** Body for `PUT /api/v1/skills/:id` JSON-only branch (#438). ZIP branch handled separately. */
const skillUpdateJsonSchema = z.object({
  isPrivate: z.boolean().optional(),
});

const logger = createLogger("skillCrudRoutes");

export interface SkillRoutesConfig {
  skillService: SkillService;
  skillRepo: SkillRepository;
  /**
   * Optional. When provided, GET routes fire-and-forget pull events into
   * `skill_pulls` so the usage chart on `SkillDetailPage` has data.
   * Errors are swallowed in the service layer, never surfaced to clients.
   */
  analyticsService?: AnalyticsService;
  /**
   * PostHog product-analytics emitter. Optional — same fire-and-forget
   * treatment as `analyticsService`. Emits `api.skill.pull` per
   * pull/json/detail hit AND every skill mutation activity event
   * (issue #271 — replaced the old activity log).
   */
  analyticsEmitter?: AnalyticsEmitter;
  maxFileSize: number;
  /**
   * NyxID catalog client. Used by `PUT /skills/:id/nyxid-service` to
   * resolve the target service (visibility, owner, label) and by
   * `GET /nyxid-services/:serviceId/skills` to validate the service id
   * before listing skills tied to it.
   */
  nyxidServiceClient: NyxidServiceClient;
  /**
   * Synthetic NyxID services that `GET /me/nyxid-services` appends to
   * the picker. Resolved from admin settings (extras section) on every
   * tie call so an admin can append/remove without redeploying. The
   * tie endpoint accepts `synthetic:<slug>` ids drawn from this list
   * and short-circuits the NyxID lookup so the bind succeeds without a
   * real catalogue row. Treated as admin/platform services (tying
   * forces `isPrivate: false`).
   */
  extraNyxidServicesResolver: () => Promise<readonly string[]>;
  /**
   * GitHub mirror service. Optional — when undefined OR when its
   * `enabled` flag is false, every mutation hook is a no-op. When
   * enabled, every successful skill mutation fires a fire-and-forget
   * `syncSkill` call to keep `ChronoAIProject/ornn-skills` in lockstep
   * with Ornn's public + system skill set.
   */
  mirrorService?: import("../mirror/mirrorService").MirrorService;
}

/** Marker prefix for synthetic NyxID-service ids. See `extraNyxidServices`. */
const SYNTHETIC_NYXID_SERVICE_PREFIX = "synthetic:";

export function createSkillRoutes(config: SkillRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const {
    skillService,
    skillRepo,
    analyticsService,
    analyticsEmitter,
    maxFileSize,
    nyxidServiceClient,
    extraNyxidServicesResolver,
    mirrorService,
  } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  /**
   * Local PostHog activity-event helper. Keeps the per-site diff small
   * — the ten-or-so mutation paths just call `trackActivity(userId,
   * email, displayName, "skill.X", {...})` instead of the old
   * `activityRepo?.log(...)` (issue #271). Fire-and-forget; failures
   * are swallowed inside the emitter wrapper.
   */
  const trackActivity = (
    userId: string,
    email: string,
    displayName: string,
    action: PlatformActivityAction,
    properties: Record<string, unknown> = {},
  ): void => {
    if (!analyticsEmitter) return;
    analyticsEmitter.trackPlatformActivity({
      userId,
      userEmail: email,
      userDisplayName: displayName,
      action,
      properties,
    });
  };

  /**
   * Fire-and-forget mirror sync. Use this from any successful skill
   * mutation so the GitHub mirror catches up without blocking the
   * user-facing response. Errors are swallowed + logged — the mirror
   * is best-effort; the hourly reconciliation cron picks up anything
   * the webhook drops.
   */
  const fireMirrorSync = (guid: string): void => {
    if (!mirrorService) return;
    mirrorService
      .syncSkill(guid)
      .catch((err) => logger.warn({ err, guid }, "mirror syncSkill failed"));
  };
  const fireMirrorRemove = (name: string): void => {
    if (!mirrorService) return;
    mirrorService
      .removeSkill(name)
      .catch((err) => logger.warn({ err, name }, "mirror removeSkill failed"));
  };

  /**
   * Resolve a synthetic-service id (from the `EXTRA_NYXID_SERVICES`
   * config) to the same shape the NyxID catalog returns. Returns `null`
   * if the id isn't synthetic or doesn't match any configured entry —
   * callers must then fall back to the real catalog lookup.
   */
  const resolveSyntheticService = async (id: string) => {
    if (!id.startsWith(SYNTHETIC_NYXID_SERVICE_PREFIX)) return null;
    const slug = id.slice(SYNTHETIC_NYXID_SERVICE_PREFIX.length);
    const extraNyxidServices = await extraNyxidServicesResolver();
    const match = extraNyxidServices.find(
      (name) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") === slug,
    );
    if (!match) return null;
    return {
      id,
      slug,
      label: match,
      visibility: "public" as const,
      // Synthetic services have no real creator; empty string is fine
      // since the eligibility check only matters for personal services.
      createdBy: "",
    };
  };

  const auth = nyxidAuthMiddleware();
  const optionalAuth = optionalAuthMiddleware();

  /**
   * POST /skills — Create a new skill from a ZIP package.
   * Requires: ornn:skill:create
   */
  app.post(
    "/skills",
    auth,
    requirePermission("ornn:skill:create"),
    async (c) => {
      const authCtx = getAuth(c);
      const skipValidation = c.req.query("skip_validation") === "true";

      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("application/zip") && !contentType.includes("application/octet-stream")) {
        throw AppError.badRequest("invalid_content_type", "Expected application/zip content type");
      }

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        throw AppError.badRequest("empty_body", "Request body is empty");
      }

      if (body.byteLength > maxFileSize) {
        throw AppError.payloadTooLarge("File exceeds maximum upload size");
      }

      const zipBuffer = new Uint8Array(body);

      // Zip-bomb defense (#633). Walks the central directory without
      // extracting; throws 413 (`uncompressed_too_large` / `too_many_files`
      // / `invalid_zip`) before validateZipFormat / storage upload /
      // AgentSeal subprocess. Cheap, runs ahead of every expensive
      // side-effect.
      await enforceZipLimits(zipBuffer);

      const userEmail = authCtx.email || undefined;
      const userDisplayName = authCtx.displayName || undefined;

      // New skills are always created as private with no shared-with entries.
      // Visibility is managed afterward via PUT /api/skills/:id/permissions.
      const result = await skillService.createSkill(zipBuffer, authCtx.userId, {
        skipValidation,
        userEmail,
        userDisplayName,
      });
      logger.info({ guid: result.guid, userId: authCtx.userId, userEmail }, "Skill created via API");

      // Activity event → PostHog (issue #271).
      const skill = await skillService.getSkill(result.guid);
      trackActivity(
        authCtx.userId,
        userEmail ?? "",
        userDisplayName ?? "",
        "skill.created",
        { skillId: result.guid, skillName: skill.name },
      );

      // New skills are always private at creation time (visibility is
      // managed afterwards), so this sync is a no-op for now — but
      // calling it eagerly keeps the contract uniform and lets the
      // mirror service log the "considered + skipped" decision.
      fireMirrorSync(result.guid);

      // CONVENTIONS.md §3.2 (#458): POST that creates a resource MUST
      // return 201 Created with a Location header pointing at the
      // canonical URL. Existing 200 + envelope clients are unaffected
      // — the response body is unchanged, only status code + header.
      c.header("Location", `/api/v1/skills/${skill.guid}`);
      return c.json({ data: skill, error: null }, 201);
    },
  );

  /**
   * POST /skills/pull — Create a skill by pulling from a public GitHub repo.
   * Body: { repo: "owner/name", ref?: string, path?: string }
   * Requires: ornn:skill:create
   *
   * This creates a one-way link GitHub → Ornn: subsequent updates to the
   * upstream repo can be brought in via POST /skills/:id/refresh without
   * re-uploading a ZIP.
   */
  app.post(
    "/skills/pull",
    auth,
    requirePermission("ornn:skill:create"),
    validateBody(skillPullSchema, "invalid_pull_body"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<z.infer<typeof skillPullSchema>>(c);

      let repo: string;
      let ref: string | undefined;
      let path: string | undefined;

      if (body.githubUrl) {
        try {
          const parsed = parseGithubUrl(body.githubUrl);
          repo = parsed.repo;
          ref = parsed.ref;
          path = parsed.path;
        } catch (err) {
          throw AppError.badRequest(
            "invalid_github_url",
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        // .refine() in the schema guarantees we have at least one of
        // githubUrl/repo, so this branch is the explicit-repo form.
        repo = body.repo!;
        ref = body.ref;
        path = body.path;
      }

      const skipValidation = body.skip_validation === true;
      const userEmail = authCtx.email || undefined;
      const userDisplayName = authCtx.displayName || undefined;

      try {
        const { guid } = await skillService.createSkillFromGitHub(
          { repo, ref, path },
          authCtx.userId,
          { userEmail, userDisplayName, skipValidation },
        );
        const skill = await skillService.getSkill(guid);

        logger.info(
          { guid, userId: authCtx.userId, repo, ref, path },
          "Skill created via GitHub pull",
        );

        trackActivity(
          authCtx.userId,
          userEmail ?? "",
          userDisplayName ?? "",
          "skill.created",
          { skillId: guid, skillName: skill.name, source: "github-pull" },
        );

        // Same as the ZIP create path — new skills start private, so
        // this sync is a no-op until visibility is flipped. Stays here
        // so the contract is uniform across both create flows.
        fireMirrorSync(guid);

        // 201 + Location, parity with POST /skills (#458).
        c.header("Location", `/api/v1/skills/${skill.guid}`);
        return c.json({ data: skill, error: null }, 201);
      } catch (err) {
        if (err instanceof AppError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw AppError.badRequest("pull_failed", message);
      }
    },
  );

  /**
   * POST /skills/:id/refresh — Re-pull a skill's package from its stored
   * GitHub source and publish as a new version.
   * Requires: ornn:skill:update, and caller must be the skill's author or a
   * platform admin.
   */
  app.post(
    "/skills/:id/refresh",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(skillRefreshSchema, "invalid_refresh_body"),
    async (c) => {
      const authCtx = getAuth(c);
      const guid = c.req.param("id");
      const body = getValidatedBody<z.infer<typeof skillRefreshSchema>>(c);
      const dryRun = body.dryRun === true;
      const skipValidation = body.skipValidation === true || body.skip_validation === true;

      const existing = await skillService.getSkill(guid);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      if (existing.createdBy !== authCtx.userId && !isPlatformAdmin) {
        throw AppError.forbidden(
          "not_skill_owner",
          "Only the skill's author or a platform admin may refresh it",
        );
      }

      // Dry-run path — pull from GitHub, compute diff vs the current
      // latest version, return the diff WITHOUT bumping. Powers the
      // "preview-then-confirm" flow on the detail-page advanced settings.
      if (dryRun) {
        try {
          const preview = await skillService.previewRefreshFromSource(guid);
          return c.json({ data: preview, error: null });
        } catch (err) {
          if (err instanceof AppError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          throw AppError.badRequest("refresh_preview_failed", message);
        }
      }

      try {
        const refreshed = await skillService.refreshSkillFromSource(guid, authCtx.userId, {
          userEmail: authCtx.email || undefined,
          userDisplayName: authCtx.displayName || undefined,
          skipValidation,
        });

        logger.info(
          { guid, userId: authCtx.userId, newCommit: refreshed.source?.lastSyncedCommit },
          "Skill refreshed from GitHub source",
        );

        trackActivity(
          authCtx.userId,
          authCtx.email ?? "",
          authCtx.displayName ?? "",
          "skill.refresh",
          {
            skillId: guid,
            skillName: refreshed.name,
            commit: refreshed.source?.lastSyncedCommit,
          },
        );

        // Refresh bumps version + replaces files → mirror needs to
        // re-extract.
        fireMirrorSync(guid);

        return c.json({ data: refreshed, error: null });
      } catch (err) {
        if (err instanceof AppError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw AppError.badRequest("refresh_failed", message);
      }
    },
  );

  /**
   * PUT /skills/:id/source — Attach (or clear) a GitHub source pointer
   * on a skill without pulling.
   *
   * Body: `{ githubUrl: string | null }`. A non-null value is parsed
   * (e.g. `https://github.com/owner/repo/tree/<ref>/<path>`) and stored
   * on the skill; `lastSyncedAt` / `lastSyncedCommit` are intentionally
   * absent until the user triggers `POST /skills/:id/refresh`. Pass
   * `null` to unlink.
   *
   * Requires: `ornn:skill:update` AND skill author or platform admin.
   */
  app.put(
    "/skills/:id/source",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(skillSourceSchema, "invalid_source_body"),
    async (c) => {
      const authCtx = getAuth(c);
      const guid = c.req.param("id");
      const { githubUrl } = getValidatedBody<z.infer<typeof skillSourceSchema>>(c);

      const existing = await skillService.getSkill(guid);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      if (existing.createdBy !== authCtx.userId && !isPlatformAdmin) {
        throw AppError.forbidden(
          "not_skill_owner",
          "Only the skill's author or a platform admin may set its source",
        );
      }

      const updated = await skillService.setSkillSource(guid, githubUrl, authCtx.userId);

      logger.info(
        { guid, userId: authCtx.userId, action: githubUrl === null ? "unlink" : "link" },
        "Skill source pointer updated",
      );

      trackActivity(
        authCtx.userId,
        authCtx.email ?? "",
        authCtx.displayName ?? "",
        githubUrl === null ? "skill.source_unlinked" : "skill.source_linked",
        {
          skillId: guid,
          skillName: updated.name,
          repo: updated.source?.repo,
          ref: updated.source?.ref,
          path: updated.source?.path,
        },
      );

      return c.json({ data: updated, error: null });
    },
  );

  /**
   * GET /skills/:idOrName/json — Return skill package as JSON with all file contents.
   * Requires: ornn:skill:read
   */
  app.get(
    "/skills/:idOrName/json",
    auth,
    requirePermission("ornn:skill:read"),
    async (c) => {
      const idOrName = c.req.param("idOrName");
      logger.info({ idOrName }, "Skill jsonize request");

      // Visibility check (#567) — the package contents endpoint must
      // not be more permissive than the metadata endpoint. Load the
      // skill first and reject inaccessible private skills with the
      // same `SKILL_NOT_FOUND` shape `/skills/:idOrName` uses.
      const skill = await skillService.getSkill(idOrName);
      if (skill.isPrivate) {
        const authCtx = c.get("auth");
        // `requirePermission` above guarantees authCtx is set.
        if (!authCtx) {
          throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
        }
        const memberships = await readUserOrgMemberships(c);
        const actor = {
          userId: authCtx.userId,
          memberships,
          isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        };
        if (!canReadSkill(skill, actor)) {
          throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
        }
      }

      const result = await skillService.getSkillJson(idOrName);
      // Programmatic pull — closest signal to the north-star metric.
      // Fire-and-forget; the analytics service swallows its own errors.
      const authCtx = c.get("auth");
      if (analyticsService && authCtx) {
        void skillService
          .getSkill(idOrName)
          .then((skill) => {
            analyticsService.recordPull({
              skillGuid: skill.guid,
              skillName: skill.name,
              skillVersion: skill.version,
              userId: authCtx.userId,
              source: "api",
            });
            // PostHog mirror (#252) — `callerType: "api"` is the
            // single most useful split in the funnel (agents vs humans).
            analyticsEmitter?.trackSkillPull({
              userId: authCtx.userId,
              skillId: skill.guid,
              skillName: skill.name,
              skillVersion: skill.version,
              callerType: "api",
            });
          })
          .catch(() => {
            /* analytics failures must not surface to the caller */
          });
      }
      return c.json({ data: result, error: null });
    },
  );

  /**
   * GET /skills/:idOrName/versions — List all published versions, newest first.
   * Visibility rules match GET /skills/:idOrName.
   */
  app.get(
    "/skills/:idOrName/versions",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const authCtx = c.get("auth");

      const skill = await skillService.getSkill(idOrName);
      // Anonymous viewers only see public skills.
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
      }
      if (authCtx && skill.isPrivate) {
        const memberships = await readUserOrgMemberships(c);
        const actor = {
          userId: authCtx.userId,
          memberships,
          isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        };
        if (!canReadSkill(skill, actor)) {
          throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
        }
      }

      const items = await skillService.listSkillVersions(idOrName);
      return c.json({ data: { items }, error: null });
    },
  );

  /**
   * GET /skills/:idOrName/versions/:fromVersion/diff/:toVersion
   *
   * Return a structured diff between two versions. File-level
   * (added/removed/modified) plus text content on both sides for the UI
   * to render line-level diffs client-side. Visibility rules match
   * GET /skills/:idOrName.
   *
   * Auth: Optional. Anonymous users can only diff public skills.
   */
  app.get(
    "/skills/:idOrName/versions/:fromVersion/diff/:toVersion",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const fromVersion = c.req.param("fromVersion");
      const toVersion = c.req.param("toVersion");
      const authCtx = c.get("auth");

      const skill = await skillService.getSkill(idOrName);
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
      }
      if (authCtx && skill.isPrivate) {
        const memberships = await readUserOrgMemberships(c);
        const actor = {
          userId: authCtx.userId,
          memberships,
          isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        };
        if (!canReadSkill(skill, actor)) {
          throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
        }
      }

      const result = await skillService.diffVersions(idOrName, fromVersion, toVersion);
      return c.json({ data: result, error: null });
    },
  );

  /**
   * GET /skills/:idOrName — Read a skill by GUID or name.
   * Query params:
   *   - version: optional `<major>.<minor>` — when set, return that version's
   *     package (storageKey, metadata, hash). When omitted, return the latest.
   * Auth: Optional. Anonymous users can only view public skills.
   */
  app.get(
    "/skills/:idOrName",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const version = c.req.query("version") || undefined;
      const authCtx = c.get("auth");
      const skill = await skillService.getSkill(idOrName, version);

      // Anonymous users can only see public skills.
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
      }

      // Authenticated users: apply the full ownership/org-visibility rules.
      if (authCtx && skill.isPrivate) {
        const memberships = await readUserOrgMemberships(c);
        const actor = {
          userId: authCtx.userId,
          memberships,
          isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        };
        if (!canReadSkill(skill, actor)) {
          throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
        }
      }

      // Signal deprecation via standard RFC 8594 headers (#586) — no
      // custom `X-Skill-Deprecated` style. CLIs, agents, and proxies
      // can read these without an Ornn-specific parser.
      //
      //   Deprecation: true
      //   Link: <…/DEPRECATIONS.md#{guid}>; rel="deprecation"
      //
      // The deprecation note lives in the response body
      // (`deprecationNote` on the SkillDetailResponse), where free-form
      // text belongs. Sunset header is reserved for when we wire up the
      // sunset-date field on the doc.
      if (skill.isDeprecated) {
        c.header("Deprecation", "true");
        c.header(
          "Link",
          `<https://github.com/ChronoAIProject/Ornn/blob/main/docs/DEPRECATIONS.md#${skill.guid}>; rel="deprecation"`,
        );
      }

      // Web-side pull. The detail endpoint is what the SkillDetailPage
      // hits to mint the presigned URL the browser then downloads from
      // — recording the GET here is a reasonable proxy for "user pulled
      // via the web UI". Fire-and-forget.
      if (analyticsService && authCtx) {
        analyticsEmitter?.trackSkillPull({
          userId: authCtx.userId,
          skillId: skill.guid,
          skillName: skill.name,
          skillVersion: skill.version,
          callerType: "web",
        });
        void analyticsService.recordPull({
          skillGuid: skill.guid,
          skillName: skill.name,
          skillVersion: skill.version,
          userId: authCtx.userId,
          source: "web",
        });
      }

      return c.json({ data: skill, error: null });
    },
  );

  /**
   * PATCH /skills/:id/versions/:version
   *
   * Toggle the deprecation flag on a specific version. Per
   * CONVENTIONS.md §2.2 (#586): write operations accept only the
   * stable GUID, not the name. Callers with a name should resolve
   * via the read endpoint first.
   *
   * Requires: ornn:skill:update + owner or admin on the skill.
   */
  app.patch(
    "/skills/:id/versions/:version",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(deprecationPatchSchema, "invalid_deprecation_patch"),
    async (c) => {
      const id = c.req.param("id");
      const version = c.req.param("version");
      const authCtx = getAuth(c);

      // GUID-only — name fallback removed in #586.
      const existing = await skillRepo.findByGuid(id);
      if (!existing) {
        throw AppError.notFound("skill_not_found", `Skill '${id}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to manage this skill",
        );
      }

      const body = getValidatedBody<z.infer<typeof deprecationPatchSchema>>(c);
      const result = await skillService.setVersionDeprecation(
        id,
        version,
        body.isDeprecated,
        body.deprecationNote ?? null,
      );

      trackActivity(authCtx.userId, authCtx.email, authCtx.displayName, "skill.updated", {
        skillId: result.skillGuid,
        skillName: result.skillName,
        version: result.version,
        isDeprecated: result.isDeprecated,
        deprecationChange: true,
      });

      // Deprecation toggle on the latest version → README footer
      // refresh on the mirror.
      fireMirrorSync(result.skillGuid);

      return c.json({ data: result, error: null });
    },
  );

  // -------- Dist-tags (#463) --------
  //
  // Three endpoints mirror npm's `dist-tag` surface: read all, set
  // one, delete one. `latest` is auto-managed by the publish path —
  // PUT / DELETE against it return `dist_tag_immutable` from the
  // service layer.

  /**
   * GET /skills/:idOrName/dist-tags — Read the dist-tags map for a
   * skill (#463). Anonymous can read public skills; private skills
   * require the same auth posture as the read endpoint.
   */
  app.get(
    "/skills/:idOrName/dist-tags",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const authCtx = c.get("auth");
      const skill = await skillRepo.findByGuid(idOrName)
        ?? await skillRepo.findByName(idOrName);
      if (!skill) {
        throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
      }
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
      }
      if (authCtx && skill.isPrivate) {
        const memberships = await readUserOrgMemberships(c);
        const actor = {
          userId: authCtx.userId,
          memberships,
          isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        };
        if (!canReadSkill(skill, actor)) {
          throw AppError.notFound("skill_not_found", `Skill '${idOrName}' not found`);
        }
      }
      const tags = await skillService.getDistTags(skill.guid);
      return c.json({ data: { tags }, error: null });
    },
  );

  /**
   * PUT /skills/:id/dist-tags/:tag — Set or update a dist-tag (#463).
   *
   * Owner / platform-admin only (same gate as the rest of `/skills/:id/*`
   * write paths). `latest` is rejected with `dist_tag_immutable`.
   * Per CONVENTIONS.md §2.2, the `:id` slot is the stable GUID — no
   * polymorphic name resolution on writes.
   */
  app.put(
    "/skills/:id/dist-tags/:tag",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(distTagSetSchema, "invalid_dist_tag_body"),
    async (c) => {
      const id = c.req.param("id");
      const tag = c.req.param("tag");
      const authCtx = getAuth(c);

      const existing = await skillRepo.findByGuid(id);
      if (!existing) {
        throw AppError.notFound("skill_not_found", `Skill '${id}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to manage this skill",
        );
      }

      const body = getValidatedBody<z.infer<typeof distTagSetSchema>>(c);
      const tags = await skillService.setDistTag(id, tag, body.version);
      return c.json({ data: { tags }, error: null });
    },
  );

  /**
   * DELETE /skills/:id/dist-tags/:tag — Remove a dist-tag (#463).
   *
   * Owner / platform-admin only. `latest` is rejected with
   * `dist_tag_immutable` to preserve the auto-managed invariant.
   */
  app.delete(
    "/skills/:id/dist-tags/:tag",
    auth,
    requirePermission("ornn:skill:update"),
    async (c) => {
      const id = c.req.param("id");
      const tag = c.req.param("tag");
      const authCtx = getAuth(c);

      const existing = await skillRepo.findByGuid(id);
      if (!existing) {
        throw AppError.notFound("skill_not_found", `Skill '${id}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to manage this skill",
        );
      }

      const tags = await skillService.deleteDistTag(id, tag);
      return c.json({ data: { tags }, error: null });
    },
  );

  /**
   * PUT /skills/:id — Update a skill.
   * Requires: ornn:skill:update + owner or admin
   * Accepts: application/zip, multipart/form-data, application/json
   */
  app.put(
    "/skills/:id",
    auth,
    requirePermission("ornn:skill:update"),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      const contentType = c.req.header("content-type") ?? "";
      const skipValidation = c.req.query("skip_validation") === "true";

      const existing = await skillRepo.findByGuid(guid);
      if (!existing) {
        throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to update this skill",
        );
      }

      let zipBuffer: Uint8Array | undefined;
      let isPrivate: boolean | undefined;

      if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
        const body = await c.req.arrayBuffer();
        if (body && body.byteLength > 0) {
          if (body.byteLength > maxFileSize) {
            throw AppError.payloadTooLarge("File exceeds maximum upload size");
          }
          zipBuffer = new Uint8Array(body);
        }
      } else if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.parseBody({ all: true });
        const packageFile = formData["package"];
        if (packageFile instanceof File) {
          if (packageFile.size > maxFileSize) {
            throw AppError.payloadTooLarge("File exceeds maximum upload size");
          }
          const buf = await packageFile.arrayBuffer();
          zipBuffer = new Uint8Array(buf);
        }
        if (formData["isPrivate"] !== undefined) {
          isPrivate = String(formData["isPrivate"]) === "true";
        }
      } else if (contentType.includes("application/json")) {
        // Inline Zod parse — the route is hybrid content-type, so the
        // `validateBody` middleware doesn't fit. Same #438 intent:
        // malformed JSON returns 400 with the documented RFC 7807
        // shape instead of bubbling a raw `SyntaxError`.
        let body: z.infer<typeof skillUpdateJsonSchema>;
        try {
          const text = await c.req.text();
          const raw = text.trim().length === 0 ? {} : JSON.parse(text);
          const result = skillUpdateJsonSchema.safeParse(raw);
          if (!result.success) {
            throw AppError.badRequest(
              "invalid_body",
              result.error.issues
                .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
                .join("; "),
            );
          }
          body = result.data;
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw AppError.badRequest("invalid_body", "Request body must be valid JSON");
        }
        if (body.isPrivate !== undefined) {
          isPrivate = body.isPrivate;
        }
      }

      if (zipBuffer === undefined && isPrivate === undefined) {
        throw AppError.badRequest("no_update", "No update data provided. Send a ZIP file and/or isPrivate field.");
      }

      // Zip-bomb defense (#633) — same gate as the create path. Only
      // when a ZIP is actually being replaced; a privacy-only PUT
      // doesn't hit this.
      if (zipBuffer !== undefined) {
        await enforceZipLimits(zipBuffer);
      }

      logger.info({ guid, userId: authCtx.userId }, "Skill update via API");
      const result = await skillService.updateSkill(guid, authCtx.userId, {
        zipBuffer,
        isPrivate,
        skipValidation,
        userEmail: authCtx.email || undefined,
        userDisplayName: authCtx.displayName || undefined,
      });

      const action: PlatformActivityAction =
        isPrivate !== undefined && zipBuffer === undefined
          ? "skill.visibility_changed"
          : "skill.updated";
      trackActivity(authCtx.userId, authCtx.email, authCtx.displayName, action, {
        skillId: guid,
        skillName: result.name,
        ...(isPrivate !== undefined ? { isPrivate } : {}),
      });

      // ZIP update OR privacy flip — both demand a mirror sync. The
      // umbrella decides between publish vs remove based on the new
      // `isPrivate` state.
      fireMirrorSync(guid);

      return c.json({ data: result, error: null });
    },
  );

  /**
   * PUT /skills/:id/permissions — apply a new ACL state directly.
   *
   * Body: `{ isPrivate, sharedWithUsers, sharedWithOrgs }`.
   * Requires: ornn:skill:update + author (or platform admin).
   *
   * Sharing is unconditional: there is no audit gate, no waiver flow.
   * The audit signal travels separately as a per-version label
   * (`GET /audit/summary-by-version`) and the audit pipeline notifies
   * the owner + everyone the skill has been shared with whenever a
   * `risky` audit completes (see `audit/service.ts:finalizeAudit`).
   */
  app.put(
    "/skills/:id/permissions",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(permissionsPatchSchema, "invalid_permissions"),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);

      const existing = await skillRepo.findByGuid(guid);
      if (!existing) {
        throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to change this skill's visibility",
        );
      }

      const body = getValidatedBody<z.infer<typeof permissionsPatchSchema>>(c);

      await skillService.setSkillPermissions(guid, authCtx.userId, {
        isPrivate: body.isPrivate,
        sharedWithUsers: body.sharedWithUsers,
        sharedWithOrgs: body.sharedWithOrgs,
      });

      const updated = await skillService.getSkill(guid);

      trackActivity(authCtx.userId, authCtx.email, authCtx.displayName, "skill.permissions_changed", {
        skillId: guid,
        skillName: updated.name,
        isPrivate: updated.isPrivate,
        sharedWithUsers: updated.sharedWithUsers.length,
        sharedWithOrgs: updated.sharedWithOrgs.length,
      });

      // Permissions change can flip eligibility — sync handles both
      // public→private (remove from mirror) and private→public (add).
      fireMirrorSync(guid);

      return c.json({ data: { skill: updated }, error: null });
    },
  );

  /**
   * PUT /skills/:id/nyxid-service — Tie or untie the skill to a NyxID
   * catalog service.
   *
   * Body: `{ "nyxidServiceId": "<id>" | null }`.
   *
   * Authz:
   *   - Caller must `canManageSkill` (author or platform admin).
   *   - The target service must be visible to the caller AND eligible:
   *     either an admin service (`visibility: "public"`) OR a personal
   *     service the caller created. Tying to *another* user's personal
   *     service is rejected (even for platform admins).
   *
   * Side effect: tying to an admin service flips `isPrivate: false`
   * atomically — system skills are always public.
   */
  app.put(
    "/skills/:id/nyxid-service",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(nyxidServicePatchSchema, "INVALID_NYXID_SERVICE_PATCH"),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);

      const existing = await skillRepo.findByGuid(guid);
      if (!existing) {
        throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      const actor = { userId: authCtx.userId, memberships, isPlatformAdmin };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to change this skill's NyxID service tie",
        );
      }

      const body = getValidatedBody<z.infer<typeof nyxidServicePatchSchema>>(c);
      const token = authCtx.userAccessToken;

      const updated = await skillService.tieToNyxidService(
        guid,
        body.nyxidServiceId,
        { userId: authCtx.userId, isPlatformAdmin },
        async (id) => {
          // Synthetic ids (`synthetic:<slug>`) come from
          // `EXTRA_NYXID_SERVICES` config — short-circuit before the
          // NyxID round-trip so the bind succeeds without a catalogue
          // row. Treated as admin/platform service.
          const syn = await resolveSyntheticService(id);
          if (syn) return syn;
          if (!token) return null;
          const svc = await nyxidServiceClient.findVisibleToCaller(token, id);
          if (!svc) return null;
          return {
            id: svc.id,
            slug: svc.slug,
            label: svc.label,
            visibility: svc.visibility,
            createdBy: svc.createdBy,
          };
        },
      );

      trackActivity(authCtx.userId, authCtx.email, authCtx.displayName, "skill.nyxid_service_tied", {
        skillId: guid,
        skillName: updated.name,
        nyxidServiceId: updated.nyxidServiceId,
        isSystemSkill: updated.isSystemSkill === true,
      });

      // Tie to admin service forces isPrivate=false → previously-private
      // skill becomes mirror-eligible. Conversely an untie can leave a
      // system skill back at private. Sync handles both directions.
      fireMirrorSync(guid);

      return c.json({ data: { skill: updated }, error: null });
    },
  );

  /**
   * GET /nyxid-services/:serviceId/skills — List the skills tied to a
   * given NyxID service.
   *
   * Visibility:
   *   - Admin/system service (caller-visible & `visibility: "public"`):
   *     returns every public skill tied to it (any authed caller).
   *   - Personal service (caller-visible & `visibility: "private"`):
   *     returns the caller's accessible skills tied to it. Only the
   *     service owner / platform admin will see anything meaningful here.
   *
   * Service ids the caller cannot see (private + not owner) collapse to
   * 404 to avoid leaking existence.
   */
  app.get(
    "/nyxid-services/:serviceId/skills",
    auth,
    async (c) => {
      const serviceId = c.req.param("serviceId");
      const authCtx = getAuth(c);
      const token = authCtx.userAccessToken;
      if (!token) {
        throw AppError.notFound(
          "NYXID_SERVICE_NOT_FOUND",
          `NyxID service '${serviceId}' not found`,
        );
      }

      const service = await nyxidServiceClient.findVisibleToCaller(token, serviceId);
      if (!service) {
        throw AppError.notFound(
          "NYXID_SERVICE_NOT_FOUND",
          `NyxID service '${serviceId}' not found`,
        );
      }

      const isAdminService = service.visibility === "public";
      const isOwnerOfPersonal =
        service.visibility === "private" && service.createdBy === authCtx.userId;
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");

      // Personal services: only the owner or a platform admin can browse
      // the skill list. Anyone else gets a 404 (parity with the visibility
      // gate above — existence not leaked).
      if (!isAdminService && !isOwnerOfPersonal && !isPlatformAdmin) {
        throw AppError.notFound(
          "NYXID_SERVICE_NOT_FOUND",
          `NyxID service '${serviceId}' not found`,
        );
      }

      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const userOrgIds = await readUserOrgIds(c);
      // Admin service → only public skills will match (system skills are
      // forced public). Personal service → caller's `mixed` scope.
      const scope = isAdminService ? "public" : "mixed";
      const result = await skillRepo.findByNyxidService(
        serviceId,
        scope,
        authCtx.userId,
        userOrgIds,
        page,
        pageSize,
      );

      const items = result.skills.map((s) => ({
        guid: s.guid,
        name: s.name,
        description: s.description,
        createdBy: s.createdBy,
        createdByEmail: s.createdByEmail,
        createdByDisplayName: s.createdByDisplayName,
        createdOn:
          s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
        updatedOn:
          s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
        isPrivate: s.isPrivate,
        tags: s.metadata?.tags ?? [],
        nyxidServiceId: s.nyxidServiceId ?? null,
        nyxidServiceSlug: s.nyxidServiceSlug ?? null,
        nyxidServiceLabel: s.nyxidServiceLabel ?? null,
        isSystemSkill: s.isSystemSkill === true,
      }));

      return c.json({
        data: {
          service: {
            id: service.id,
            slug: service.slug,
            label: service.label,
            tier: isAdminService ? ("admin" as const) : ("personal" as const),
          },
          items,
          total: result.total,
          page,
          pageSize,
          totalPages: Math.ceil(result.total / pageSize),
        },
        error: null,
      });
    },
  );

  /**
   * DELETE /skills/:id — Hard-delete a skill.
   * Requires: ornn:skill:delete + owner or admin
   */
  app.delete(
    "/skills/:id",
    auth,
    requirePermission("ornn:skill:delete"),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      const skill = await skillRepo.findByGuid(guid);
      if (!skill) {
        throw AppError.notFound("skill_not_found", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(skill, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to delete this skill",
        );
      }
      logger.info({ guid }, "Skill delete via API");
      // Capture name BEFORE deletion so we can scrub the mirror folder
      // — `findByGuid` post-delete returns null, leaving us no key.
      const skillNameForMirror = skill.name;
      await skillService.deleteSkill(guid);

      trackActivity(authCtx.userId, authCtx.email, authCtx.displayName, "skill.deleted", {
        skillId: guid,
        skillName: skill?.name ?? guid,
      });

      // Mirror cleanup: directly remove by name (skill doc is gone, so
      // the umbrella `syncSkill` would no-op).
      fireMirrorRemove(skillNameForMirror);

      return c.json({ data: { success: true }, error: null });
    },
  );

  /**
   * DELETE /skills/:idOrName/versions/:version — Delete one non-latest
   * version of a skill. The skill itself + every other version are
   * preserved. Cannot remove the only remaining version (use
   * DELETE /skills/:id) or the current latest (publish a newer one first).
   * Requires: ornn:skill:delete + owner or admin.
   */
  app.delete(
    "/skills/:id/versions/:version",
    auth,
    requirePermission("ornn:skill:delete"),
    async (c) => {
      // GUID-only on write per CONVENTIONS.md §2.2 (#586).
      const id = c.req.param("id");
      const version = c.req.param("version");
      const authCtx = getAuth(c);

      const skill = await skillRepo.findByGuid(id);
      if (!skill) {
        throw AppError.notFound("skill_not_found", `Skill '${id}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(skill, actor)) {
        throw AppError.forbidden(
          "forbidden",
          "You do not have permission to delete this skill version",
        );
      }
      logger.info(
        { skillGuid: skill.guid, version, userId: authCtx.userId },
        "Skill version delete via API",
      );
      await skillService.deleteVersion(skill.guid, version);

      trackActivity(authCtx.userId, authCtx.email, authCtx.displayName, "skill.version_deleted", {
        skillId: skill.guid,
        skillName: skill.name,
        version,
      });

      // Per-issue policy refuses deletion of the latest version, so
      // the latest pointer never moves here — but cron reconcile will
      // eventually catch any drift. For symmetry with the other
      // mutation routes we still fire a sync; the umbrella will
      // diff-and-no-op when nothing visible to the mirror changed.
      fireMirrorSync(skill.guid);

      return c.json({ data: { success: true }, error: null });
    },
  );

  return app;
}
