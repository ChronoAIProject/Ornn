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
import { Hono } from "hono";
import { startHarness, type Harness, authHeaders } from "./harness";
import { resetCollections } from "./cleanup";
import { installLlmGatewayMock } from "../mocks/llmGateway";
import type { NyxLlmClient } from "../../src/clients/nyxid/llm";
import {
  createPlaygroundRoutes,
  type PlaygroundRoutesConfig,
} from "../../src/domains/playground/routes";
import type { PlaygroundChatEvent } from "../../src/shared/types/index";

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

  test("completed run with dropped unknown error event still charges 1 (playground has no skill_error mapping — see follow-up)", async () => {
    // NOTE: the mock's `skill_error` outcome yields a `response.error` +
    // `response.completed{finishReason:"skill_error"}`, but the playground
    // chat service's event union does not recognize those shapes — they
    // are dropped as unknown events. The run therefore terminates on the
    // service's own `finish{finishReason:"stop"}`, so the route records a
    // SUCCESS-shaped completion. There is no skill_error event path on the
    // playground surface today; this case asserts that a completed run
    // (with the error frame silently dropped) still commits a +1 charge —
    // identical to the success case. Wiring a real playground skill_error
    // outcome is a separate product follow-up, intentionally out of scope.
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
    // `delayMs` parks the mock producer on a real timer between stream
    // events (after `response.created`, before `response.completed`), so
    // the abort below lands deterministically while the generator is
    // suspended mid-stream — by control flow, not back-pressure luck.
    // Outcome would be success, but the client aborts before `finish`.
    const { client } = installLlmGatewayMock({
      outcome: "success",
      modelId: "gpt-test",
      text: "streaming...",
      delayMs: 50,
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

/**
 * IT-PLAYGROUND-RESERVEDAT-THREADING — route-wiring guard (#827).
 *
 * The route captures a single `reservedAt = new Date()` and MUST thread
 * that SAME instant into BOTH `quotaService.checkAllowed({ now })` (reserve)
 * AND `quotaService.chargeOnCompletion({ now })` (commit/release). Without
 * it, a run that straddles a UTC month boundary reserves in one month's
 * bucket and reconciles against another. The route calls `new Date()`
 * internally, so the instant can't be pinned from outside — instead this
 * test stubs the quota service and captures the `now` arg of each call,
 * then asserts they are the SAME `Date` instance. Deleting `now:` from
 * either call site makes that call default to its own `new Date()`, so the
 * two captured instants diverge and this test fails.
 *
 * This is a pure route-wiring unit test (no DB harness): it mounts the real
 * `createPlaygroundRoutes` with stubbed collaborators, mirroring the auth-
 * stub technique in `src/domains/playground/routes.test.ts`. Playground-only
 * is acceptable here — the generation routes have no comparable stub harness
 * (their routes.test mounts the full app), so a mirror is out of scope.
 */
describe("IT-PLAYGROUND-RESERVEDAT-THREADING (route wiring #827)", () => {
  test("checkAllowed and chargeOnCompletion receive the SAME reserve instant", async () => {
    let reserveNow: Date | undefined;
    let chargeNow: Date | undefined;

    const quotaService = {
      checkAllowed: async (params: { now?: Date }) => {
        reserveNow = params.now;
        return { allowed: true, isAdminBypass: false } as const;
      },
      chargeOnCompletion: async (params: { now?: Date }) => {
        chargeNow = params.now;
      },
    };

    const chatService = {
      async *chat(): AsyncGenerator<PlaygroundChatEvent> {
        // Complete cleanly so the route flips outcome to "success" and
        // reaches the `finally` that calls chargeOnCompletion.
        yield { type: "finish", finishReason: "stop" };
      },
    };

    const llmProvidersService = {
      resolveModel: async () => ({
        kind: "ok" as const,
        modelId: "gpt-test",
        displayName: "gpt-test",
        providerId: "prov-test",
      }),
    };

    const config = {
      chatService,
      quotaService,
      llmProvidersService,
      keepAliveIntervalMsResolver: async () => 15_000,
    } as unknown as PlaygroundRoutesConfig;

    const app = new Hono();
    // Upstream auth stub — the real `nyxidAuthMiddleware` only READS
    // `c.get("auth")`, so this survives into the route chain and satisfies
    // both it and `requirePermission`.
    app.use("*", async (c, next) => {
      c.set(
        "auth" as never,
        { userId: "u-thread", permissions: ["ornn:playground:use"] } as never,
      );
      await next();
    });
    app.route("/", createPlaygroundRoutes(config));

    // Route module mounts at `/playground/chat`; the `/api/v1` prefix is
    // added in bootstrap, not here, so request the bare path.
    const res = await app.request("/playground/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    // Drain so the producer's `finally` (chargeOnCompletion) runs.
    await drainBody(res);

    // The charge fires from the producer's `finally` after the stream
    // closes; poll until it's observed rather than racing a fixed sleep.
    for (let i = 0; i < 200 && chargeNow === undefined; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(reserveNow).toBeInstanceOf(Date);
    expect(chargeNow).toBeInstanceOf(Date);
    // Load-bearing: same instant, threaded from the route's single
    // `reservedAt`. Strict identity — dropping `now:` from either call
    // makes one default to its own `new Date()` and breaks this.
    expect(chargeNow).toBe(reserveNow as Date);
    expect((chargeNow as Date).getTime()).toBe((reserveNow as Date).getTime());
  });
});
