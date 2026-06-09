/**
 * Route-level tests for the skill-generation routes (#875).
 *
 * Mounts `createGenerationRoutes` on a bare Hono app, stubs the upstream
 * auth context (production wires this via proxyAuthSetup), and supplies
 * hand-rolled fakes for the four collaborators (generationService,
 * quotaService, llmProvidersService, keepAliveIntervalMsResolver). The
 * project onError → RFC 7807 mapping is replicated so thrown AppErrors
 * surface with the right status.
 *
 * SSE responses are drained from `res.text()` and split on "\n\n"; each
 * `data:` line is parsed as JSON. We assert the transport headers
 * (Cache-Control no-cache, X-Accel-Buffering no), the event-type
 * sequence, and the terminal event. Keep-alive cadence is NOT asserted.
 *
 * Charge-outcome matrix (#808/#827): the route derives the quota charge
 * outcome from the emitted event stream —
 *   generation_complete            → "success"
 *   validation_error (no complete) → "skill_error"
 *   only error events              → "system_error"
 * Each case asserts the captured `chargeOnCompletion` args.
 *
 * Preflight order (#808): model resolution runs FIRST. A resolution
 * failure → 503 and `checkAllowed` is NEVER called; resolution ok +
 * quota denied → 429.
 *
 * The rate-limit middleware mounted on POST /skills/generate is reset
 * between tests via its `__resetRateLimitForTests` seam so the
 * per-process bucket can't bleed 429s across cases.
 *
 * @module domains/skills/generation/routes.test
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import JSZip from "jszip";
import { createGenerationRoutes, type GenerationRoutesConfig } from "./routes";
import { __resetRateLimitForTests } from "../../../middleware/rateLimit";
import { buildProblemJsonBody } from "../../../shared/types/index";
import type { SkillStreamEvent } from "../../../shared/types/index";
import type { ChargeOutcome } from "../../quota/types";
import type { ModelResolution } from "../../settings/llmProviders/service";

const BUILD_PERM = "ornn:skill:build";
const USER_ID = "user-1";
const MODEL_ID = "resolved-model";

// ---- SSE stream frame helpers ----------------------------------------

function startEvent(): SkillStreamEvent {
  return { type: "generation_start" };
}
function tokenEvent(content: string): SkillStreamEvent {
  return { type: "token", content };
}
function completeEvent(raw: string): SkillStreamEvent {
  return { type: "generation_complete", raw };
}
function validationErrorEvent(): SkillStreamEvent {
  return { type: "validation_error", message: "Invalid JSON from LLM", retrying: false };
}
function errorEvent(message: string): SkillStreamEvent {
  return { type: "error", message };
}

/** Default happy stream: start → token → complete. */
function happyFrames(): SkillStreamEvent[] {
  return [startEvent(), tokenEvent("{}"), completeEvent('{"name":"x"}')];
}

// ---- Fakes -----------------------------------------------------------

interface ChargeCall {
  userId: string;
  permissions: readonly string[] | undefined;
  surface: string;
  outcome: ChargeOutcome;
  modelId: string;
  now: Date;
}

class FakeGenerationService {
  /** Frames every generate* method yields, in order. */
  frames: SkillStreamEvent[] = happyFrames();
  generateStreamCalls: Array<{ query: string; modelOverride: string | undefined }> = [];
  fromOpenApiCalls: Array<{ spec: string }> = [];
  fromSourceCalls: Array<{
    code: string;
    framework: string | undefined;
    sourceUrl: string | undefined;
  }> = [];
  withHistoryCalls: Array<{ messages: unknown[] }> = [];

  private async *emit(): AsyncIterable<SkillStreamEvent> {
    for (const f of this.frames) yield f;
  }

  generateStream(
    query: string,
    _signal?: AbortSignal,
    modelOverride?: string,
  ): AsyncIterable<SkillStreamEvent> {
    this.generateStreamCalls.push({ query, modelOverride });
    return this.emit();
  }

  generateStreamWithHistory(
    messages: unknown[],
  ): AsyncIterable<SkillStreamEvent> {
    this.withHistoryCalls.push({ messages });
    return this.emit();
  }

  generateFromOpenApi(spec: string): AsyncIterable<SkillStreamEvent> {
    this.fromOpenApiCalls.push({ spec });
    return this.emit();
  }

  generateFromSource(
    code: string,
    options?: { framework?: string; sourceUrl?: string },
  ): AsyncIterable<SkillStreamEvent> {
    this.fromSourceCalls.push({
      code,
      framework: options?.framework,
      sourceUrl: options?.sourceUrl,
    });
    return this.emit();
  }
}

class FakeQuotaService {
  allowed = true;
  checkAllowedCalls = 0;
  checkAllowedArgs: Array<{ permissions: readonly string[] | undefined }> = [];
  charges: ChargeCall[] = [];

  async checkAllowed(input: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: string;
    now: Date;
  }): Promise<
    | { allowed: true; isAdminBypass: boolean }
    | { allowed: false; isAdminBypass: false; surface: "skillGen"; message: string }
  > {
    this.checkAllowedCalls += 1;
    this.checkAllowedArgs.push({ permissions: input.permissions });
    if (this.allowed) return { allowed: true, isAdminBypass: false };
    return {
      allowed: false,
      isAdminBypass: false,
      surface: "skillGen",
      message: "Monthly skill-generation quota exhausted",
    };
  }

  async chargeOnCompletion(input: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: string;
    outcome: ChargeOutcome;
    modelId: string;
    now: Date;
  }): Promise<void> {
    this.charges.push({
      userId: input.userId,
      permissions: input.permissions,
      surface: input.surface,
      outcome: input.outcome,
      modelId: input.modelId,
      now: input.now,
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
  resolveModelCalls = 0;
  resolveModelArgs: Array<{ surface: string; requested: string | undefined }> = [];

  async resolveModel(params: {
    surface: string;
    requested?: string;
  }): Promise<ModelResolution> {
    this.resolveModelCalls += 1;
    this.resolveModelArgs.push({ surface: params.surface, requested: params.requested });
    return this.resolution;
  }
}

// ---- App builder -----------------------------------------------------

interface BuildOpts {
  permissions?: string[];
  keepAliveResolver?: () => Promise<number>;
}

function buildApp(
  fakes: {
    generationService?: FakeGenerationService;
    quotaService?: FakeQuotaService;
    llmProvidersService?: FakeLlmProvidersService;
  } = {},
  opts: BuildOpts = {},
): {
  app: Hono;
  generationService: FakeGenerationService;
  quotaService: FakeQuotaService;
  llmProvidersService: FakeLlmProvidersService;
} {
  const { permissions = [BUILD_PERM], keepAliveResolver } = opts;
  const generationService = fakes.generationService ?? new FakeGenerationService();
  const quotaService = fakes.quotaService ?? new FakeQuotaService();
  const llmProvidersService =
    fakes.llmProvidersService ?? new FakeLlmProvidersService();

  const config: GenerationRoutesConfig = {
    generationService: generationService as unknown as GenerationRoutesConfig["generationService"],
    quotaService: quotaService as unknown as GenerationRoutesConfig["quotaService"],
    llmProvidersService:
      llmProvidersService as unknown as GenerationRoutesConfig["llmProvidersService"],
    keepAliveIntervalMsResolver: keepAliveResolver ?? (async () => 15_000),
  };

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, {
      userId: USER_ID,
      email: `${USER_ID}@test.local`,
      displayName: USER_ID,
      roles: [],
      permissions,
    } as never);
    await next();
  });
  app.route("/api/v1", createGenerationRoutes(config));
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const body = buildProblemJsonBody({
      statusCode: status,
      code,
      message: err.message,
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, status as never, {
      "Content-Type": "application/problem+json",
    });
  });

  return { app, generationService, quotaService, llmProvidersService };
}

// ---- SSE parsing helper ----------------------------------------------

interface ParsedSse {
  events: Array<Record<string, unknown>>;
  types: string[];
}

async function parseSse(res: Response): Promise<ParsedSse> {
  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue; // keep-alive frames carry empty data
      try {
        events.push(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        // ignore non-JSON data lines
      }
    }
  }
  return { events, types: events.map((e) => String(e.type)) };
}

// ---- Test lifecycle --------------------------------------------------

beforeEach(() => __resetRateLimitForTests());
afterEach(() => __resetRateLimitForTests());

// ---- Transport + happy path ------------------------------------------

describe("POST /skills/generate — transport + happy path", () => {
  it("streams SSE with no-cache + no-buffering headers", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "make a thing" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("emits start → token → complete and threads the resolved model", async () => {
    const { app, generationService } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "make a thing" }),
    });
    const { types } = await parseSse(res);
    expect(types).toEqual(["generation_start", "token", "generation_complete"]);
    expect(generationService.generateStreamCalls[0]!.modelOverride).toBe(MODEL_ID);
  });

  it("handles a multi-turn messages[] body", async () => {
    const gen = new FakeGenerationService();
    const { app } = buildApp({ generationService: gen });
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const { types } = await parseSse(res);
    expect(types).toContain("generation_complete");
    expect(gen.withHistoryCalls).toHaveLength(1);
  });
});

// ---- Charge-outcome matrix (#808/#827) -------------------------------

describe("POST /skills/generate — charge-outcome matrix", () => {
  it("generation_complete charges outcome=success", async () => {
    const quota = new FakeQuotaService();
    const { app } = buildApp({ quotaService: quota });
    await parseSse(
      await app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "p" }),
      }),
    );
    expect(quota.charges).toHaveLength(1);
    expect(quota.charges[0]!.outcome).toBe("success");
    expect(quota.charges[0]!.modelId).toBe(MODEL_ID);
    expect(quota.charges[0]!.userId).toBe(USER_ID);
    expect(quota.charges[0]!.now).toBeInstanceOf(Date);
    // The auth context's permissions flow into BOTH quota gates — a
    // regression dropping the field on either call would pass silently.
    expect(quota.charges[0]!.permissions).toEqual([BUILD_PERM]);
    expect(quota.checkAllowedArgs[0]!.permissions).toEqual([BUILD_PERM]);
  });

  it("validation_error without complete charges outcome=skill_error", async () => {
    const gen = new FakeGenerationService();
    gen.frames = [startEvent(), validationErrorEvent()];
    const quota = new FakeQuotaService();
    const { app } = buildApp({ generationService: gen, quotaService: quota });
    await parseSse(
      await app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "p" }),
      }),
    );
    expect(quota.charges[0]!.outcome).toBe("skill_error");
  });

  it("only error events charge outcome=system_error", async () => {
    const gen = new FakeGenerationService();
    gen.frames = [startEvent(), errorEvent("LLM error: gateway 502")];
    const quota = new FakeQuotaService();
    const { app } = buildApp({ generationService: gen, quotaService: quota });
    await parseSse(
      await app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "p" }),
      }),
    );
    expect(quota.charges[0]!.outcome).toBe("system_error");
  });
});

// ---- Preflight order (#808) ------------------------------------------

describe("POST /skills/generate — preflight order", () => {
  it("model resolution failure → 503 and checkAllowed is NEVER called", async () => {
    const providers = new FakeLlmProvidersService();
    providers.resolution = { kind: "no-models-enabled", surface: "skillGen" };
    const quota = new FakeQuotaService();
    const { app } = buildApp({
      llmProvidersService: providers,
      quotaService: quota,
    });
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "p" }),
    });
    expect(res.status).toBe(503);
    expect(quota.checkAllowedCalls).toBe(0);
    expect(quota.charges).toHaveLength(0);
  });

  it("resolution ok + quota denied → 429", async () => {
    const quota = new FakeQuotaService();
    quota.allowed = false;
    const { app } = buildApp({ quotaService: quota });
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "p" }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("quota_exceeded");
    // No charge when the slot was never reserved.
    expect(quota.charges).toHaveLength(0);
  });
});

// ---- Validation cases ------------------------------------------------

describe("POST /skills/generate — validation", () => {
  it("rejects a message that exceeds the content cap", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "x".repeat(32_001) }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("content_too_long");
  });

  it("rejects a prompt that exceeds the content cap", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(32_001) }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("prompt_too_long");
  });

  it("rejects a missing prompt", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_prompt");
  });

  it("rejects malformed JSON with invalid_body", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_body");
  });

  it("rejects a top-level array body with 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_body");
  });

  it("rejects an unsupported content-type with 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "prompt=hi",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_content_type");
  });

  it("rejects when the caller lacks ornn:skill:build", async () => {
    const { app } = buildApp({}, { permissions: [] });
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "p" }),
    });
    expect(res.status).toBe(403);
  });
});

// ---- Multipart ------------------------------------------------------

describe("POST /skills/generate — multipart", () => {
  async function makeZip(): Promise<Blob> {
    const zip = new JSZip();
    zip.file("SKILL.md", "# Demo\nA demo skill package. DISTINCTIVE_SKILL_MARKER_42");
    zip.file("scripts/main.js", "console.log('hi');");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    return new Blob([bytes as unknown as BlobPart], { type: "application/zip" });
  }

  it("accepts a multipart prompt + ZIP package + modelId field", async () => {
    const gen = new FakeGenerationService();
    const providers = new FakeLlmProvidersService();
    const { app } = buildApp({ generationService: gen, llmProvidersService: providers });
    const form = new FormData();
    form.set("prompt", "improve this skill");
    form.set("modelId", "picked-model");
    form.set("package", await makeZip(), "skill.zip");

    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    const { types } = await parseSse(res);
    expect(types).toContain("generation_complete");
    // The modelId form field is read and threaded into model resolution.
    expect(providers.resolveModelArgs[0]!.requested).toBe("picked-model");
    // The resolved model id is what the generator is told to use.
    expect(gen.generateStreamCalls[0]!.modelOverride).toBe(MODEL_ID);
    // The package content is folded into the query.
    const query = gen.generateStreamCalls[0]!.query;
    expect(query).toContain("improve this skill");
    // analyzePackageContent → "Existing skill package content:" prefix
    // branch: the SKILL.md from the ZIP must be threaded into the query.
    expect(query).toContain("Existing skill package content:");
    expect(query).toContain("DISTINCTIVE_SKILL_MARKER_42");
  });

  it("rejects multipart with a missing prompt", async () => {
    const { app } = buildApp();
    const form = new FormData();
    form.set("modelId", "x");

    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_prompt");
  });
});

// ---- from-source -----------------------------------------------------

describe("POST /skills/generate/from-source", () => {
  it("rejects when neither code nor repoUrl is supplied", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate/from-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_source");
  });

  it("rejects ambiguous code + repoUrl", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate/from-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "app.get('/x', h)",
        repoUrl: "https://github.com/acme/api",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AMBIGUOUS_SOURCE");
  });

  it("rejects empty inline source", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate/from-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "   \n  " }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("empty_source");
  });

  it("streams generation for inline code", async () => {
    const gen = new FakeGenerationService();
    const { app } = buildApp({ generationService: gen });
    const res = await app.request("/api/v1/skills/generate/from-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "app.get('/x', h)", framework: "hono" }),
    });
    expect(res.status).toBe(200);
    const { types } = await parseSse(res);
    expect(types).toContain("generation_complete");
    expect(gen.fromSourceCalls[0]!.code).toContain("app.get('/x', h)");
    expect(gen.fromSourceCalls[0]!.framework).toBe("hono");
  });

  it("maps a repo fetch failure to repo_fetch_failed", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;
    try {
      const { app } = buildApp();
      const res = await app.request("/api/v1/skills/generate/from-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoUrl: "https://github.com/acme/api" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("repo_fetch_failed");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ---- from-openapi ----------------------------------------------------

describe("POST /skills/generate/from-openapi", () => {
  it("streams generation for a valid spec", async () => {
    const gen = new FakeGenerationService();
    const { app } = buildApp({ generationService: gen });
    const res = await app.request("/api/v1/skills/generate/from-openapi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: '{"openapi":"3.0.0"}' }),
    });
    expect(res.status).toBe(200);
    const { types } = await parseSse(res);
    expect(types).toContain("generation_complete");
    expect(gen.fromOpenApiCalls[0]!.spec).toContain("openapi");
  });

  it("rejects a missing spec with 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/skills/generate/from-openapi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ---- Keep-alive fallback --------------------------------------------

describe("keep-alive resolution fallback", () => {
  it("falls back to the 15s default when the resolver throws", async () => {
    const { app } = buildApp(
      {},
      {
        keepAliveResolver: async () => {
          throw new Error("settings read failed");
        },
      },
    );
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "p" }),
    });
    // The stream still completes — a thrown resolver does not break the request.
    expect(res.status).toBe(200);
    const { types } = await parseSse(res);
    expect(types).toContain("generation_complete");
  });

  it("falls back to the 15s default when the resolver returns 0 / NaN", async () => {
    const { app } = buildApp({}, { keepAliveResolver: async () => 0 });
    const res = await app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "p" }),
    });
    expect(res.status).toBe(200);
    const { types } = await parseSse(res);
    expect(types).toContain("generation_complete");
  });
});
