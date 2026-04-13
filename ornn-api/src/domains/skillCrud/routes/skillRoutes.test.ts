import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import pino from "pino";
import { createSkillRoutes } from "./skillRoutes";
import { createErrorHandler, AppError, type TokenVerifier } from "../../../shared/types/index";
import type { SkillDetailResponse } from "../../../shared/types/index";

const silentLogger = pino({ level: "silent" });
const errorHandler = createErrorHandler(silentLogger);

/** Minimal SkillService shape expected by skillRoutes.ts. */
interface ISkillService {
  createSkill(zipBuffer: Uint8Array, userId: string, options?: Record<string, unknown>): Promise<{ guid: string }>;
  getSkill(idOrName: string): Promise<SkillDetailResponse>;
  updateSkill(guid: string, userId: string, options: Record<string, unknown>): Promise<SkillDetailResponse>;
  deleteSkill(guid: string): Promise<void>;
}

function mockSkillDetail(overrides: Partial<SkillDetailResponse> = {}): SkillDetailResponse {
  return {
    guid: "guid-1",
    name: "test-skill",
    description: "desc",
    license: null,
    compatibility: null,
    metadata: { category: "plain" },
    tags: [],
    skillHash: "abc",
    presignedPackageUrl: "https://example.com/skill.zip",
    isPrivate: true,
    createdBy: "user-1",
    createdOn: "2026-01-01T00:00:00.000Z",
    updatedOn: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockTokenService(): TokenVerifier {
  return {
    verifyAccessToken: mock(async () => ({
      sub: "user-123",
      email: "test@example.com",
      roles: [] as string[],
      permissions: [] as string[],
    })),
  };
}

const VALID_BEARER = "Bearer valid-token";

let app: Hono;
let mockService: ISkillService;
let mockTokenService: TokenVerifier;

beforeEach(() => {
  mockTokenService = createMockTokenService();
  mockService = {
    createSkill: mock(async () => ({ guid: "guid-1" })),
    getSkill: mock(async () => mockSkillDetail()),
    updateSkill: mock(async () => mockSkillDetail()),
    deleteSkill: mock(async () => {}),
  };
  app = new Hono();
  app.onError(errorHandler);
  app.route("/api", createSkillRoutes(mockService as any, mockTokenService));
});

describe("Skill Routes", () => {
  describe("auth enforcement", () => {
    test("GET /api/skills/:id - no auth returns 401", async () => {
      const res = await app.request("/api/skills/guid-1");
      expect(res.status).toBe(401);
    });

    test("PUT /api/skills/:id - no auth returns 401", async () => {
      const res = await app.request("/api/skills/guid-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: false }),
      });
      expect(res.status).toBe(401);
    });

    test("DELETE /api/skills/:id - no auth returns 401", async () => {
      const res = await app.request("/api/skills/guid-1", { method: "DELETE" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/skills/:id", () => {
    test("returns skill detail with valid auth", async () => {
      const res = await app.request("/api/skills/guid-1", {
        headers: { Authorization: VALID_BEARER },
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.name).toBe("test-skill");
    });

    test("returns 404 when skill not found", async () => {
      (mockService.getSkill as any) = mock(async () => {
        throw AppError.notFound("SKILL_NOT_FOUND", "Not found");
      });

      const res = await app.request("/api/skills/nope", {
        headers: { Authorization: VALID_BEARER },
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("SKILL_NOT_FOUND");
    });
  });

  describe("PUT /api/skills/:id", () => {
    test("updates isPrivate with valid auth", async () => {
      const updated = mockSkillDetail({ isPrivate: false });
      (mockService.updateSkill as any) = mock(async () => updated);

      const res = await app.request("/api/skills/guid-1", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({ isPrivate: false }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.isPrivate).toBe(false);
    });

    test("returns 400 when no update data provided", async () => {
      const res = await app.request("/api/skills/guid-1", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: VALID_BEARER,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/skills/:id", () => {
    test("deletes skill and returns success", async () => {
      const res = await app.request("/api/skills/guid-1", {
        method: "DELETE",
        headers: { Authorization: VALID_BEARER },
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.success).toBe(true);
    });

    test("returns 404 when skill not found", async () => {
      (mockService.deleteSkill as any) = mock(async () => {
        throw AppError.notFound("SKILL_NOT_FOUND", "Not found");
      });

      const res = await app.request("/api/skills/nope", {
        method: "DELETE",
        headers: { Authorization: VALID_BEARER },
      });

      expect(res.status).toBe(404);
    });
  });
});
