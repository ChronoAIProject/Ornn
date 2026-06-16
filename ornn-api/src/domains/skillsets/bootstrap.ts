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
import { SkillsetRepository } from "./repository";
import { SkillsetVersionRepository } from "./skillsetVersionRepository";
import { SkillsetService } from "./service";
import { backfillDerivedVisibility } from "./recompute";
import { createSkillsetRoutes } from "./routes";
import { SkillsetSearchService } from "./search/service";
import { createSkillsetSearchRoutes } from "./search/routes";

export interface SkillsetWiring {
  readonly service: SkillsetService;
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
}

export function wireSkillsets(deps: {
  db: Db;
  skillService: SkillService;
  /** #1123 — directory resolver for ownership-transfer target validation. */
  resolveUser?: (
    userId: string,
  ) => Promise<{ userId: string; email: string; displayName: string } | null>;
}): SkillsetWiring {
  const skillsetRepo = new SkillsetRepository(deps.db);
  const skillsetVersionRepo = new SkillsetVersionRepository(deps.db);

  const service = new SkillsetService({
    skillsetRepo,
    skillsetVersionRepo,
    skillService: deps.skillService,
    ...(deps.resolveUser ? { resolveUser: deps.resolveUser } : {}),
  });
  const routes = createSkillsetRoutes({ skillsetService: service });

  // #1136 — the search service live-filters restricted candidates via the
  // skillset service's per-caller member-readability check.
  const searchService = new SkillsetSearchService({ skillsetRepo, skillsetService: service });
  const searchRoutes = createSkillsetSearchRoutes({ skillsetSearchService: searchService });

  return {
    service,
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
  };
}
