/**
 * IT-PLAYGROUND-QUOTA-DENY + IT-PLAYGROUND-CHARGE-* + IT-ADMIN-BYPASS-PLAYGROUND
 *
 * End-to-end flow tests for the playground surface charging path:
 *   - At-cap user → 429 with QUOTA_EXCEEDED
 *   - Model-resolution failure (no models enabled) → 503, no bucket row
 *   - Successful stream → bucket.used += 1, usedByModel[model] += 1
 *   - skill_error stream → bucket.used += 1
 *   - system_error stream → bucket released back to baseline
 *   - Abort mid-stream → bucket released back to baseline
 *   - Admin caller → no quota check, no charge
 *
 * The test seeds the `quota_buckets` collection directly (bypasses the
 * quota service constructor) so we can pin the start state. The charge-
 * path cases inject the in-process `installLlmGatewayMock()` via the
 * harness `llmClient` seam so the real route → chat service → quota
 * wiring runs without touching the network, and the mock controls the
 * outcome (success / skill_error / system_error).
 *
 * @module tests/integration/playground_charge.test
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
});

beforeEach(async () => {
  await resetCollections(h.db, ["quota_buckets", "platform_settings", "llm_providers"]);
});

const userAuth = (userId: string, isAdmin = false) =>
  authHeaders({
    userId,
    email: `${userId}@test.invalid`,
    permissions: isAdmin
      ? ["ornn:admin:skill", "ornn:playground:use"]
      : ["ornn:playground:use"],
  });

/**
 * Seed one provider with a single model enabled for the playground
 * surface so `resolveModel({ surface: "playground" })` returns `ok`.
 * The injected mock LLM client ignores gateway/auth, so the seed only
 * needs to satisfy the catalog resolver, not a real upstream.
 */
async function seedPlaygroundModel(db: Harness["db"], modelId: string): Promise<void> {
  const now = new Date();
  await db.collection("llm_providers").insertOne({
    _id: "prov-playground",
    name: "test-provider",
    gatewayUrl: "https://gw.test.invalid",
    modelListUrl: "https://gw.test.invalid/models",
    apiFormat: "responses",
    auth: { kind: "apiKey", apiKeyEnc: "" },
    models: [
      {
        id: modelId,
        displayName: modelId,
        enabledForPlayground: true,
        enabledForSkillGen: false,
        defaultForPlayground: true,
        defaultForSkillGen: false,
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

/** Drain an SSE response body to completion so the producer task ends. */
async function drainBody(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  for (let done = false; !done; ) {
    ({ done } = await reader.read());
  }
}

/**
 * Poll the bucket until `predicate` holds or the bounded retry budget is
 * exhausted. The producer's `finally` fires `chargeOnCompletion` after
 * the response stream closes; it is not awaitable from the route, so we
 * poll rather than race a fixed sleep — keeps the assertion deterministic.
 */
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

describe("IT-PLAYGROUND-QUOTA-DENY", () => {
  test("user at cap → 429 QUOTA_EXCEEDED", async () => {
    const mm = monthMarker();
    await seedPlaygroundModel(h.db, "gpt-test");
    // Pin used == cap. `effectiveDefault = max(stored, settingsDefault)`;
    // the playground settings default is 200, so the stored allotment
    // must be >= 200 for `used` to be at the effective cap.
    await h.db.collection("quota_buckets").insertOne({
      _id: `u-cap:playground:${mm}`,
      userId: "u-cap",
      surface: "playground",
      monthMarker: mm,
      monthStart: new Date(),
      monthEnd: new Date(),
      defaultAllotment: 200,
      adminGrant: 0,
      used: 200,
      usedByModel: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await h.app.request("/api/v1/playground/chat", {
      method: "POST",
      headers: { ...userAuth("u-cap"), "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    // The user is at cap; the route must reject pre-charge with 429
    // (model resolution succeeds here because a model is seeded).
    expect(res.status).toBe(429);
  });
});

describe("IT-PLAYGROUND-MODEL-RESOLUTION-FAIL", () => {
  test("no models enabled → 503 and NO bucket row for the user", async () => {
    // No provider seeded → resolveModel returns no-models-enabled → 503,
    // before quota reserve, so the user's bucket must never be created.
    const res = await h.app.request("/api/v1/playground/chat", {
      method: "POST",
      headers: { ...userAuth("u-nomodels"), "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    const buckets = await h.db
      .collection("quota_buckets")
      .find({ userId: "u-nomodels", surface: "playground" })
      .toArray();
    expect(buckets.length).toBe(0);
  });
});

describe("IT-ADMIN-BYPASS-PLAYGROUND", () => {
  test("admin caller skips quota check (no bucket created)", async () => {
    await seedPlaygroundModel(h.db, "gpt-test");
    const res = await h.app.request("/api/v1/playground/chat", {
      method: "POST",
      headers: { ...userAuth("u-admin", true), "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    // Admins bypass the quota gate (no 429) and no bucket is created.
    expect(res.status).not.toBe(429);
    const buckets = await h.db
      .collection("quota_buckets")
      .find({ userId: "u-admin", surface: "playground" })
      .toArray();
    expect(buckets.length).toBe(0);
  });
});

describe("IT-PLAYGROUND-CHARGE-* (via injected LLM mock)", () => {
  test("success outcome charges 1 + usedByModel[model] += 1", async () => {
    const { client, handle } = installLlmGatewayMock({
      outcome: "success",
      modelId: "gpt-test",
      text: "hello",
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedPlaygroundModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/playground/chat", {
        method: "POST",
        headers: { ...userAuth("u-ok"), "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(200);
      await drainBody(res);
      expect(handle.callCount()).toBeGreaterThan(0);

      const mm = monthMarker();
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-ok:playground:${mm}` },
        (d) => !!d && (d.usedByModel as Record<string, number>)?.["gpt-test"] === 1,
      );
      expect(bucket?.used).toBe(1);
      expect((bucket?.usedByModel as Record<string, number>)["gpt-test"]).toBe(1);
    } finally {
      await oh.cleanup();
    }
  });

  test("skill_error outcome charges 1", async () => {
    const { client } = installLlmGatewayMock({
      outcome: "skill_error",
      modelId: "gpt-test",
      text: "partial",
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedPlaygroundModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/playground/chat", {
        method: "POST",
        headers: { ...userAuth("u-skillerr"), "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(200);
      await drainBody(res);

      const mm = monthMarker();
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-skillerr:playground:${mm}` },
        (d) => !!d && (d.used as number) === 1,
      );
      expect(bucket?.used).toBe(1);
    } finally {
      await oh.cleanup();
    }
  });

  test("system_error outcome leaves used unchanged (slot released)", async () => {
    const { client } = installLlmGatewayMock({
      outcome: "system_error",
      modelId: "gpt-test",
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedPlaygroundModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/playground/chat", {
        method: "POST",
        headers: { ...userAuth("u-syserr"), "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(200);
      await drainBody(res);

      const mm = monthMarker();
      // Reserve bumped used to 1; system_error releases it back to 0.
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-syserr:playground:${mm}` },
        (d) => !!d && (d.used as number) === 0,
      );
      expect(bucket?.used).toBe(0);
    } finally {
      await oh.cleanup();
    }
  });
});

describe("IT-PLAYGROUND-ABORT", () => {
  test("abort mid-stream releases the reserved slot (used back to baseline)", async () => {
    // Slow the mock stream so the abort lands while the producer is still
    // pumping. Outcome=success, but the client aborts before `finish`.
    const { client } = installLlmGatewayMock({
      outcome: "success",
      modelId: "gpt-test",
      text: "streaming...",
    });
    const oh = await startHarness({ llmClient: client as NyxLlmClient });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedPlaygroundModel(oh.db, "gpt-test");

      const controller = new AbortController();
      const resPromise = oh.app.request("/api/v1/playground/chat", {
        method: "POST",
        headers: { ...userAuth("u-abort"), "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
        signal: controller.signal,
      });

      const res = await resPromise;
      expect(res.status).toBe(200);
      // Begin draining, then abort mid-stream.
      const reader = res.body?.getReader();
      // Read the first chunk (the stream-open pad frame) then abort.
      await reader?.read().catch(() => {});
      controller.abort();
      await reader?.cancel().catch(() => {});

      const mm = monthMarker();
      // The producer's abort handler closes the writer; its `finally`
      // charges with outcome=system_error → release → used back to 0.
      const bucket = await waitForBucket(
        oh.db,
        { _id: `u-abort:playground:${mm}` },
        (d) => !!d && (d.used as number) === 0,
      );
      expect(bucket?.used).toBe(0);
    } finally {
      await oh.cleanup();
    }
  });
});
