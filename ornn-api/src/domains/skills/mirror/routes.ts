/**
 * GitHub mirror routes.
 *
 * Mounted under `/api/v1`. Three concerns live here:
 *
 *   1. Public read-only — `GET /github/repo`
 *      Returns the configured mirror coords + enabled flag so any
 *      visitor (incl. anonymous) can render the
 *      `npx skills add <owner>/<repo>/<skill>` install snippet on a
 *      public skill page.
 *
 *   2. Admin write — `POST /github/repo`
 *      Patch the mirror coords at runtime. Refuses to abandon an
 *      already-mirrored repo unless `confirmAbandonOldRepo: true` is
 *      explicitly passed in the body. Clears every skill's
 *      `mirrorSync` stamp on success — those stamps point at commit
 *      SHAs in the old repo, so the audit links would be wrong if we
 *      kept them; the next reconcile re-stamps everything against the
 *      new repo. The configmap-side enable flag is intentionally NOT
 *      exposed here — it stays an ops-controlled kill switch.
 *
 *   3. Admin operations — `POST /admin/mirror/reconcile`,
 *      `GET /admin/mirror/status`
 *      Reconcile is fire-and-forget: returns 202 immediately and the
 *      job runs in the background; the status endpoint reports the
 *      most recent run + aggregate counts (eligible / synced / lagging
 *      / never-synced / oldest-unsynced timestamp).
 *
 * @module domains/skills/mirror/routes
 */

import { Hono } from "hono";
import pino from "pino";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import type { MirrorService, ReconcileResult } from "./mirrorService";
import type { PlatformSettingsService } from "../../platform/service";
import type { SkillRepository } from "../crud/repository";

const logger = pino({ level: "info" }).child({ module: "mirrorRoutes" });

/**
 * GitHub naming validation.
 *
 *   owner: alphanumeric + dashes; can't start or end with a dash; 1–39 chars.
 *   repo:  alphanumeric + dot/dash/underscore; 1–100 chars.
 *   branch: any non-empty string up to 250 chars (git's actual limit is
 *          looser but we want a sane upper bound and disallow control chars).
 */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// eslint-disable-next-line no-control-regex -- intentional: rejects branch names containing C0 control chars or DEL.
const BRANCH_RE = /^[^\x00-\x1f\x7f]{1,250}$/;

export interface MirrorRoutesConfig {
  /**
   * The mirror service. Optional so deployments with the feature
   * disabled can still mount the route — admin ops return 503 in that
   * case rather than 404, so operators get a clear error message.
   */
  mirrorService?: MirrorService;
  /**
   * Platform-settings service for runtime-mutable mirror coords.
   * Required even when `mirrorService` is undefined so the public GET
   * still works (returns the configmap defaults).
   */
  platformSettingsService: PlatformSettingsService;
  /**
   * Skill repository for the abandon-confirm pre-flight check + the
   * status endpoint's mirror-counts aggregation.
   */
  skillRepo: SkillRepository;
  /** True iff the mirror feature is enabled in this deployment. Surfaced on
   * the public GET so the frontend can hide install snippets when off. */
  mirrorEnabled: boolean;
}

interface ReconcileRunState {
  status: "idle" | "running";
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  result: ReconcileResult | null;
  error: string | null;
}

export function createMirrorRoutes(
  config: MirrorRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { mirrorService, platformSettingsService, skillRepo, mirrorEnabled } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // Per-process reconcile state. Multi-pod deployments don't share this;
  // see comment on `POST /admin/mirror/reconcile` for the rationale.
  let reconcileState: ReconcileRunState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    result: null,
    error: null,
  };

  // ────────────────────────── Public: GET /github/repo ──────────────────────────

  /**
   * Public-read mirror coordinates. Used by the SkillDetailPage install
   * snippet — anonymous viewers must be able to render `npx skills add
   * <owner>/<repo>/<skill>`. The response always includes the current
   * coords (DB-or-configmap fallback) plus the `enabled` flag so the
   * frontend can hide the snippet when the feature is off.
   */
  app.get("/github/repo", async (c) => {
    const cfg = await platformSettingsService.getGithubMirrorRepo();
    return c.json({
      data: {
        owner: cfg.owner,
        repo: cfg.repo,
        branch: cfg.branch,
        enabled: mirrorEnabled,
      },
      error: null,
    });
  });

  // ────────────────────────── Admin: POST /github/repo ──────────────────────────

  /**
   * Admin patch of the mirror coordinates. When the new coords would
   * abandon a non-empty mirror, the body MUST also include
   * `confirmAbandonOldRepo: true` — destructive enough to deserve an
   * explicit double-tap, not destructive enough to refuse outright.
   *
   * On success, every skill's `mirrorSync` stamp is cleared (old commit
   * SHAs would no longer resolve in the new repo). The next reconcile
   * re-stamps everything against the new target.
   */
  app.post(
    "/github/repo",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const owner = typeof body.owner === "string" ? body.owner.trim() : "";
      const repo = typeof body.repo === "string" ? body.repo.trim() : "";
      const branch = typeof body.branch === "string" ? body.branch.trim() : "";
      const confirmAbandonOldRepo = body.confirmAbandonOldRepo === true;

      if (!OWNER_RE.test(owner)) {
        throw AppError.badRequest(
          "INVALID_OWNER",
          "'owner' must be 1–39 chars of letters/digits/dashes, no leading/trailing dash.",
        );
      }
      if (!REPO_RE.test(repo)) {
        throw AppError.badRequest(
          "INVALID_REPO",
          "'repo' must be 1–100 chars of letters/digits/dot/dash/underscore.",
        );
      }
      if (!BRANCH_RE.test(branch)) {
        throw AppError.badRequest(
          "INVALID_BRANCH",
          "'branch' must be a non-empty string up to 250 chars, no control chars.",
        );
      }

      const current = await platformSettingsService.getGithubMirrorRepo();
      const wouldAbandonOldRepo = owner !== current.owner || repo !== current.repo;
      if (wouldAbandonOldRepo) {
        const counts = await skillRepo.getMirrorCounts();
        const stampedCount = counts.synced + counts.lagging;
        if (stampedCount > 0 && !confirmAbandonOldRepo) {
          throw AppError.conflict(
            "OLD_REPO_NOT_CONFIRMED",
            `Changing the mirror to ${owner}/${repo} would abandon ${stampedCount} skill(s) ` +
              `currently mirrored to ${current.owner}/${current.repo}. ` +
              `Pass confirmAbandonOldRepo: true to proceed; the old repo will not be cleaned up automatically.`,
          );
        }
      }

      await platformSettingsService.patch({
        githubMirror: { owner, repo, branch },
      });
      if (wouldAbandonOldRepo) {
        // Existing stamps point at commit SHAs in the now-abandoned
        // repo. Clearing them resets every eligible skill to "Never
        // synced" until the next reconcile lands a real commit.
        await skillRepo.clearAllMirrorSyncStamps();
        logger.info(
          { from: `${current.owner}/${current.repo}`, to: `${owner}/${repo}` },
          "mirror repo coords changed — cleared all mirrorSync stamps",
        );
      }
      return c.json({
        data: { owner, repo, branch, enabled: mirrorEnabled },
        error: null,
      });
    },
  );

  // ────────────────────────── Admin: POST /admin/mirror/reconcile ──────────────────────────

  /**
   * Kick off a full reconcile. Fire-and-forget: returns 202 with the
   * run's `startedAt` timestamp immediately and the work runs on the
   * background. Poll `GET /admin/mirror/status` to see when it lands.
   *
   * Per-process locking only (no Mongo lease, no Redis lock). Two
   * different ornn-api pods *could* each kick off a reconcile at the
   * same instant; in practice it's rare enough we accept the risk —
   * worst case is a noisy tag-conflict log entry from the second-place
   * GitHub call. The hourly cron's `concurrencyPolicy: Forbid` covers
   * the scheduled case.
   */
  app.post(
    "/admin/mirror/reconcile",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      if (!mirrorService) {
        return c.json(
          {
            data: null,
            error: {
              code: "MIRROR_DISABLED",
              message:
                "GitHub mirror is not enabled in this deployment. Set GITHUB_MIRROR_ENABLED=true and supply credentials.",
            },
          },
          503,
        );
      }
      if (reconcileState.status === "running") {
        return c.json(
          {
            data: null,
            error: {
              code: "RECONCILE_ALREADY_RUNNING",
              message: `A reconcile is already in progress (started at ${reconcileState.startedAt?.toISOString() ?? "unknown"}).`,
            },
          },
          409,
        );
      }

      const startedAt = new Date();
      reconcileState = {
        status: "running",
        startedAt,
        finishedAt: null,
        durationMs: null,
        result: null,
        error: null,
      };

      // Fire and forget — settle into idle state when done. We must
      // keep the closure free of references to per-request state (the
      // request `c` is gone by the time this runs).
      void (async () => {
        const t0 = Date.now();
        try {
          const result = await mirrorService.reconcileAll();
          const finishedAt = new Date();
          reconcileState = {
            status: "idle",
            startedAt,
            finishedAt,
            durationMs: Date.now() - t0,
            result,
            error: null,
          };
          logger.info({ ...result, durationMs: Date.now() - t0 }, "mirror reconcile completed (async)");
        } catch (err) {
          const finishedAt = new Date();
          const message = err instanceof Error ? err.message : String(err);
          reconcileState = {
            status: "idle",
            startedAt,
            finishedAt,
            durationMs: Date.now() - t0,
            result: null,
            error: message,
          };
          logger.error({ err }, "mirror reconcile failed (async)");
        }
      })();

      return c.json(
        {
          data: { status: "running", startedAt: startedAt.toISOString() },
          error: null,
        },
        202,
      );
    },
  );

  // ────────────────────────── Admin: GET /admin/mirror/status ──────────────────────────

  /**
   * Snapshot for the admin overview UI. Combines the in-process
   * reconcile state (most recent run started/finished/duration/result/
   * error) with the DB-side mirror counts (eligible + synced + lagging
   * + never-synced + oldest-unsynced timestamp).
   *
   * Returns the configured repo coords too so the page header can
   * render `<owner>/<repo>` without a second round-trip.
   */
  app.get(
    "/admin/mirror/status",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const [counts, cfg] = await Promise.all([
        skillRepo.getMirrorCounts(),
        platformSettingsService.getGithubMirrorRepo(),
      ]);
      return c.json({
        data: {
          enabled: mirrorEnabled,
          repo: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch },
          counts: {
            eligible: counts.eligible,
            synced: counts.synced,
            lagging: counts.lagging,
            neverSynced: counts.neverSynced,
            oldestUnsyncedAt: counts.oldestUnsyncedAt
              ? counts.oldestUnsyncedAt.toISOString()
              : null,
          },
          lastReconcile: {
            status: reconcileState.status,
            startedAt: reconcileState.startedAt?.toISOString() ?? null,
            finishedAt: reconcileState.finishedAt?.toISOString() ?? null,
            durationMs: reconcileState.durationMs,
            result: reconcileState.result,
            error: reconcileState.error,
          },
        },
        error: null,
      });
    },
  );

  return app;
}
