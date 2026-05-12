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
 *      Patch the full mirror config at runtime: kill switch, repo
 *      coords, GitHub App credentials. Refuses to abandon an
 *      already-mirrored repo unless `confirmAbandonOldRepo: true` is
 *      explicitly passed in the body. Clears every skill's
 *      `mirrorSync` stamp on owner/repo change — those stamps point
 *      at commit SHAs in the old repo, so the audit links would be
 *      wrong if we kept them; the next reconcile re-stamps everything
 *      against the new repo.
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
import { isMidMaskSentinel, midMaskSecret } from "../../../infra/crypto";
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
const APP_ID_RE = /^[0-9]{1,15}$/;
const INSTALLATION_ID_RE = /^[0-9]{1,20}$/;

export interface MirrorRoutesConfig {
  /**
   * The mirror service. Always provided — runtime config (not boot-
   * time env) decides whether ops actually do anything. The service
   * self-gates via `getActiveClient()` and no-ops when disabled or
   * incomplete.
   */
  mirrorService: MirrorService;
  /**
   * Platform-settings service for runtime-mutable mirror config.
   * Source of truth for enabled + repo coords + App credentials.
   */
  platformSettingsService: PlatformSettingsService;
  /**
   * Skill repository for the abandon-confirm pre-flight check + the
   * status endpoint's mirror-counts aggregation.
   */
  skillRepo: SkillRepository;
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
  const { mirrorService, platformSettingsService, skillRepo } = config;
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
   * <owner>/<repo>/<skill>`. The response includes the current coords
   * plus the `enabled` flag so the frontend can hide the snippet when
   * the feature is off. Sensitive fields (App credentials) are NOT
   * surfaced here.
   */
  app.get("/github/repo", async (c) => {
    const cfg = await platformSettingsService.getGithubMirrorConfig();
    return c.json({
      data: {
        owner: cfg.owner,
        repo: cfg.repo,
        branch: cfg.branch,
        enabled: cfg.enabled,
      },
      error: null,
    });
  });

  // ────────────────────────── Admin: POST /github/repo ──────────────────────────

  /**
   * Admin patch of the full mirror config. Accepts any subset of:
   *   - `enabled` (bool kill switch)
   *   - `owner` / `repo` / `branch` (repo coords; abandon-confirm
   *     applies on owner/repo change)
   *   - `appId` / `installationId` (string)
   *   - `appPrivateKey` (string; bullet character is the
   *     "preserve existing" sentinel — round-tripping the mid-masked
   *     value preserves the stored key)
   *
   * Fields not present in the body are preserved.
   */
  app.post(
    "/github/repo",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const current = await platformSettingsService.getGithubMirrorConfig();
      const confirmAbandonOldRepo = body.confirmAbandonOldRepo === true;

      // ---- enabled ----
      let enabled = current.enabled;
      if ("enabled" in body) {
        if (typeof body.enabled !== "boolean") {
          throw AppError.badRequest("INVALID_SETTING", "'enabled' must be a boolean.");
        }
        enabled = body.enabled;
      }

      // ---- owner / repo / branch ----
      let owner = current.owner;
      let repo = current.repo;
      let branch = current.branch;
      if ("owner" in body) {
        const v = typeof body.owner === "string" ? body.owner.trim() : "";
        if (v.length > 0 && !OWNER_RE.test(v)) {
          throw AppError.badRequest(
            "INVALID_OWNER",
            "'owner' must be 1–39 chars of letters/digits/dashes, no leading/trailing dash.",
          );
        }
        owner = v;
      }
      if ("repo" in body) {
        const v = typeof body.repo === "string" ? body.repo.trim() : "";
        if (v.length > 0 && !REPO_RE.test(v)) {
          throw AppError.badRequest(
            "INVALID_REPO",
            "'repo' must be 1–100 chars of letters/digits/dot/dash/underscore.",
          );
        }
        repo = v;
      }
      if ("branch" in body) {
        const v = typeof body.branch === "string" ? body.branch.trim() : "";
        if (v.length > 0 && !BRANCH_RE.test(v)) {
          throw AppError.badRequest(
            "INVALID_BRANCH",
            "'branch' must be a non-empty string up to 250 chars, no control chars.",
          );
        }
        branch = v;
      }

      // ---- App credentials ----
      let appId = current.appId;
      let installationId = current.installationId;
      let appPrivateKey = current.appPrivateKey;
      if ("appId" in body) {
        const v = typeof body.appId === "string" ? body.appId.trim() : "";
        if (v.length > 0 && !APP_ID_RE.test(v)) {
          throw AppError.badRequest(
            "INVALID_SETTING",
            "'appId' must be 1–15 digits.",
          );
        }
        appId = v;
      }
      if ("installationId" in body) {
        const v = typeof body.installationId === "string" ? body.installationId.trim() : "";
        if (v.length > 0 && !INSTALLATION_ID_RE.test(v)) {
          throw AppError.badRequest(
            "INVALID_SETTING",
            "'installationId' must be 1–20 digits.",
          );
        }
        installationId = v;
      }
      if ("appPrivateKey" in body) {
        const v = body.appPrivateKey;
        if (typeof v !== "string") {
          throw AppError.badRequest(
            "INVALID_SETTING",
            "'appPrivateKey' must be a string (empty = clear).",
          );
        }
        if (isMidMaskSentinel(v)) {
          // Round-trip of the mid-masked display value — keep stored key.
          appPrivateKey = current.appPrivateKey;
        } else {
          appPrivateKey = v;
        }
      }

      // Abandon-confirm only triggers on owner/repo change.
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

      const updated = await platformSettingsService.patch({
        githubMirror: {
          enabled,
          owner,
          repo,
          branch,
          appId,
          installationId,
          appPrivateKey,
        },
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
        data: {
          enabled: updated.githubMirror.enabled,
          owner: updated.githubMirror.owner,
          repo: updated.githubMirror.repo,
          branch: updated.githubMirror.branch,
          appId: updated.githubMirror.appId,
          installationId: updated.githubMirror.installationId,
          appPrivateKey: midMaskSecret(updated.githubMirror.appPrivateKey),
        },
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
      const runtime = await mirrorService.getRuntimeState();
      if (!runtime.enabled || !runtime.configured) {
        return c.json(
          {
            data: null,
            error: {
              code: "MIRROR_DISABLED",
              message: !runtime.enabled
                ? "GitHub mirror is disabled. Flip the kill switch in the admin UI to enable."
                : "GitHub mirror is missing required credentials. Set owner/repo/branch + GitHub App credentials in the admin UI.",
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
   * reconcile state, the DB-side mirror counts, and the full mirror
   * config (App private key mid-masked) so the page can render the
   * settings form pre-populated without a second round-trip.
   */
  app.get(
    "/admin/mirror/status",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const [counts, cfg] = await Promise.all([
        skillRepo.getMirrorCounts(),
        platformSettingsService.getGithubMirrorConfig(),
      ]);
      return c.json({
        data: {
          enabled: cfg.enabled,
          repo: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch },
          appId: cfg.appId,
          installationId: cfg.installationId,
          appPrivateKey: midMaskSecret(cfg.appPrivateKey),
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
