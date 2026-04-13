import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createGenerationRoutes } from "../routes";
import type { SkillStreamEvent } from "../types/streaming";
import type { SkillGenerationService } from "../service";

/**
 * Error handler that recognises AppError from both shared/types and nyxidAuth
 * (the latter has its own inlined class so instanceof checks differ).
 */
function errorHandler(err: Error, c: any) {
  const statusCode = (err as any).statusCode;
  const code = (err as any).code ?? "INTERNAL_ERROR";
  if (typeof statusCode === "number") {
    return c.json({ data: null, error: { code, message: err.message } }, statusCode);
  }
  return c.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
}

/** Minimal interface matching what createGenerationRoutes expects. */
interface ISkillGenerationService {
  generateStream(query: string, signal?: AbortSignal): AsyncIterable<SkillStreamEvent>;
  generateStreamWithHistory(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    signal?: AbortSignal,
  ): AsyncIterable<SkillStreamEvent>;
}

function createMockGenerationService(): ISkillGenerationService {
  return {
    generateStream: mock(async function* (): AsyncIterable<SkillStreamEvent> {
      yield { type: "generation_start" };
      yield { type: "token", content: "test output" };
      yield { type: "generation_complete", raw: '{"name":"test"}' };
    }),
    generateStreamWithHistory: mock(async function* (): AsyncIterable<SkillStreamEvent> {
      yield { type: "generation_start" };
      yield { type: "token", content: "multi-turn output" };
      yield { type: "generation_complete", raw: '{"name":"test-refined"}' };
    }),
  };
}

/** Auth context injected by a test setup middleware (simulating nyxid auth setup). */
function createAuthSetupMiddleware(authenticated = true, permissions: string[] = ["ornn:skill:build"]) {
  return async (c: any, next: () => Promise<void>) => {
    if (authenticated) {
      c.set("auth", {
        userId: "user-123",
        email: "test@example.com",
        roles: [],
        permissions,
      });
    }
    await next();
  };
}

describe("Skill Generate Routes", () => {
  let app: Hono;
  let mockService: ISkillGenerationService;

  beforeEach(() => {
    mockService = createMockGenerationService();
    app = new Hono();
    app.onError(errorHandler);
    // Inject auth context before routing (simulates nyxid auth setup middleware)
    app.use("*", createAuthSetupMiddleware(true));
    app.route(
      "/api",
      createGenerationRoutes({
        generationService: mockService as unknown as SkillGenerationService,
        keepAliveIntervalMs: 60_000,
      }),
    );
  });

  describe("auth enforcement", () => {
    test("generate_noAuth_returns401", async () => {
      const unauthApp = new Hono();
      unauthApp.onError(errorHandler);
      // No auth setup middleware — auth context is absent
      unauthApp.route(
        "/api",
        createGenerationRoutes({
          generationService: mockService as unknown as SkillGenerationService,
          keepAliveIntervalMs: 60_000,
        }),
      );

      const res = await unauthApp.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Create a skill" }),
      });

      expect(res.status).toBe(401);
    });

    test("generate_missingPermission_returns403", async () => {
      const noPermApp = new Hono();
      noPermApp.onError(errorHandler);
      // Auth set but without ornn:skill:build permission
      noPermApp.use("*", createAuthSetupMiddleware(true, []));
      noPermApp.route(
        "/api",
        createGenerationRoutes({
          generationService: mockService as unknown as SkillGenerationService,
          keepAliveIntervalMs: 60_000,
        }),
      );

      const res = await noPermApp.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Create a skill" }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/skills/generate", () => {
    test("validJsonPrompt_returns200SSE", async () => {
      const res = await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Create a PDF parser" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });

    test("missingPrompt_returns400", async () => {
      const res = await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    test("emptyPrompt_returns400", async () => {
      const res = await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "" }),
      });

      expect(res.status).toBe(400);
    });

    test("invalidContentType_returns400", async () => {
      const res = await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "Create a skill",
      });

      expect(res.status).toBe(400);
    });

    test("setsCorrectSSEHeaders", async () => {
      const res = await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Create a tool" }),
      });

      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    });

    test("callsGenerateStream", async () => {
      await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Create a skill" }),
      });

      expect(mockService.generateStream).toHaveBeenCalled();
    });

    test("messagesArray_callsGenerateStreamWithHistory", async () => {
      await app.request("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "Create a skill" },
          ],
        }),
      });

      expect(mockService.generateStreamWithHistory).toHaveBeenCalled();
    });
  });
});
