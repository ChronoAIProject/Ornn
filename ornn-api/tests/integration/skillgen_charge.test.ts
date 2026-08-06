/**
 * IT-SKILLGEN-QUOTA-DENY + IT-SKILLGEN-* charge-path mirrors of the
 * playground charge tests. Same contract — different surface and route
 * prefix.
 *
 *   - At-cap user → 429
 *   - Model-resolution failure (no models enabled) → 503, no bucket row
 *   - Successful generation → bucket.used += 1
 *   - system_error generation → bucket released back to baseline
 *   - Abort mid-stream → bucket released back to baseline
 *
 * Charge-path cases inject the in-process `installLlmGatewayMock()` via
 * the harness `llmClient` seam so the route → generation service → quota
 * wiring runs without network IO.
 *
 * @module tests/integration/skillgen_charge.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { startHarness, type Harness, authHeaders } from "./harness";
import { resetCollections } from "./cleanup";
import { installLlmGatewayMock } from "../mocks/llmGateway";
import type { NyxLlmClient } from "../../src/clients/nyxid/llm";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.cleanup();
}, 30_000);

beforeEach(async () => {
  await resetCollections(h.db, ["quota_buckets", "platform_settings", "llm_providers"]);
});

const buildAuth = (userId: string) =>
  authHeaders({
    userId,
    email: `${userId}@test.invalid`,
    permissions: ["ornn:skill:build"],
  });

/**
 * Valid generated-skill JSON — passes `generatedSkillSchema` so the
 * service emits `generation_complete` (success outcome) on the first
 * stream pass, with no retry round-trip.
 */
const VALID_SKILL_JSON = JSON.stringify({
  name: "test-skill",
  description: "A test skill generated for the integration charge test.",
  category: "plain",
  tags: ["test", "integration"],
  readmeBody:
    "This is a generated test skill body long enough to clear the fifty character minimum readme length requirement.",
});

/** Seed one provider with a model enabled for the skillGen surface. */
async function seedSkillGenModel(db: Harness["db"], modelId: string): Promise<void> {
  const now = new Date();
  await db.collection("llm_providers").insertOne({
    _id: "prov-skillgen",
    name: "test-provider",
    gatewayUrl: "https://gw.test.invalid",
    modelListUrl: "https://gw.test.invalid/models",
    apiFormat: "responses",
    auth: { kind: "apiKey", apiKeyEnc: "" },
    models: [
      {
        id: modelId,
        displayName: modelId,
        enabledForPlayground: false,
        enabledForSkillGen: true,
        defaultForPlayground: false,
        defaultForSkillGen: true,
        removed: false,
        firstSeenAt: now,
        lastSyncedAt: now,
      },
    ],
    maxOutputTokens: 8192,
    defaultTemperature: 0.7,
    createdAt: now,
    updatedAt: now,
    updatedBy: "test",
  });
}

const monthMarker = () => new Date().toISOString().slice(0, 7);

async function drainBody(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  for (let done = false; !done; ) {
    ({ done } = await reader.read());
  }
}

async function waitForBucket(
  db: Harness["db"],
  filter: Record<string, unknown>,
  predicate: (doc: Record<string, unknown> | null) => boolean,
  { tries = 100, intervalMs = 10 } = {},
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < tries; i++) {
    const doc = (await db.collection("quota_buckets").findOne(filter)) as
      | Record<string, unknown>
      | null;
    if (predicate(doc)) return doc;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return (await db.collection("quota_buckets").findOne(filter)) as
    | Record<string, unknown>
    | null;
}

describe("IT-SKILLGEN-QUOTA-DENY", () => {
  test("user at skillGen cap → 429", async () => {
    const mm = monthMarker();
    await seedSkillGenModel(h.db, "gpt-test");
    // skillGen settings default is 50 (see sections/skillGen.ts); pin
    // stored allotment >= that so `used` sits at the effective cap.
    await h.db.collection("quota_buckets").insertOne({
      _id: `u-cap:skillGen:${mm}`,
      userId: "u-cap",
      surface: "skillGen",
      monthMarker: mm,
      monthStart: new Date(),
      monthEnd: new Date(),
      defaultAllotment: 1000,
      adminGrant: 0,
      used: 1000,
      usedByModel: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await h.app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { ...buildAuth("u-cap"), "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    expect(res.status).toBe(429);
  });
});

describe("IT-SKILLGEN-MODEL-RESOLUTION-FAIL", () => {
  test("no models enabled → 503 and NO bucket row for the user", async () => {
    const res = await h.app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { ...buildAuth("u-nomodels"), "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    expect(res.status).toBe(503);
    const buckets = await h.db
      .collection("quota_buckets")
      .find({ userId: "u-nomodels", surface: "skillGen" })
      .toArray();
    expect(buckets.length).toBe(0);
  });
});

describe("IT-SKILLGEN-CHARGE-* (via injected LLM mock)", () => {
  test("successful skill-gen run charges +1 on bucket.used", async () => {
    const { client } = installLlmGatewayMock({
      outcome: "success",
      modelId: "gpt-test",
      text: VALID_SKILL_JSON,
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { ...buildAuth("u-ok"), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "build me a skill" }),
      });
      expect(res.status).toBe(200);
      await drainBody(res);

      const mm = monthMarker();
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-ok:skillGen:${mm}` },
        (d) => !!d && (d.used as number) === 1,
      );
      expect(bucket?.used).toBe(1);
      expect((bucket?.usedByModel as Record<string, number>)["gpt-test"]).toBe(1);
    } finally {
      await oh.cleanup();
    }
  });

  test("system_error skill-gen run charges 0 (slot released)", async () => {
    const { client } = installLlmGatewayMock({
      outcome: "system_error",
      modelId: "gpt-test",
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { ...buildAuth("u-syserr"), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "build me a skill" }),
      });
      expect(res.status).toBe(200);
      await drainBody(res);

      const mm = monthMarker();
      // Reserve bumped used to 1; system_error releases it back to 0.
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-syserr:skillGen:${mm}` },
        (d) => !!d && (d.used as number) === 0,
      );
      expect(bucket?.used).toBe(0);
    } finally {
      await oh.cleanup();
    }
  });
});

describe("IT-SKILLGEN-ABORT", () => {
  test("abort mid-stream releases the reserved slot (used back to baseline)", async () => {
    // `delayMs` parks the mock producer on a real timer between stream
    // events so the abort lands deterministically while the generator is
    // suspended mid-stream — by control flow, not back-pressure luck.
    const { client } = installLlmGatewayMock({
      outcome: "success",
      modelId: "gpt-test",
      text: VALID_SKILL_JSON,
      delayMs: 50,
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const controller = new AbortController();
      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { ...buildAuth("u-abort"), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "build me a skill" }),
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body?.getReader();
      await reader?.read().catch(() => {});
      controller.abort();
      await reader?.cancel().catch(() => {});

      const mm = monthMarker();
      // Aborted stream → generation service never emits generation_complete
      // → outcome stays system_error → slot released → used back to 0.
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-abort:skillGen:${mm}` },
        (d) => !!d && (d.used as number) === 0,
      );
      expect(bucket?.used).toBe(0);
    } finally {
      await oh.cleanup();
    }
  });
});
