/**
 * Route-level wiring test for the playground chat rate limit (#809).
 *
 * Pins that `POST /playground/chat` carries the per-user 20/min limiter
 * (same cap + class as `/skills/generate`). The limiter's own behaviour
 * (RFC 9239 headers, per-user keying, window reset) is owned by
 * `middleware/rateLimit.test.ts` — this test only asserts the limiter is
 * mounted on this route, ahead of `validateBody`, so the 21st request
 * 429s before Zod and before any LLM cost.
 *
 * @module domains/playground/routes.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError, buildProblemJsonBody } from "../../shared/types/index";
import { __resetRateLimitForTests } from "../../middleware/rateLimit";
import { createPlaygroundRoutes, type PlaygroundRoutesConfig } from "./routes";

function makeApp() {
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
    const app = makeApp();
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
