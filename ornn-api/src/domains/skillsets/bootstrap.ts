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
import { createSkillsetRoutes } from "./routes";
import { SkillsetSearchService } from "./search/service";
import { createSkillsetSearchRoutes } from "./search/routes";

export interface SkillsetWiring {
  readonly service: SkillsetService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
  readonly searchRoutes: Hono<{ Variables: AuthVariables }>;
  /** Ensure the two collections' indexes. Awaited by bootstrap on startup. */
  ensureIndexes(): Promise<void>;
}

export function wireSkillsets(deps: {
  db: Db;
  skillService: SkillService;
}): SkillsetWiring {
  const skillsetRepo = new SkillsetRepository(deps.db);
  const skillsetVersionRepo = new SkillsetVersionRepository(deps.db);

  const service = new SkillsetService({
    skillsetRepo,
    skillsetVersionRepo,
    skillService: deps.skillService,
  });
  const routes = createSkillsetRoutes({ skillsetService: service });

  const searchService = new SkillsetSearchService({ skillsetRepo });
  const searchRoutes = createSkillsetSearchRoutes({ skillsetSearchService: searchService });

  return {
    service,
    routes,
    searchRoutes,
    ensureIndexes: async () => {
      await skillsetRepo.ensureIndexes();
      await skillsetVersionRepo.ensureIndexes();
    },
  };
}
