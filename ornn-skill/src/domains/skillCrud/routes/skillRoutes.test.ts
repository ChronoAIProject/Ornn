import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import pino from "pino";
import { createSkillRoutes } from "./skillRoutes";
import { createErrorHandler, AppError } from "ornn-shared";

const silentLogger = pino({ level: "silent" });
const errorHandler = createErrorHandler(silentLogger);
import type { ISkillService } from "../services/skillService";
import type { SkillDetail, SkillSummary } from "../types/api";

function mockSkillDetail(overrides: Partial<SkillDetail> = {}): SkillDetail {
  return {
    id: "id-1",
    name: "test-skill",
    description: "desc",
    authorName: "author",
    category: "util",
    tags: [],
    latestVersion: "1",
    downloadCount: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    license: null,
    repoUrl: null,
    latestVersionDetail: {
      id: "v-1",
      version: "1",
      downloadCount: 0,
      fileSize: 1024,
      createdAt: "2026-01-01",
      readmeMd: null,
      fileHash: "abc",
    },
    versions: [],
    ...overrides,
  };
}

let app: Hono;
let mockService: ISkillService;

beforeEach(() => {
  mockService = {
    listSkills: async () => ({ skills: [], total: 0 }),
    getSkill: async () => mockSkillDetail(),
    createSkill: async () => mockSkillDetail(),
    updateSkill: async () => mockSkillDetail(),
    deleteSkill: async () => {},
  };
  app = new Hono();
  app.onError(errorHandler);
  app.route("/api", createSkillRoutes(mockService));
});

describe("Skill Routes", () => {
  test("GET /api/skills - returns list", async () => {
    const summary: SkillSummary = {
      id: "id-1",
      name: "s",
      description: "d",
      authorName: "a",
      category: "c",
      tags: [],
      latestVersion: "1",
      downloadCount: 0,
      createdAt: "",
      updatedAt: "",
    };
    mockService.listSkills = async () => ({ skills: [summary], total: 1 });

    const res = await app.request("/api/skills");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.meta.total).toBe(1);
  });

  test("GET /api/skills/:id - returns detail", async () => {
    const res = await app.request("/api/skills/id-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("test-skill");
  });

  test("GET /api/skills/:id - 404 for missing", async () => {
    mockService.getSkill = async () => {
      throw AppError.notFound("SKILL_NOT_FOUND", "Not found");
    };

    const res = await app.request("/api/skills/nope");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("SKILL_NOT_FOUND");
  });

  test("PUT /api/skills/:id - updates skill", async () => {
    const updated = mockSkillDetail({ description: "new desc" });
    mockService.updateSkill = async () => updated;

    const res = await app.request("/api/skills/id-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "new desc" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.description).toBe("new desc");
  });

  test("DELETE /api/skills/:id - returns 204", async () => {
    const res = await app.request("/api/skills/id-1", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("DELETE /api/skills/:id - 404 for missing", async () => {
    mockService.deleteSkill = async () => {
      throw AppError.notFound("SKILL_NOT_FOUND", "Not found");
    };

    const res = await app.request("/api/skills/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
