import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import pino from "pino";
import { createSkillGenerateRoutes } from "./skillGenerateRoutes";
import { createErrorHandler } from "ornn-shared";
import type { ISkillGenerationService } from "../services/skillGenerationService";

const silentLogger = pino({ level: "silent" });
const errorHandler = createErrorHandler(silentLogger);
import type { TokenVerifier } from "ornn-shared";
import type { SkillStreamEvent } from "../types/streaming";

function createMockGenerationService(): ISkillGenerationService {
  return {
    generate: mock(async () => ({} as any)),
    generateStream: mock(async function* () {} as any),
    generateStreamDirect: mock(async function* (): AsyncIterable<SkillStreamEvent> {
      yield { type: "generation_start" };
      yield { type: "token", content: "test output" };
      yield { type: "generation_complete", raw: '{"name":"test"}' };
    }),
    generateRefinementStream: mock(async function* (): AsyncIterable<SkillStreamEvent> {
      yield { type: "generation_start" };
      yield { type: "token", content: "refined output" };
      yield { type: "generation_complete", raw: '{"name":"test-refined"}' };
    }),
  };
}

function createMockTokenService(): TokenVerifier {
  return {
    verifyAccessToken: mock(async () => ({
      userId: "user-123",
      email: "test@example.com",
      role: "user" as const,
      iat: 0,
      exp: 0,
    })),
  };
}

const VALID_BEARER = "Bearer valid-token";

describe("Skill Generate Routes", () => {
  let app: Hono;
  let mockService: ISkillGenerationService;
  let mockTokenService: TokenVerifier;

  beforeEach(() => {
    mockService = createMockGenerationService();
    mockTokenService = createMockTokenService();
    app = new Hono();
    app.onError(errorHandler);
    app.route("/api", createSkillGenerateRoutes(mockService, mockTokenService));
  });

  describe("auth enforcement", () => {
    test("stream_noAuthHeader_returns401", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Create a skill" }),
      });

      expect(res.status).toBe(401);
    });

    test("refine_noAuthHeader_returns401", async () => {
      const res = await app.request("/api/skills/generate/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationHistory: [],
          instruction: "Add logging",
        }),
      });

      expect(res.status).toBe(401);
    });

    test("stream_invalidToken_returns401", async () => {
      (mockTokenService.verifyAccessToken as any) = mock(async () => {
        throw new Error("Invalid token");
      });

      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify({ query: "Create a skill" }),
      });

      expect(res.status).toBe(401);
    });

    test("stream_malformedAuthHeader_returns401", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic abc123",
        },
        body: JSON.stringify({ query: "Create a skill" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/skills/generate/stream", () => {
    test("validQuery_returns200SSE", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({ query: "Create a PDF parser" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });

    test("missingQuery_returns400", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    test("emptyQuery_returns400", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({ query: "" }),
      });

      expect(res.status).toBe(400);
    });

    test("queryTooLong_returns400", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({ query: "x".repeat(2001) }),
      });

      expect(res.status).toBe(400);
    });

    test("setsCorrectSSEHeaders", async () => {
      const res = await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({ query: "Create a tool" }),
      });

      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    });

    test("callsGenerateStreamDirect", async () => {
      await app.request("/api/skills/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({ query: "Create a skill" }),
      });

      expect(mockService.generateStreamDirect).toHaveBeenCalled();
    });
  });

  describe("POST /api/skills/generate/refine", () => {
    test("validInput_returns200SSE", async () => {
      const res = await app.request("/api/skills/generate/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({
          conversationHistory: [
            { role: "user", content: "Create a skill" },
            { role: "assistant", content: '{"name":"test"}' },
          ],
          instruction: "Add error handling",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });

    test("missingInstruction_returns400", async () => {
      const res = await app.request("/api/skills/generate/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({
          conversationHistory: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    test("emptyInstruction_returns400", async () => {
      const res = await app.request("/api/skills/generate/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({
          conversationHistory: [],
          instruction: "",
        }),
      });

      expect(res.status).toBe(400);
    });

    test("callsGenerateRefinementStream", async () => {
      await app.request("/api/skills/generate/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({
          conversationHistory: [],
          instruction: "Create from scratch",
        }),
      });

      expect(mockService.generateRefinementStream).toHaveBeenCalled();
    });
  });
});
