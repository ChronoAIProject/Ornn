/**
 * Tests for the skill-format routes — focus on the JSON Schema
 * publishing endpoint added in #464. The rules + validate endpoints
 * are exercised end-to-end elsewhere; this file pins the wire shape
 * IDEs and schemastore.org rely on.
 *
 * @module domains/skills/format/routes.test
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createFormatRoutes,
  SKILL_MANIFEST_JSON_SCHEMA,
  SKILL_MANIFEST_SCHEMA_VERSION,
} from "./routes";
import type { SkillService } from "../crud/service";

function fakeSkillService(): SkillService {
  // Format routes only need `validateZipFormat`. The schema endpoint
  // never touches the service, so a barely-populated stub is enough.
  return {
    validateZipFormat: async () => [],
  } as unknown as SkillService;
}

function makeApp(): Hono {
  const routes = createFormatRoutes({ skillService: fakeSkillService() });
  const app = new Hono();
  app.route("/api/v1", routes);
  return app;
}

describe("GET /api/v1/skill-manifest-schema.json (#464)", () => {
  test("returns the JSON Schema with application/schema+json content type", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/skill-manifest-schema.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/schema+json");
  });

  test("body is a JSON Schema document at the root (no { data, error } envelope)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/skill-manifest-schema.json");
    const body = (await res.json()) as Record<string, unknown>;
    // Sniff for JSON Schema shape — at minimum it must declare a type
    // and either properties or definitions. The legacy envelope would
    // have `data` + `error` at the root; assert both are absent.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("error");
    expect(body.type).toBe("object");
    expect(body.properties).toBeDefined();
  });

  test("schema declares the canonical SKILL.md frontmatter properties", async () => {
    // Use the in-process constant rather than re-fetching — same source,
    // and keeps the test fast.
    const props = (SKILL_MANIFEST_JSON_SCHEMA as { properties: Record<string, unknown> }).properties;
    expect(props).toBeDefined();
    // Required top-level fields per the canonical frontmatter spec.
    expect(props.name).toBeDefined();
    expect(props.description).toBeDefined();
    expect(props.version).toBeDefined();
    expect(props.metadata).toBeDefined();
  });

  test("schema is cacheable (long-lived Cache-Control)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/skill-manifest-schema.json");
    const cc = res.headers.get("cache-control") ?? "";
    // IDEs / schemastore.org refetch on expiry; the value isn't strict
    // but it MUST be a public, finite-max-age cache directive. Anything
    // missing or `no-store` would hammer the server.
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=\d+/);
  });

  test("SKILL_MANIFEST_SCHEMA_VERSION is set", () => {
    // Schema version is a stable identifier for external tooling
    // (schemastore.org pins to a specific revision). Just sanity-check
    // it's a non-empty string — the value itself is bumped manually.
    expect(typeof SKILL_MANIFEST_SCHEMA_VERSION).toBe("string");
    expect(SKILL_MANIFEST_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});
