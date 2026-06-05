/**
 * Tests for the #270 boot migration that folds the standalone `models`
 * collection into per-provider `llm_providers.models[]` arrays.
 *
 * Uses `mongodb-memory-server` (already a test dep) so the migration's
 * actual update semantics — `arrayFilters` per-model `$set`, the
 * backfill `replace`, the conditional `drop` — run against a real Mongo
 * rather than a hand-rolled fake. The logic under test IS the query, so
 * an in-memory stub would test nothing meaningful.
 *
 * Covers:
 *   1. No legacy collection → short-circuit, nothing copied/dropped.
 *   2. `true` legacy flags fold via arrayFilters onto matching per-
 *      provider model rows.
 *   3. NO-LOSS guard — `false`/absent legacy flags never overwrite an
 *      already-set per-provider value.
 *   4. Backfill — legacy `enabled: true` maps to `enabledForX`; the
 *      legacy `enabled` field is deleted afterwards.
 *   5. Idempotent rerun — second pass is a no-op (legacy gone, docs
 *      byte-stable).
 *   6. Safe-drop guard — rows present but zero flags copied leaves the
 *      collection intact and takes the warn branch.
 *   7. Empty legacy collection → dropped (clean handoff).
 *
 * @module domains/settings/llmProviders/migration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import { migrateModelCatalogIntoProviders } from "./migration";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("llm_providers_migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("llm_providers").deleteMany({});
  // `drop()` errors if the collection is absent — swallow it so each
  // test starts from a clean "no legacy collection" state.
  await db.collection("models").drop().catch(() => {});
});

interface ProviderModelRow extends Document {
  id: string;
  enabledForPlayground?: boolean;
  enabledForSkillGen?: boolean;
  defaultForPlayground?: boolean;
  defaultForSkillGen?: boolean;
  enabled?: boolean;
}

function provider(id: string, models: ProviderModelRow[]): Document {
  return { _id: id as unknown as Document["_id"], name: id, models };
}

async function readProvider(id: string): Promise<Document | null> {
  return db
    .collection("llm_providers")
    .findOne({ _id: id as unknown as Document["_id"] });
}

async function legacyCollectionExists(): Promise<boolean> {
  return db.listCollections({ name: "models" }).hasNext();
}

describe("migrateModelCatalogIntoProviders", () => {
  test("no legacy `models` collection → short-circuits, copies nothing", async () => {
    await db
      .collection("llm_providers")
      .insertOne(provider("p1", [{ id: "gpt-4o", enabledForPlayground: true }]));

    const result = await migrateModelCatalogIntoProviders(db);

    expect(result.legacyRowsConsidered).toBe(0);
    expect(result.flagsCopied).toBe(0);
    expect(result.legacyCollectionDropped).toBe(false);
    // Backfill still runs on the boolean-typed gaps of the existing doc.
    expect(result.modelsBackfilled).toBe(1);
  });

  test("true legacy flags fold onto matching per-provider model rows", async () => {
    await db.collection("llm_providers").insertMany([
      provider("p1", [{ id: "gpt-4o" }]),
      provider("p2", [{ id: "gpt-4o" }, { id: "gpt-3.5" }]),
    ]);
    await db.collection("models").insertOne({
      modelId: "gpt-4o",
      enabledForPlayground: true,
      defaultForSkillGen: true,
    });

    const result = await migrateModelCatalogIntoProviders(db);

    expect(result.legacyRowsConsidered).toBe(1);
    // Two providers carry gpt-4o; each gets the two `true` flags set.
    expect(result.flagsCopied).toBe(4);

    const p1Models = (await readProvider("p1"))?.models as ProviderModelRow[];
    const p1Gpt4o = p1Models.find((m) => m.id === "gpt-4o")!;
    expect(p1Gpt4o.enabledForPlayground).toBe(true);
    expect(p1Gpt4o.defaultForSkillGen).toBe(true);

    const p2Models = (await readProvider("p2"))?.models as ProviderModelRow[];
    const p2Gpt4o = p2Models.find((m) => m.id === "gpt-4o")!;
    expect(p2Gpt4o.enabledForPlayground).toBe(true);
    // The sibling row on p2 that doesn't match the legacy modelId is
    // untouched by the fold (it gets backfilled to false separately).
    const p2Gpt35 = p2Models.find((m) => m.id === "gpt-3.5")!;
    expect(p2Gpt35.enabledForPlayground).toBe(false);
  });

  test("NO-LOSS guard — false/absent legacy flags don't overwrite set values", async () => {
    // Per-provider row already has enabledForPlayground:true. The legacy
    // row carries enabledForPlayground:false (and an absent skillGen),
    // which must NOT clobber the already-set per-provider value.
    await db
      .collection("llm_providers")
      .insertOne(
        provider("p1", [
          { id: "gpt-4o", enabledForPlayground: true, enabledForSkillGen: true },
        ]),
      );
    await db.collection("models").insertOne({
      modelId: "gpt-4o",
      enabledForPlayground: false,
      // enabledForSkillGen absent entirely
    });

    const result = await migrateModelCatalogIntoProviders(db);

    // The legacy row has zero `true` flags → nothing copied for it.
    expect(result.flagsCopied).toBe(0);
    const models = (await readProvider("p1"))?.models as ProviderModelRow[];
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.enabledForPlayground).toBe(true);
    expect(gpt4o.enabledForSkillGen).toBe(true);
  });

  test("backfill — legacy `enabled:true` maps to enabledForX, drops `enabled`", async () => {
    await db.collection("llm_providers").insertOne(
      provider("p1", [
        // Pre-#270 shape: single `enabled` boolean, no surface flags.
        { id: "gpt-4o", enabled: true },
        { id: "gpt-3.5", enabled: false },
      ]),
    );
    // Empty legacy collection so the fold loop is skipped but the
    // collection-exists branch + drop still runs.
    await db.collection("models").insertOne({ modelId: "irrelevant" });
    await db.collection("models").deleteMany({});
    await db.createCollection("models");

    const result = await migrateModelCatalogIntoProviders(db);

    expect(result.modelsBackfilled).toBe(2);
    const models = (await readProvider("p1"))?.models as ProviderModelRow[];
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    // `enabled:true` → both enabledForX true; defaults backfilled false.
    expect(gpt4o.enabledForPlayground).toBe(true);
    expect(gpt4o.enabledForSkillGen).toBe(true);
    expect(gpt4o.defaultForPlayground).toBe(false);
    expect(gpt4o.defaultForSkillGen).toBe(false);
    expect("enabled" in gpt4o).toBe(false);

    const gpt35 = models.find((m) => m.id === "gpt-3.5")!;
    expect(gpt35.enabledForPlayground).toBe(false);
    expect(gpt35.enabledForSkillGen).toBe(false);
    expect("enabled" in gpt35).toBe(false);
  });

  test("idempotent rerun — second pass is a no-op, docs byte-stable", async () => {
    await db.collection("llm_providers").insertOne(
      provider("p1", [{ id: "gpt-4o" }]),
    );
    await db.collection("models").insertOne({
      modelId: "gpt-4o",
      enabledForPlayground: true,
    });

    await migrateModelCatalogIntoProviders(db);
    const afterFirst = await readProvider("p1");
    expect(await legacyCollectionExists()).toBe(false);

    const second = await migrateModelCatalogIntoProviders(db);
    const afterSecond = await readProvider("p1");

    // Legacy gone → short-circuit; backfill already filled every flag so
    // nothing is dirty on the rerun.
    expect(second.legacyRowsConsidered).toBe(0);
    expect(second.flagsCopied).toBe(0);
    expect(second.modelsBackfilled).toBe(0);
    expect(JSON.stringify(afterSecond)).toBe(JSON.stringify(afterFirst));
  });

  test("safe-drop guard — rows present, zero copied → collection intact + warn", async () => {
    // A provider whose model id matches NOTHING in the legacy catalog,
    // plus legacy rows that carry `true` flags for an unrelated model.
    // legacyRowsConsidered > 0 AND flagsCopied === 0 → the "leave it for
    // an operator" branch.
    await db
      .collection("llm_providers")
      .insertOne(provider("p1", [{ id: "claude-x" }]));
    await db.collection("models").insertOne({
      modelId: "gpt-4o", // no provider carries this id
      enabledForPlayground: true,
    });

    const result = await migrateModelCatalogIntoProviders(db);

    expect(result.legacyRowsConsidered).toBe(1);
    expect(result.flagsCopied).toBe(0);
    expect(result.legacyCollectionDropped).toBe(false);
    // Collection deliberately left intact for manual review.
    expect(await legacyCollectionExists()).toBe(true);
  });

  test("empty legacy collection → dropped (clean handoff)", async () => {
    await db
      .collection("llm_providers")
      .insertOne(provider("p1", [{ id: "gpt-4o" }]));
    // Create the collection with zero rows.
    await db.createCollection("models");

    const result = await migrateModelCatalogIntoProviders(db);

    expect(result.legacyRowsConsidered).toBe(0);
    expect(result.legacyCollectionDropped).toBe(true);
    expect(await legacyCollectionExists()).toBe(false);
  });
});
