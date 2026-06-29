/**
 * Wire the skillsets domain (#969).
 *
 * Builds the two repositories (identity + append-only versions), the
 * CRUD/closure service (injecting the existing `SkillService` so member
 * resolution + the #968 closure walk stay single-sourced), the search
 * service, and both route surfaces (`/skillsets/*` + `/skillset-search`).
 *
 * @module domains/skillsets/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import type { SkillService } from "../skills/crud/service";
import { createLogger } from "../../shared/logger";
import { SkillsetRepository } from "./repository";
import { SkillsetVersionRepository } from "./skillsetVersionRepository";
import { SkillsetService, type SkillsetNotificationEmitter } from "./service";
import { backfillDerivedVisibility } from "./recompute";

const logger = createLogger("skillsetsBootstrap");
import { createSkillsetRoutes } from "./routes";
import { SkillsetSearchService } from "./search/service";
import { createSkillsetSearchRoutes } from "./search/routes";

export interface SkillsetWiring {
  readonly service: SkillsetService;
  /**
   * The identity repository (#1155). Exposed so the GitHub mirror can
   * enumerate plugin-export-eligible skillsets (`findAllEligibleForMirror`).
   */
  readonly skillsetRepo: SkillsetRepository;
  readonly routes: Hono<{ Variables: AuthVariables }>;
  readonly searchRoutes: Hono<{ Variables: AuthVariables }>;
  /** Ensure the two collections' indexes. Awaited by bootstrap on startup. */
  ensureIndexes(): Promise<void>;
  /**
   * One-shot derived-visibility backfill (#1136). Idempotent — recomputes
   * the `membersAllPublic` / `memberVisibilityState` cache for every
   * existing skillset. Awaited by bootstrap after `ensureIndexes`.
   */
  backfillDerivedVisibility(): Promise<void>;
  /**
   * Fire-and-forget reactive recompute (#1136). Call from any skill route
   * that changes a skill's visibility; recomputes every skillset that
   * references it and notifies owners who lost member-read access. Errors
   * are swallowed + logged — never blocks the skill mutation response.
   */
  fireSkillsetRecompute(changedSkill: { guid: string; name: string }): void;
}

export function wireSkillsets(deps: {
  db: Db;
  skillService: SkillService;
  /** #1123 — directory resolver for ownership-transfer target validation. */
  resolveUser?: (
    userId: string,
  ) => Promise<{ userId: string; email: string; displayName: string } | null>;
  /** #1136 — owner-notification emitter for the reactive recompute path. */
  notificationService?: SkillsetNotificationEmitter;
  /**
   * #1155 — fire-and-forget mirror reconcile, called after a skillset
   * create / publish / delete (any of which can change plugin-export
   * eligibility). No-op when unset.
   */
  fireMirrorReconcile?: () => void;
}): SkillsetWiring {
  const skillsetRepo = new SkillsetRepository(deps.db);
  const skillsetVersionRepo = new SkillsetVersionRepository(deps.db);

  const service = new SkillsetService({
    skillsetRepo,
    skillsetVersionRepo,
    skillService: deps.skillService,
    ...(deps.resolveUser ? { resolveUser: deps.resolveUser } : {}),
    ...(deps.notificationService ? { notificationService: deps.notificationService } : {}),
  });
  const routes = createSkillsetRoutes({
    skillsetService: service,
    ...(deps.fireMirrorReconcile ? { fireMirrorReconcile: deps.fireMirrorReconcile } : {}),
  });

  // #1136 — the search service live-filters restricted candidates via the
  // skillset service's per-caller member-readability check.
  const searchService = new SkillsetSearchService({ skillsetRepo, skillsetService: service });
  const searchRoutes = createSkillsetSearchRoutes({ skillsetSearchService: searchService });

  return {
    service,
    skillsetRepo,
    routes,
    searchRoutes,
    ensureIndexes: async () => {
      await skillsetRepo.ensureIndexes();
      await skillsetVersionRepo.ensureIndexes();
    },
    backfillDerivedVisibility: async () => {
      await backfillDerivedVisibility({
        skillsetRepo,
        skillsetVersionRepo,
        skillService: deps.skillService,
      });
    },
    fireSkillsetRecompute: (changedSkill) => {
      service
        .recomputeForChangedSkill(changedSkill)
        .catch((err) =>
          logger.warn(
            { err, skillGuid: changedSkill.guid },
            "Reactive skillset recompute failed",
          ),
        );
    },
  };
}
