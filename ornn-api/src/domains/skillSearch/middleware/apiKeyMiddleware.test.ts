import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import pino from "pino";
import { createApiKeyMiddleware, getApiKeyUser } from "./apiKeyMiddleware";
import type { IAuthClient } from "../../../clients/authClient";
import { createErrorHandler } from "../../../shared/types/index";

const silentLogger = pino({ level: "silent" });
const errorHandler = createErrorHandler(silentLogger);

// ============================================================================
// Mock Factory
// ============================================================================

function createMockApiKeyService(): IAuthClient {
  return {
    validateApiKey: mock(async () => null),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("apiKeyMiddleware", () => {
  let apiKeyService: ReturnType<typeof createMockApiKeyService>;
  let app: Hono;

  beforeEach(() => {
    apiKeyService = createMockApiKeyService();
    app = new Hono();
    app.onError(errorHandler);

    const middleware = createApiKeyMiddleware(apiKeyService);
    app.use("/api/*", middleware);

    app.get("/api/test", (c) => {
      const user = c.get("apiKeyUser");
      return c.json({ userId: user?.userId });
    });
  });

  test("noAuthHeader_Returns401", async () => {
    const res = await app.request("/api/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("API_001");
  });

  test("invalidFormat_Returns401", async () => {
    const res = await app.request("/api/test", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("API_001");
  });

  test("invalidKey_Returns401", async () => {
    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer sk_invalidkey12345678901234567890" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("API_001");
  });

  test("revokedKey_Returns403", async () => {
    (apiKeyService.validateApiKey as any).mockResolvedValue({
      userId: "user123",
      permissions: ["search:read"],
      status: "revoked",
    });

    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer sk_validkey123456789012345678901234" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("API_002");
  });

  test("validKey_SetsContext", async () => {
    (apiKeyService.validateApiKey as any).mockResolvedValue({
      userId: "user123",
      permissions: ["search:read"],
      status: "active",
    });

    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer sk_validkey123456789012345678901234" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user123");
  });
});

describe("getApiKeyUser", () => {
  test("noContext_ThrowsError", () => {
    const mockContext = { get: () => undefined };
    expect(() => getApiKeyUser(mockContext as any)).toThrow();
  });

  test("hasContext_ReturnsInfo", () => {
    const mockInfo = { userId: "user123", permissions: ["search:read"], status: "active" as const };
    const mockContext = { get: () => mockInfo };
    const result = getApiKeyUser(mockContext as any);
    expect(result).toEqual(mockInfo);
  });
});
