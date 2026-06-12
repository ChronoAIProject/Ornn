/**
 * Route-level tests for the playground chat routes.
 *
 * Two concerns live here:
 *
 *  1. Rate limit (#809) — pins that `POST /playground/chat` carries the
 *     per-user 20/min limiter (same cap + class as `/skills/generate`).
 *     The limiter's own behaviour (RFC 9239 headers, per-user keying,
 *     window reset) is owned by `middleware/rateLimit.test.ts`; this test
 *     only asserts the limiter is mounted ahead of `validateBody`.
 *
 *  2. Abort-after-billable charging (#766) — the reserve-then-reconcile
 *     quota system (#808) reserves a slot in `checkAllowed` and commits
 *     (success/skill_error) or releases (system_error) in the producer's
 *     `finally`. A client abort yields `finish:"abort"`, which is NOT a
 *     success/skill_error flip, so without #766 the slot was RELEASED even
 *     though the LLM already billed for the streamed tokens — free usage.
 *     The fix marks the run billable on the first non-empty text delta /
 *     tool event and, in `finally`, upgrades a leftover `system_error` to
 *     `skill_error` (commit) so the abused refund path is closed.
 *
 * Harness: the route returns the SSE `Response` synchronously while a
 * background producer pumps `chatService.chat(...)` into the writer and
 * charges in its `finally`. Draining the body via `res.text()` runs the
 * producer to completion; the charge is awaited before the writer fully
 * closes, so the captured `chargeOnCompletion` args are observable right
 * after the drain (a microtask flush is added as a belt-and-braces guard).
 *
 * @module domains/playground/routes.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError, buildProblemJsonBody } from "../../shared/types/index";
import type { PlaygroundChatEvent } from "../../shared/types/index";
import { __resetRateLimitForTests } from "../../middleware/rateLimit";
import { createPlaygroundRoutes, type PlaygroundRoutesConfig } from "./routes";
import type { ChargeOutcome } from "../quota/types";
import type { ModelResolution } from "../settings/llmProviders/service";

// ---------------------------------------------------------------------------
// Rate-limit wiring test (#809)
// ---------------------------------------------------------------------------

function makeRateLimitApp() {
  const app = new Hono();
  // Upstream auth stub. `nyxidAuthMiddleware` + `requirePermission` only
  // READ `c.get("auth")`; the real middleware never overwrites it, so this
  // stub survives into the route chain and satisfies both.
  app.use("*", async (c, next) => {
    c.set(
      "auth" as never,
      { userId: "u1", permissions: ["ornn:playground:use"] } as never,
    );
    await next();
  });

  // Mount the real route. Services are never reached: the 429 fires inside
  // rateLimit, ahead of validateBody, so the empty config is never touched.
  app.route("/", createPlaygroundRoutes({} as unknown as PlaygroundRoutesConfig));

  // Translate AppError → problem+json like the global handler does.
  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body = buildProblemJsonBody({
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        instance: c.req.path,
        requestId: null,
      });
      return c.json(body, err.statusCode as never, {
        "Content-Type": "application/problem+json",
      });
    }
    return c.json({ error: { code: "internal_error", message: String(err) } }, 500);
  });

  return app;
}

describe("POST /playground/chat rate limit (#809)", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("429s the 21st per-user request before validateBody", async () => {
    const app = makeRateLimitApp();
    const req = () =>
      app.request("/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Invalid body — but rateLimit trips before Zod, so the cap is
        // reached on raw request count regardless of body shape.
        body: "{}",
      });

    // Exhaust the 20/min cap.
    for (let i = 0; i < 20; i++) {
      await req();
    }

    // 21st request is denied by the limiter.
    const denied = await req();
    expect(denied.status).toBe(429);
    expect(denied.headers.get("RateLimit-Limit")).toBe("20");
    expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
    expect(denied.headers.get("Retry-After")).not.toBeNull();
    const body = (await denied.json()) as { code: string };
    expect(body.code).toBe("rate_limited");
  });
});

// ---------------------------------------------------------------------------
// Abort-after-billable charging (#766)
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const USE_PERM = "ornn:playground:use";
const MODEL_ID = "resolved-model";

// ---- Event frame helpers (PlaygroundChatEvent shapes) ----------------

function textDelta(delta: string): PlaygroundChatEvent {
  return { type: "text-delta", delta };
}
function toolCall(): PlaygroundChatEvent {
  return { type: "tool-call", toolCall: { id: "tc-1", name: "load_skill", args: {} } };
}
function toolResult(): PlaygroundChatEvent {
  return { type: "tool-result", toolCallId: "tc-1", result: "ok" };
}
function fileOutput(): PlaygroundChatEvent {
  return {
    type: "file-output",
    file: { path: "out.png", content: "data", size: 4, mimeType: "image/png" },
  };
}
function errorEvent(message: string): PlaygroundChatEvent {
  return { type: "error", message };
}
function finish(reason: string): PlaygroundChatEvent {
  return { type: "finish", finishReason: reason };
}

// ---- Fakes -----------------------------------------------------------

interface ChargeCall {
  userId: string;
  permissions: readonly string[] | undefined;
  surface: string;
  outcome: ChargeOutcome;
  modelId: string | null | undefined;
  now: Date;
}

class FakeChatService {
  /** Frames the `chat()` generator yields, in order. */
  frames: PlaygroundChatEvent[] = [];
  chatCalls = 0;

  constructor(frames: PlaygroundChatEvent[]) {
    this.frames = frames;
  }

  // Mirrors the real signature: chat(userId, request, signal, options).
  async *chat(): AsyncGenerator<PlaygroundChatEvent> {
    this.chatCalls += 1;
    for (const f of this.frames) yield f;
  }
}

class FakeQuotaService {
  allowed = true;
  checkAllowedCalls = 0;
  charges: ChargeCall[] = [];

  async checkAllowed(input: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: string;
    now: Date;
  }): Promise<
    | { allowed: true; isAdminBypass: boolean }
    | { allowed: false; isAdminBypass: false; surface: "playground"; message: string }
  > {
    this.checkAllowedCalls += 1;
    void input;
    if (this.allowed) return { allowed: true, isAdminBypass: false };
    return {
      allowed: false,
      isAdminBypass: false,
      surface: "playground",
      message: "Monthly playground quota exhausted",
    };
  }

  async chargeOnCompletion(input: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: string;
    outcome: ChargeOutcome;
    modelId?: string | null;
    now?: Date;
  }): Promise<void> {
    this.charges.push({
      userId: input.userId,
      permissions: input.permissions,
      surface: input.surface,
      outcome: input.outcome,
      modelId: input.modelId,
      now: input.now ?? new Date(0),
    });
  }
}

class FakeLlmProvidersService {
  resolution: ModelResolution = {
    kind: "ok",
    modelId: MODEL_ID,
    displayName: "Resolved Model",
    providerId: "prov-1",
  };

  async resolveModel(): Promise<ModelResolution> {
    return this.resolution;
  }
}

// ---- App builder -----------------------------------------------------

function buildChatApp(
  frames: PlaygroundChatEvent[],
  opts: { permissions?: string[] } = {},
): { app: Hono; quota: FakeQuotaService; chat: FakeChatService } {
  const { permissions = [USE_PERM] } = opts;
  const chat = new FakeChatService(frames);
  const quota = new FakeQuotaService();
  const llmProvidersService = new FakeLlmProvidersService();

  const config = {
    chatService: chat,
    quotaService: quota,
    llmProvidersService,
    keepAliveIntervalMsResolver: async () => 15_000,
  } as unknown as PlaygroundRoutesConfig;

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, { userId: USER_ID, permissions } as never);
    await next();
  });
  app.route("/", createPlaygroundRoutes(config));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body = buildProblemJsonBody({
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        instance: c.req.path,
        requestId: null,
      });
      return c.json(body, err.statusCode as never, {
        "Content-Type": "application/problem+json",
      });
    }
    return c.json({ error: { code: "internal_error", message: String(err) } }, 500);
  });

  return { app, quota, chat };
}

/** Yield the event loop a few turns so the producer's post-close charge
 *  microtasks settle before assertions, independent of body-drain timing. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/** Drive the route + drain the SSE body so the background producer runs
 *  its `finally` (which charges) to completion. */
async function runChat(app: Hono): Promise<void> {
  const res = await app.request("/playground/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
  expect(res.status).toBe(200);
  await res.text(); // drain — runs the producer to completion
  await flushAsync();
}

describe("POST /playground/chat abort-after-billable charging (#766)", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  // -- Criterion 1: billable output then abort → COMMIT (skill_error) --

  test("non-empty text-delta then finish:abort charges skill_error (commit)", async () => {
    const { app, quota, chat } = buildChatApp([
      textDelta("partial answer"),
      finish("abort"),
    ]);
    await runChat(app);

    expect(chat.chatCalls).toBe(1);
    expect(quota.checkAllowedCalls).toBe(1);
    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("skill_error");
    expect(quota.charges[0]!.modelId).toBe(MODEL_ID);
    expect(quota.charges[0]!.userId).toBe(USER_ID);
    expect(quota.charges[0]!.permissions).toEqual([USE_PERM]);
  });

  test("tool-result then finish:abort charges skill_error (commit)", async () => {
    // tool-result already flips outcome to skill_error directly; the abort
    // doesn't undo it. This pins that a tool-side abort still commits.
    const { app, quota } = buildChatApp([toolResult(), finish("abort")]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("skill_error");
  });

  test("tool-call then finish:abort charges skill_error (commit)", async () => {
    // A tool-call (no tool-result) leaves outcome at system_error, but the
    // run is billable — #766 upgrades it to skill_error on abort.
    const { app, quota } = buildChatApp([toolCall(), finish("abort")]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("skill_error");
  });

  test("file-output then finish:abort charges skill_error (commit)", async () => {
    const { app, quota } = buildChatApp([fileOutput(), finish("abort")]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("skill_error");
  });

  // -- Criterion 2: no billable output then error/abort → RELEASE --

  test("error + finish:error with no billable event charges system_error (release)", async () => {
    const { app, quota } = buildChatApp([
      errorEvent("LLM gateway 502"),
      finish("error"),
    ]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("system_error");
  });

  test("error + finish:abort with no prior delta still charges system_error (release)", async () => {
    const { app, quota } = buildChatApp([
      errorEvent("Request aborted"),
      finish("abort"),
    ]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("system_error");
  });

  // -- Criterion 3: clean completion → SUCCESS --

  test("text-delta then finish:stop charges success", async () => {
    const { app, quota } = buildChatApp([
      textDelta("full answer"),
      finish("stop"),
    ]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("success");
  });

  test("tool-call → tool-result → text-delta → finish:stop charges success (success wins)", async () => {
    // tool-result flips to skill_error mid-stream; a clean finish:stop must
    // override it. success > interim skill_error.
    const { app, quota } = buildChatApp([
      toolCall(),
      toolResult(),
      textDelta("done"),
      finish("stop"),
    ]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("success");
  });

  // -- Empty-stream guard: empty delta then abort → still release --

  test("single empty-string text-delta then finish:abort holds at system_error (release)", async () => {
    // An empty text-delta is a no-op flush, not billable output; the slot
    // must still be refunded on abort.
    const { app, quota } = buildChatApp([textDelta(""), finish("abort")]);
    await runChat(app);

    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("system_error");
  });

  // -- Exactly-once: one charge + one reserve per request --

  test("charges exactly once and reserves exactly once per request", async () => {
    const { app, quota } = buildChatApp([
      textDelta("x"),
      finish("stop"),
    ]);
    await runChat(app);

    expect(quota.checkAllowedCalls).toBe(1);
    expect(quota.charges).toHaveLength(1);
  });
});
