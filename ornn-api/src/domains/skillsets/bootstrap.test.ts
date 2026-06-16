/**
 * Skillsets bootstrap wiring smoke test (#969).
 *
 * `wireSkillsets` builds repos + service (injecting a SkillService) +
 * search + routes, and exposes `ensureIndexes()`. This test mounts both
 * route surfaces on an app backed by a real in-memory Mongo and confirms
 * they're reachable under `/api/v1`:
 *   - `GET /api/v1/skillset-search` → 200 (empty registry)
 *   - `GET /api/v1/skillsets/<unknown>` → 404 (handler reached, not 404 from
 *     an unmounted route — the body carries the skillset_not_found code)
 *
 * @module domains/skillsets/bootstrap.test
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { buildProblemJsonBody } from "../../shared/types/index";
import type { IStorageClient } from "../../clients/storageClient";
import { SkillService } from "../skills/crud/service";
import { SkillRepository } from "../skills/crud/repository";
import { SkillVersionRepository } from "../skills/crud/skillVersionRepository";
import { wireSkillsets } from "./bootstrap";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("skillsets_bootstrap_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

function buildApp() {
  const skillService = new SkillService({
    skillRepo: new SkillRepository(db),
    skillVersionRepo: new SkillVersionRepository(db),
    storageClient: {} as unknown as IStorageClient,
    storageBucketResolver: async () => "bucket",
  });
  const skillsets = wireSkillsets({ db, skillService });

  const app = new Hono();
  const apiApp = new Hono();
  apiApp.route("/", skillsets.routes);
  apiApp.route("/", skillsets.searchRoutes);
  app.route("/api/v1", apiApp);
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json(
      buildProblemJsonBody({ statusCode: status, code, message: err.message, instance: c.req.path, requestId: null }),
      status as never,
      { "Content-Type": "application/problem+json" },
    );
  });
  return {
    app,
    ensureIndexes: skillsets.ensureIndexes,
    backfillDerivedVisibility: skillsets.backfillDerivedVisibility,
  };
}

describe("wireSkillsets — smoke mount", () => {
  test("ensureIndexes resolves against a real Mongo", async () => {
    const { ensureIndexes } = buildApp();
    await ensureIndexes();
    expect(true).toBe(true);
  });

  test("backfillDerivedVisibility resolves against a real Mongo (#1136)", async () => {
    // Smoke: the one-shot backfill is wired and queries Mongo without error
    // on an empty registry (deeper recompute correctness is unit-tested).
    const { ensureIndexes, backfillDerivedVisibility } = buildApp();
    await ensureIndexes();
    await backfillDerivedVisibility();
    expect(true).toBe(true);
  });

  test("GET /api/v1/skillset-search is mounted (200, empty registry)", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skillset-search");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[]; total: number } };
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.total).toBe(0);
  });

  test("GET /api/v1/skillsets/:idOrName is mounted (404 from the handler)", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skillsets/does-not-exist");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("skillset_not_found");
  });
});
