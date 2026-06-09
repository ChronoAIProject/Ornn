/**
 * Unit tests for the skill-generation prompt builders (#875).
 *
 * Three builders + three system-prompt constants are pinned here. The
 * assertions are STRUCTURAL — they check that each conditional fragment
 * is present when (and only when) its option is supplied, plus the
 * fixed scaffolding the downstream parser / LLM relies on. We do NOT
 * snapshot the whole literal so prose edits don't break the test.
 *
 * @module domains/skills/generation/prompts.test
 */

import { describe, expect, test } from "bun:test";
import {
  GENERATION_SYSTEM_PROMPT,
  OPENAPI_GENERATION_SYSTEM_PROMPT,
  SOURCE_CODE_GENERATION_SYSTEM_PROMPT,
  buildDirectGenerationPrompt,
  buildOpenApiGenerationPrompt,
  buildSourceCodeGenerationPrompt,
} from "./prompts";

describe("buildDirectGenerationPrompt", () => {
  test("uses GENERATION_SYSTEM_PROMPT as instructions and embeds the query", () => {
    const out = buildDirectGenerationPrompt("a web screenshot tool");

    expect(out.instructions).toBe(GENERATION_SYSTEM_PROMPT);
    expect(out.userPrompt).toContain("a web screenshot tool");
    // The query is wrapped in the fixed "Generate a skill for:" scaffold.
    expect(out.userPrompt).toContain('Generate a skill for: "a web screenshot tool"');
  });

  test("preserves an empty query without leaking placeholder tokens", () => {
    const out = buildDirectGenerationPrompt("");
    expect(out.userPrompt).toBe('Generate a skill for: ""');
    expect(out.userPrompt).not.toContain("${");
  });
});

describe("buildOpenApiGenerationPrompt", () => {
  const SPEC = '{"openapi":"3.0.0","info":{"title":"Demo"}}';
  const ENDPOINTS_FRAGMENT = "Focus ONLY on these endpoints:";
  const DESCRIPTION_FRAGMENT = "Additional context:";

  test("no options — neither endpoints nor description fragment", () => {
    const out = buildOpenApiGenerationPrompt(SPEC);
    expect(out).toContain(SPEC);
    expect(out).toContain("Generate a PLAIN API reference skill");
    expect(out).not.toContain(ENDPOINTS_FRAGMENT);
    expect(out).not.toContain(DESCRIPTION_FRAGMENT);
  });

  test("endpoints only — endpoints fragment present, description absent", () => {
    const out = buildOpenApiGenerationPrompt(SPEC, {
      endpoints: ["GET /users", "POST /users"],
    });
    expect(out).toContain(`${ENDPOINTS_FRAGMENT} GET /users, POST /users`);
    expect(out).not.toContain(DESCRIPTION_FRAGMENT);
  });

  test("description only — description fragment present, endpoints absent", () => {
    const out = buildOpenApiGenerationPrompt(SPEC, {
      description: "internal billing API",
    });
    expect(out).toContain(`${DESCRIPTION_FRAGMENT} internal billing API`);
    expect(out).not.toContain(ENDPOINTS_FRAGMENT);
  });

  test("both — both fragments present", () => {
    const out = buildOpenApiGenerationPrompt(SPEC, {
      endpoints: ["GET /ping"],
      description: "health checks only",
    });
    expect(out).toContain(`${ENDPOINTS_FRAGMENT} GET /ping`);
    expect(out).toContain(`${DESCRIPTION_FRAGMENT} health checks only`);
  });

  test("empty endpoints array does NOT emit the endpoints fragment", () => {
    const out = buildOpenApiGenerationPrompt(SPEC, { endpoints: [] });
    expect(out).not.toContain(ENDPOINTS_FRAGMENT);
  });
});

describe("buildSourceCodeGenerationPrompt", () => {
  const CODE = "// FILE: src/routes.ts\napp.get('/x', h);";
  const FRAMEWORK_FRAGMENT = "Detected framework hint:";
  const SOURCE_URL_FRAGMENT = "Source URL (for context only";
  const DESCRIPTION_FRAGMENT = "Additional context:";

  test("no options — only the SOURCE CODE fence wraps the code", () => {
    const out = buildSourceCodeGenerationPrompt(CODE);
    expect(out).toContain("--- SOURCE CODE ---");
    expect(out).toContain("--- END SOURCE CODE ---");
    expect(out).toContain(CODE);
    expect(out).not.toContain(FRAMEWORK_FRAGMENT);
    expect(out).not.toContain(SOURCE_URL_FRAGMENT);
    expect(out).not.toContain(DESCRIPTION_FRAGMENT);
  });

  test("framework only", () => {
    const out = buildSourceCodeGenerationPrompt(CODE, { framework: "hono" });
    expect(out).toContain(`${FRAMEWORK_FRAGMENT} hono.`);
    expect(out).not.toContain(SOURCE_URL_FRAGMENT);
    expect(out).not.toContain(DESCRIPTION_FRAGMENT);
  });

  test("sourceUrl only", () => {
    const out = buildSourceCodeGenerationPrompt(CODE, {
      sourceUrl: "https://github.com/acme/api",
    });
    expect(out).toContain("https://github.com/acme/api");
    expect(out).toContain(SOURCE_URL_FRAGMENT);
    expect(out).not.toContain(FRAMEWORK_FRAGMENT);
    expect(out).not.toContain(DESCRIPTION_FRAGMENT);
  });

  test("description only", () => {
    const out = buildSourceCodeGenerationPrompt(CODE, {
      description: "public REST surface",
    });
    expect(out).toContain(`${DESCRIPTION_FRAGMENT} public REST surface`);
    expect(out).not.toContain(FRAMEWORK_FRAGMENT);
    expect(out).not.toContain(SOURCE_URL_FRAGMENT);
  });

  test("all three options — every fragment present and code still fenced", () => {
    const out = buildSourceCodeGenerationPrompt(CODE, {
      framework: "express",
      sourceUrl: "https://github.com/acme/api/tree/main/src",
      description: "v2 endpoints",
    });
    expect(out).toContain(`${FRAMEWORK_FRAGMENT} express.`);
    expect(out).toContain("https://github.com/acme/api/tree/main/src");
    expect(out).toContain(`${DESCRIPTION_FRAGMENT} v2 endpoints`);
    expect(out).toContain("--- SOURCE CODE ---");
    expect(out).toContain(CODE);
    expect(out).toContain("--- END SOURCE CODE ---");
  });
});

describe("system prompt constants", () => {
  test("all three are non-empty", () => {
    expect(GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(OPENAPI_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(SOURCE_CODE_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});
