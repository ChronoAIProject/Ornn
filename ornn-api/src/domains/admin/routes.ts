/**
 * Admin routes with NyxID auth.
 *
 * Category/Tag CRUD + skill management. Activity feed + user list +
 * dashboard stats moved out of this module in issue #271:
 *   - `/admin/dashboard/stats`  → `domains/admin/dashboard`
 *   - `/admin/users`            → `domains/admin-users`
 *   - `/admin/activities`       → removed (PostHog dashboard)
 *   - `/admin/stats`            → removed (PostHog dashboard)
 *
 * Requires ornn:admin:* permissions.
 * @module domains/admin/routes
 */

import { Hono } from "hono";
import type { SkillRepository } from "../skills/crud/repository";
import type { SkillService } from "../skills/crud/service";
import type { SkillVersionRepository } from "../skills/crud/skillVersionRepository";
import type { SkillGenerationService } from "../skills/generation/service";
import type { IAgentSealScanner } from "../../infra/agentseal";
import type { AnalyticsEmitter } from "../../infra/analytics";
import type { UserDirectoryRepository } from "../users/repository";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "adminRoutes" });

export interface AdminRoutesConfig {
  /** PostHog emitter for skill-delete + agentseal-rescan activity events. */
  analyticsEmitter: AnalyticsEmitter;
  /** Identity cache (used by future drill-downs; held to keep the wiring stable). */
  userDirectoryRepo: UserDirectoryRepository;
  skillRepo: SkillRepository;
  skillService: SkillService;
  /**
   * Skill-version repository — used by the admin AgentSeal endpoints to
   * list low-score versions efficiently via the
   * `agentsealScan.score` index.
   */
  skillVersionRepo?: SkillVersionRepository;
  /**
   * Legacy injection slot — retained so the bootstrap wiring doesn't need
   * to change if admin system-skill endpoints are re-added later in a
   * tag-based form. Currently unused.
   */
  generationService?: SkillGenerationService;
  /**
   * AgentSeal scanner (#253). When omitted the rescan endpoint replies
   * with 503; in dev/CI without the binary, ops can still operate the
   * admin panel but won't see new scans.
   */
  agentsealScanner?: IAgentSealScanner;
}

export function createAdminRoutes(config: AdminRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const {
    analyticsEmitter,
    skillRepo,
    skillService,
    agentsealScanner,
  } = config;
  // userDirectoryRepo is held on `config` for future drill-downs; not
  // referenced in this module's current endpoints.
  void config.userDirectoryRepo;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  // All /admin/* routes require auth + admin permission.
  app.use("/admin/*", auth);

  // =========================================================================
  // Admin Skill Management — browse ALL skills, CRUD any skill
  // =========================================================================

  app.get(
    "/admin/skills",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const q = c.req.query("q") || "";
      const userId = c.req.query("userId") || undefined;

      // Admin can see all skills — no scope filtering
      const filter: Record<string, unknown> = {};
      if (userId) filter.createdBy = userId;

      const skillCollection = skillRepo["collection"];

      if (q) {
        const regex = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [
          { name: { $regex: regex, $options: "i" } },
          { description: { $regex: regex, $options: "i" } },
        ];
      }

      const total = await skillCollection.countDocuments(filter);
      const offset = (page - 1) * pageSize;
      const docs = await skillCollection
        .find(filter)
        .sort({ createdOn: -1 })
        .skip(offset)
        .limit(pageSize)
        .toArray();

      const items = docs.map((d) => ({
        guid: String(d._id),
        name: d.name as string,
        description: d.description as string,
        createdBy: (d.createdBy as string) ?? "",
        createdByEmail: (d.createdByEmail as string) ?? "",
        createdByDisplayName: (d.createdByDisplayName as string) ?? "",
        createdOn: d.createdOn instanceof Date ? d.createdOn.toISOString() : String(d.createdOn),
        updatedOn: d.updatedOn instanceof Date ? d.updatedOn.toISOString() : String(d.updatedOn),
        isPrivate: (d.isPrivate as boolean) ?? true,
        tags: ((d.metadata as Record<string, unknown>)?.tags as string[]) ?? [],
      }));

      return c.json({
        data: {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
        error: null,
      });
    },
  );

  app.delete(
    "/admin/skills/:id",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      // Hono guarantees the :id segment is present when the route matches,
      // but its 4.12 types now expose param() as `string | undefined`. The
      // route definition makes the undefined branch unreachable, so we
      // narrow with `?? ""` — downstream `deleteSkill("")` falls through
      // to the standard "skill not found" path the API already returns
      // for malformed identifiers.
      const guid = c.req.param("id") ?? "";
      const authCtx = getAuth(c);
      await skillService.deleteSkill(guid);

      analyticsEmitter.trackPlatformActivity({
        userId: authCtx.userId,
        userEmail: authCtx.email,
        userDisplayName: authCtx.displayName,
        action: "skill.deleted",
        properties: { skillId: guid, adminAction: true },
      });

      logger.info({ guid, adminUserId: authCtx.userId }, "Skill deleted by admin");
      return c.json({ data: { success: true }, error: null });
    },
  );

  // =========================================================================
  // AgentSeal — admin manual rescan (#253)
  //
  // Lets a platform admin manually re-trigger the trust-score scan on a
  // single skill version. Catches false positives, picks up newer
  // AgentSeal rules without waiting for the next publish.
  //
  // POST /admin/skills/:idOrName/versions/:version/agentseal-rescan
  // 503 when the scanner isn't wired (dev/CI without the binary).
  // =========================================================================

  app.post(
    "/admin/skills/:idOrName/versions/:version/agentseal-rescan",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      // See note on /admin/skills/:id above — hono 4.12 types param() as
      // `string | undefined` even though the route segments are required.
      const idOrName = c.req.param("idOrName") ?? "";
      const version = c.req.param("version") ?? "";
      const authCtx = getAuth(c);

      if (!agentsealScanner) {
        logger.warn(
          { idOrName, version, adminUserId: authCtx.userId },
          "AgentSeal rescan requested but no scanner is wired",
        );
        return c.json(
          {
            data: null,
            error: {
              code: "AGENTSEAL_DISABLED",
              message: "AgentSeal scanner is not configured on this deployment",
            },
          },
          503,
        );
      }

      const result = await skillService.rescanVersion(idOrName, version);

      analyticsEmitter.trackPlatformActivity({
        userId: authCtx.userId,
        userEmail: authCtx.email,
        userDisplayName: authCtx.displayName,
        action: "skill.agentseal_rescanned",
        properties: {
          skillId: result.skillGuid,
          skillName: result.skillName,
          version: result.version,
          score: result.scan?.score ?? null,
          findings: result.scan?.findings.length ?? 0,
          adminAction: true,
        },
      });

      logger.info(
        {
          skillGuid: result.skillGuid,
          version: result.version,
          score: result.scan?.score ?? null,
          adminUserId: authCtx.userId,
        },
        "AgentSeal rescan complete",
      );
      return c.json({ data: result, error: null });
    },
  );

  return app;
}

