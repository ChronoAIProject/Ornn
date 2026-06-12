/**
 * LlmProvidersRepository unit tests (#270 storage layer).
 *
 * Uses `mongodb-memory-server` so the array-filter writes
 * (`clearDefaultsForSurfaceExcept`), the unique-on-name index, and the
 * `normalizeModel` read shim all run against a real Mongo. The logic
 * under test is mostly the Mongo query itself, so a fake collection
 * would test nothing meaningful.
 *
 * Covers:
 *   - CRUD round-trips: insert / findById / findByName (hit + miss) /
 *     list (sorted by name) / replace / deleteById (true + false).
 *   - ensureIndexes — unique-on-name rejects a duplicate insert.
 *   - clearDefaultsForSurfaceExcept — keep=null clears every provider;
 *     keep-set clears siblings (incl. the cross-provider $ne arrayFilter)
 *     while leaving the keeper's chosen model untouched, across ≥2
 *     providers.
 *   - normalizeModel — a pre-#270 `enabled`-only row reads back as the
 *     four surface flags; string `firstSeenAt`/`lastSyncedAt` coerce to
 *     `Date`.
 *
 * @module domains/settings/llmProviders/repository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import { LlmProvidersRepository, type StoredProvider } from "./repository";
import type { LlmProviderModel } from "./types";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: LlmProvidersRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("llm_providers_repo_test");
  repo = new LlmProvidersRepository(db);
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("llm_providers").deleteMany({});
});

const NOW = new Date("2026-01-01T00:00:00.000Z");

function model(
  id: string,
  overrides: Partial<LlmProviderModel> = {},
): LlmProviderModel {
  return {
    id,
    displayName: id,
    enabledForPlayground: false,
    enabledForSkillGen: false,
    enabledForAssistant: false,
    defaultForPlayground: false,
    defaultForSkillGen: false,
    defaultForAssistant: false,
    removed: false,
    firstSeenAt: NOW,
    lastSyncedAt: NOW,
    ...overrides,
  };
}

function stored(
  id: string,
  name: string,
  models: LlmProviderModel[] = [],
): StoredProvider {
  return {
    _id: id,
    name,
    gatewayUrl: "https://api.example.com",
    modelListUrl: "https://api.example.com/v1/models",
    apiFormat: "chat-completion",
    auth: { kind: "apiKey", apiKeyEnc: "v1:fake" },
    models,
    maxOutputTokens: 8192,
    defaultTemperature: 0.7,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: "u-admin",
  };
}

describe("LlmProvidersRepository CRUD", () => {
  test("insert + findById round-trips the stored doc", async () => {
    await repo.insert(stored("p1", "alpha", [model("gpt-4o")]));
    const found = await repo.findById("p1");
    expect(found?._id).toBe("p1");
    expect(found?.name).toBe("alpha");
    expect(found?.models[0]?.id).toBe("gpt-4o");
  });

  test("findById miss returns null", async () => {
    expect(await repo.findById("nope")).toBeNull();
  });

  test("findByName hit + miss", async () => {
    await repo.insert(stored("p1", "alpha"));
    expect((await repo.findByName("alpha"))?._id).toBe("p1");
    expect(await repo.findByName("ghost")).toBeNull();
  });

  test("list returns every provider sorted by name", async () => {
    await repo.insert(stored("p2", "zeta"));
    await repo.insert(stored("p1", "alpha"));
    await repo.insert(stored("p3", "mu"));
    const all = await repo.list();
    expect(all.map((p) => p.name)).toEqual(["alpha", "mu", "zeta"]);
  });

  test("replace swaps the full document", async () => {
    await repo.insert(stored("p1", "alpha", [model("gpt-4o")]));
    await repo.replace("p1", stored("p1", "alpha-renamed", [model("gpt-5")]));
    const found = await repo.findById("p1");
    expect(found?.name).toBe("alpha-renamed");
    expect(found?.models.map((m) => m.id)).toEqual(["gpt-5"]);
  });

  test("deleteById returns true on hit, false on miss", async () => {
    await repo.insert(stored("p1", "alpha"));
    expect(await repo.deleteById("p1")).toBe(true);
    expect(await repo.deleteById("p1")).toBe(false);
  });
});

describe("LlmProvidersRepository.ensureIndexes", () => {
  test("unique-on-name rejects a duplicate insert", async () => {
    await repo.ensureIndexes();
    await repo.insert(stored("p1", "dupe"));
    let err: unknown = null;
    try {
      await repo.insert(stored("p2", "dupe"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as { code?: number }).code).toBe(11000);
    // Drop the index again so unrelated tests in this file aren't bound
    // by the unique constraint.
    await db.collection("llm_providers").dropIndex("name_1");
  });
});

describe("LlmProvidersRepository.clearDefaultsForSurfaceExcept", () => {
  test("keep=null clears the surface default on every provider", async () => {
    await repo.insert(
      stored("p1", "alpha", [model("gpt-4o", { defaultForPlayground: true })]),
    );
    await repo.insert(
      stored("p2", "beta", [model("claude", { defaultForPlayground: true })]),
    );

    await repo.clearDefaultsForSurfaceExcept("Playground", null);

    const p1 = await repo.findById("p1");
    const p2 = await repo.findById("p2");
    expect(p1?.models[0]?.defaultForPlayground).toBe(false);
    expect(p2?.models[0]?.defaultForPlayground).toBe(false);
  });

  test("keep-set clears siblings but leaves the keeper untouched ($ne filter)", async () => {
    // Keeper provider has two defaulted rows on the same surface — the
    // chosen model must survive, its sibling must clear. Another provider
    // also holds a default that must clear (the cross-provider $ne path).
    await repo.insert(
      stored("p1", "alpha", [
        model("keep-me", { defaultForPlayground: true }),
        model("sibling", { defaultForPlayground: true }),
      ]),
    );
    await repo.insert(
      stored("p2", "beta", [model("other", { defaultForPlayground: true })]),
    );

    await repo.clearDefaultsForSurfaceExcept("Playground", {
      providerId: "p1",
      modelId: "keep-me",
    });

    const p1 = await repo.findById("p1");
    const keepMe = p1?.models.find((m) => m.id === "keep-me");
    const sibling = p1?.models.find((m) => m.id === "sibling");
    expect(keepMe?.defaultForPlayground).toBe(true);
    expect(sibling?.defaultForPlayground).toBe(false);

    const p2 = await repo.findById("p2");
    expect(p2?.models[0]?.defaultForPlayground).toBe(false);
  });

  test("SkillGen surface is targeted independently of Playground", async () => {
    await repo.insert(
      stored("p1", "alpha", [
        model("gpt-4o", {
          defaultForPlayground: true,
          defaultForSkillGen: true,
        }),
      ]),
    );

    await repo.clearDefaultsForSurfaceExcept("SkillGen", null);

    const p1 = await repo.findById("p1");
    const m = p1?.models[0];
    // Only the SkillGen flag is cleared; Playground default survives.
    expect(m?.defaultForSkillGen).toBe(false);
    expect(m?.defaultForPlayground).toBe(true);
  });
});

describe("LlmProvidersRepository.normalizeModel (read shim)", () => {
  test("pre-#270 enabled-only doc reads back as four surface flags", async () => {
    // Insert a raw legacy-shaped model row directly, bypassing the typed
    // `insert` so we can exercise the read normalizer.
    await db.collection("llm_providers").insertOne({
      _id: "p1" as unknown as Document["_id"],
      name: "legacy",
      gatewayUrl: "https://api.example.com",
      modelListUrl: "https://api.example.com/v1/models",
      apiFormat: "chat-completion",
      auth: { kind: "apiKey", apiKeyEnc: "v1:fake" },
      models: [
        // Only the legacy `enabled` boolean — none of the surface flags.
        { id: "gpt-4o", displayName: "GPT-4o", enabled: true, firstSeenAt: NOW, lastSyncedAt: NOW },
      ],
      maxOutputTokens: 8192,
      defaultTemperature: 0.7,
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: "system",
    });

    const found = await repo.findById("p1");
    const m = found!.models[0]!;
    expect(m.enabledForPlayground).toBe(true);
    expect(m.enabledForSkillGen).toBe(true);
    expect(m.defaultForPlayground).toBe(false);
    expect(m.defaultForSkillGen).toBe(false);
    // #970 — a legacy doc predating the assistant surface reads back
    // with both assistant flags defaulted to false (never auto-routes).
    expect(m.enabledForAssistant).toBe(false);
    expect(m.defaultForAssistant).toBe(false);
    expect(m.removed).toBe(false);
  });

  test("string firstSeenAt/lastSyncedAt coerce to Date on read", async () => {
    await db.collection("llm_providers").insertOne({
      _id: "p2" as unknown as Document["_id"],
      name: "stringdates",
      gatewayUrl: "https://api.example.com",
      modelListUrl: "https://api.example.com/v1/models",
      apiFormat: "chat-completion",
      auth: { kind: "apiKey", apiKeyEnc: "v1:fake" },
      models: [
        {
          id: "gpt-4o",
          displayName: "GPT-4o",
          enabledForPlayground: true,
          enabledForSkillGen: false,
          defaultForPlayground: false,
          defaultForSkillGen: false,
          removed: false,
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastSyncedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      maxOutputTokens: 8192,
      defaultTemperature: 0.7,
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: "system",
    });

    const found = await repo.findById("p2");
    const m = found!.models[0]!;
    expect(m.firstSeenAt).toBeInstanceOf(Date);
    expect(m.lastSyncedAt).toBeInstanceOf(Date);
    expect(m.firstSeenAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("missing updatedBy defaults to system on read", async () => {
    await db.collection("llm_providers").insertOne({
      _id: "p3" as unknown as Document["_id"],
      name: "noupdater",
      gatewayUrl: "https://api.example.com",
      modelListUrl: "https://api.example.com/v1/models",
      apiFormat: "chat-completion",
      auth: { kind: "apiKey", apiKeyEnc: "v1:fake" },
      models: [],
      maxOutputTokens: 8192,
      defaultTemperature: 0.7,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const found = await repo.findById("p3");
    expect(found?.updatedBy).toBe("system");
  });
});
