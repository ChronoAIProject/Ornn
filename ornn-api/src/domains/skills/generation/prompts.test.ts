/**
 * Unit tests for the skill-generation prompt builders (#875).
 *
 * Three builders + four system-prompt constants (+ the mode selector,
 * #1242) are pinned here. The
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
  SIMPLE_GENERATION_SYSTEM_PROMPT,
  SIMPLE_MODE_RETRY_INSTRUCTION,
  SOURCE_CODE_GENERATION_SYSTEM_PROMPT,
  buildDirectGenerationPrompt,
  buildOpenApiGenerationPrompt,
  buildSourceCodeGenerationPrompt,
  getGenerationSystemPrompt,
} from "./prompts";

describe("buildDirectGenerationPrompt", () => {
  test("defaults to the advanced GENERATION_SYSTEM_PROMPT and embeds the query", () => {
    const out = buildDirectGenerationPrompt("a web screenshot tool");

    expect(out.instructions).toBe(GENERATION_SYSTEM_PROMPT);
    expect(out.userPrompt).toContain("a web screenshot tool");
    // The query is wrapped in the fixed "Generate a skill for:" scaffold.
    expect(out.userPrompt).toContain('Generate a skill for: "a web screenshot tool"');
  });

  test("mode=simple swaps in SIMPLE_GENERATION_SYSTEM_PROMPT, same user scaffold (#1242)", () => {
    const out = buildDirectGenerationPrompt("a web screenshot tool", "simple");
    expect(out.instructions).toBe(SIMPLE_GENERATION_SYSTEM_PROMPT);
    expect(out.userPrompt).toBe('Generate a skill for: "a web screenshot tool"');
  });

  test("mode=advanced is the explicit spelling of the default", () => {
    expect(buildDirectGenerationPrompt("x", "advanced").instructions).toBe(
      GENERATION_SYSTEM_PROMPT,
    );
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
  test("all four are non-empty", () => {
    expect(GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(SIMPLE_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(OPENAPI_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(SOURCE_CODE_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

// ---- Mode-specific prompt contract (#1242) ---------------------------
//
// The simple prompt must not even OFFER the file arrays: the schema block
// the model copies from is the strongest lever we have before server-side
// validation kicks in. The advanced prompt must document every array the
// validator accepts so the model knows references/assets exist.

describe("getGenerationSystemPrompt", () => {
  test("simple → SIMPLE_GENERATION_SYSTEM_PROMPT, advanced → GENERATION_SYSTEM_PROMPT", () => {
    expect(getGenerationSystemPrompt("simple")).toBe(SIMPLE_GENERATION_SYSTEM_PROMPT);
    expect(getGenerationSystemPrompt("advanced")).toBe(GENERATION_SYSTEM_PROMPT);
  });

  test("simple prompt offers no file arrays or runtime fields in its schema", () => {
    // Fields the validator rejects in simple mode must be absent from
    // the JSON SCHEMA block the model copies (they may still be named in
    // the prose that forbids them, so scope the assertion to the block).
    const schemaBlock = SIMPLE_GENERATION_SYSTEM_PROMPT.split("## JSON SCHEMA")[1]!.split("## EXAMPLE")[0]!;
    for (const forbidden of ['"scripts"', '"references"', '"assets"', '"runtimes"', '"dependencies"', '"envVars"', '"outputType"']) {
      expect(schemaBlock).not.toContain(forbidden);
    }
    expect(schemaBlock).toContain('"category": "plain"');
    expect(schemaBlock).toContain('"readmeBody"');
  });

  test("simple prompt states the SKILL.md-only constraint in prose", () => {
    expect(SIMPLE_GENERATION_SYSTEM_PROMPT).toContain("SKILL.md ONLY");
    expect(SIMPLE_GENERATION_SYSTEM_PROMPT).toContain('category is ALWAYS "plain"');
  });

  test("advanced prompt documents references and assets alongside scripts", () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain('"references"');
    expect(GENERATION_SYSTEM_PROMPT).toContain('"assets"');
    expect(GENERATION_SYSTEM_PROMPT).toContain("**references**");
    expect(GENERATION_SYSTEM_PROMPT).toContain("**assets**");
    // Binary assets can't travel through the JSON contract.
    expect(GENERATION_SYSTEM_PROMPT).toContain("TEXT ONLY");
  });

  test("retry instruction names the simple-mode constraint and demands raw JSON", () => {
    expect(SIMPLE_MODE_RETRY_INSTRUCTION).toContain("SIMPLE mode");
    expect(SIMPLE_MODE_RETRY_INSTRUCTION).toContain("Output ONLY valid JSON");
  });
});
