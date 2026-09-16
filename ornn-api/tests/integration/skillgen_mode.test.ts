/**
 * IT-SKILLGEN-MODE-* — end-to-end contract of the `mode` field on
 * `POST /api/v1/skills/generate` (#1242) through the real Hono app,
 * settings-driven model resolution, quota buckets and the generation
 * service, with only the LLM client injected.
 *
 *   - `mode: "simple"`, model answers with files → `validation_error`
 *     (retrying) → corrective retry via `complete()` carries the
 *     simple-mode instruction → `generation_complete` with the plain
 *     answer → charged once.
 *   - `mode: "simple"`, model answers with files twice → terminal
 *     `error`, no `generation_complete` → still charged once
 *     (skill_error, same as the invalid-JSON retry rule).
 *   - `mode` omitted → advanced: a scripted answer with references /
 *     assets flows straight to `generation_complete`.
 *   - `mode: "bogus"` → 400 `invalid_mode` problem+json, LLM never
 *     called, no bucket row.
 *   - multipart `mode=simple` form field reaches the service.
 *
 * @module tests/integration/skillgen_mode.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { startHarness, type Harness, authHeaders } from "./harness";
import { resetCollections } from "./cleanup";
import { installLlmGatewayMock } from "../mocks/llmGateway";
import type {
  NyxLlmClient,
  NyxLlmCompleteParams,
  ResponsesApiOutput,
} from "../../src/clients/nyxid/llm";
import {
  SIMPLE_GENERATION_SYSTEM_PROMPT,
  SIMPLE_MODE_RETRY_INSTRUCTION,
} from "../../src/domains/skills/generation/prompts";

const buildAuth = (userId: string) =>
  authHeaders({
    userId,
    email: `${userId}@test.invalid`,
    permissions: ["ornn:skill:build"],
  });

/** Plain, SKILL.md-only answer — legal in either mode. */
const PLAIN_JSON = JSON.stringify({
  name: "plain-skill",
  description: "A plain test skill generated for the mode integration test.",
  category: "plain",
  tags: ["test", "integration"],
  readmeBody:
    "This is a generated test skill body long enough to clear the fifty character minimum readme length requirement.",
});

/** Schema-valid answer that carries files — legal in advanced, a violation in simple. */
const SCRIPTED_JSON = JSON.stringify({
  ...JSON.parse(PLAIN_JSON),
  name: "scripted-skill",
  category: "runtime-based",
  outputType: "text",
  runtimes: ["node"],
  dependencies: ["axios"],
  envVars: ["API_KEY"],
  scripts: [{ filename: "main.js", content: "console.log('hi')" }],
  references: [{ filename: "notes.md", content: "# Notes" }],
  assets: [{ filename: "sample.csv", content: "a,b\n1,2" }],
});

/** Seed one provider with a model enabled for the skillGen surface. */
async function seedSkillGenModel(db: Harness["db"], modelId: string): Promise<void> {
  const now = new Date();
  await db.collection("llm_providers").insertOne({
    _id: "prov-skillgen",
    name: "test-provider",
    gatewayUrl: "https://gw.test.invalid",
    modelListUrl: "https://gw.test.invalid/models",
    apiFormat: "responses",
    auth: { kind: "apiKey", apiKeyEnc: "" },
    models: [
      {
        id: modelId,
        displayName: modelId,
        enabledForPlayground: false,
        enabledForSkillGen: true,
        defaultForPlayground: false,
        defaultForSkillGen: true,
        removed: false,
        firstSeenAt: now,
        lastSyncedAt: now,
      },
    ],
    maxOutputTokens: 8192,
    defaultTemperature: 0.7,
    createdAt: now,
    updatedAt: now,
    updatedBy: "test",
  });
}

const monthMarker = () => new Date().toISOString().slice(0, 7);

/** Read the whole SSE body and return the parsed `data:` payloads in order. */
async function readFrames(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  const frames: Array<Record<string, unknown>> = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      frames.push(JSON.parse(payload) as Record<string, unknown>);
    }
  }
  return frames;
}

async function waitForBucket(
  db: Harness["db"],
  id: string,
  predicate: (doc: Record<string, unknown> | null) => boolean,
  { tries = 100, intervalMs = 10 } = {},
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < tries; i++) {
    const doc = (await db.collection("quota_buckets").findOne({ _id: id } as never)) as
      | Record<string, unknown>
      | null;
    if (predicate(doc)) return doc;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return (await db.collection("quota_buckets").findOne({ _id: id } as never)) as
    | Record<string, unknown>
    | null;
}

/**
 * LLM double whose streamed first answer and non-streaming retry answer
 * differ — the gateway mock reuses one `text` for both, but the
 * simple-mode retry contract is exactly "first answer bad, retry good".
 */
function makeClient(streamText: string, retryText: string): {
  client: NyxLlmClient;
  completeCalls: NyxLlmCompleteParams[];
  streamCount: () => number;
} {
  const { client, handle } = installLlmGatewayMock({
    outcome: "success",
    modelId: "gpt-test",
    text: streamText,
  });
  const completeCalls: NyxLlmCompleteParams[] = [];
  const patched = {
    stream: (client as { stream: NyxLlmClient["stream"] }).stream,
    async complete(params: NyxLlmCompleteParams): Promise<ResponsesApiOutput[]> {
      completeCalls.push(params);
      return [{ type: "message", content: [{ type: "output_text", text: retryText }] }];
    },
  };
  return {
    client: patched as unknown as NyxLlmClient,
    completeCalls,
    streamCount: () => handle.callCount(),
  };
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.cleanup();
}, 30_000);

beforeEach(async () => {
  await resetCollections(h.db, ["quota_buckets", "platform_settings", "llm_providers"]);
});

describe("IT-SKILLGEN-MODE-REJECT", () => {
  test("unknown mode → 400 invalid_mode before any LLM call or quota reserve", async () => {
    await seedSkillGenModel(h.db, "gpt-test");
    const res = await h.app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: { ...buildAuth("u-badmode"), "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello", mode: "bogus" }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("invalid_mode");
    expect(body.detail).toContain("simple, advanced");
    const buckets = await h.db
      .collection("quota_buckets")
      .find({ userId: "u-badmode", surface: "skillGen" })
      .toArray();
    expect(buckets.length).toBe(0);
  });
});

describe("IT-SKILLGEN-MODE-SIMPLE (via injected LLM double)", () => {
  test("scripted first answer → corrective retry → plain generation_complete, charged once", async () => {
    const { client, completeCalls } = makeClient(SCRIPTED_JSON, PLAIN_JSON);
    const oh = await startHarness({ llmClient: client });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { ...buildAuth("u-simple-ok"), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "build me a skill", mode: "simple" }),
      });
      expect(res.status).toBe(200);
      const frames = await readFrames(res);
      const types = frames.map((f) => f.type);
      expect(types).toEqual(["generation_start", "token", "validation_error", "generation_complete"]);

      const ve = frames[2]!;
      expect(ve.retrying).toBe(true);
      expect(String(ve.message)).toContain("Simple mode allows SKILL.md only");
      expect(String(ve.message)).toContain("scripts");

      // The delivered package is the plain retry answer, never the scripted one.
      const raw = JSON.parse(String(frames[3]!.raw)) as { name: string; scripts?: unknown[] };
      expect(raw.name).toBe("plain-skill");
      expect(raw.scripts ?? []).toHaveLength(0);

      // Retry carried the simple prompt + the simple-mode instruction.
      expect(completeCalls).toHaveLength(1);
      const input = completeCalls[0]!.input;
      expect(input[0]!.content).toBe(SIMPLE_GENERATION_SYSTEM_PROMPT);
      expect(String(input.at(-1)!.content)).toContain(SIMPLE_MODE_RETRY_INSTRUCTION);

      const bucket = await waitForBucket(
        oh.db,
        `u-simple-ok:skillGen:${monthMarker()}`,
        (d) => !!d && (d.used as number) === 1,
      );
      expect(bucket?.used).toBe(1);
    } finally {
      await oh.cleanup();
    }
  });

  test("scripted answer twice → terminal error, no generation_complete, still charged once", async () => {
    const { client, completeCalls } = makeClient(SCRIPTED_JSON, SCRIPTED_JSON);
    const oh = await startHarness({ llmClient: client });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { ...buildAuth("u-simple-fail"), "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "build me a skill" }], mode: "simple" }),
      });
      expect(res.status).toBe(200);
      const frames = await readFrames(res);
      const types = frames.map((f) => f.type);
      expect(types).toEqual(["generation_start", "token", "validation_error", "error"]);
      expect(String(frames[3]!.message)).toContain("simple mode after retry");
      expect(completeCalls).toHaveLength(1);
      // Multi-turn retry continues the conversation with the offending answer.
      expect(completeCalls[0]!.input.at(-2)).toEqual({ role: "assistant", content: SCRIPTED_JSON });

      // validation_error was emitted → skill_error → the slot is consumed.
      const bucket = await waitForBucket(
        oh.db,
        `u-simple-fail:skillGen:${monthMarker()}`,
        (d) => !!d && (d.used as number) === 1,
      );
      expect(bucket?.used).toBe(1);
    } finally {
      await oh.cleanup();
    }
  });

  test("multipart mode=simple form field reaches the service", async () => {
    const { client, completeCalls, streamCount } = makeClient(PLAIN_JSON, PLAIN_JSON);
    const oh = await startHarness({ llmClient: client });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const form = new FormData();
      form.set("prompt", "build me a skill");
      form.set("mode", "simple");
      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: buildAuth("u-multipart"),
        body: form,
      });
      expect(res.status).toBe(200);
      const frames = await readFrames(res);
      expect(frames.map((f) => f.type)).toEqual(["generation_start", "token", "generation_complete"]);
      expect(streamCount()).toBe(1);
      expect(completeCalls).toHaveLength(0);
    } finally {
      await oh.cleanup();
    }
  });
});

describe("IT-SKILLGEN-MODE-ADVANCED (default)", () => {
  test("omitted mode accepts a scripted answer with references and assets", async () => {
    const { client, completeCalls } = makeClient(SCRIPTED_JSON, PLAIN_JSON);
    const oh = await startHarness({ llmClient: client });
    try {
      await resetCollections(oh.db, ["quota_buckets", "platform_settings", "llm_providers"]);
      await seedSkillGenModel(oh.db, "gpt-test");

      const res = await oh.app.request("/api/v1/skills/generate", {
        method: "POST",
        headers: { ...buildAuth("u-advanced"), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "build me a skill" }),
      });
      expect(res.status).toBe(200);
      const frames = await readFrames(res);
      expect(frames.map((f) => f.type)).toEqual(["generation_start", "token", "generation_complete"]);
      const raw = JSON.parse(String(frames[2]!.raw)) as {
        scripts: unknown[];
        references: unknown[];
        assets: unknown[];
      };
      expect(raw.scripts).toHaveLength(1);
      expect(raw.references).toHaveLength(1);
      expect(raw.assets).toHaveLength(1);
      expect(completeCalls).toHaveLength(0);
    } finally {
      await oh.cleanup();
    }
  });
});
