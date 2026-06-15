/**
 * IT-ASST-* — POST /api/v1/assistant/chat route integration (#970).
 *
 * Covers the CONVENTIONS pipeline (auth → validate → model → quota →
 * SSE), the wire-contract SSE framing, and — mandatory — the end-to-end
 * data-safety guarantee that no private skill / PII / secret reaches the
 * streamed context.
 *
 * @module domains/assistant/routes.test
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { buildProblemJsonBody } from "../../shared/types/index";
import type {
  NyxLlmStreamParams,
  ResponsesApiStreamEvent,
} from "../../clients/nyxid/llm";
import type { SkillDocument } from "../../shared/types/index";
import type { ModelResolution } from "../settings/llmProviders/service";
import type { ChargeOutcome } from "../quota/types";
import { AssistantChatService } from "./chatService";
import { ScopedSkillRetriever, type SkillSearchPort } from "./retrieval";
import { createAssistantRoutes } from "./routes";
import type { AssistantChatEvent } from "./types";

const AUTH = {
  userId: "u-caller",
  email: "caller@test.local",
  displayName: "Caller",
  permissions: [] as string[],
};

// ---- fakes -----------------------------------------------------------------

class FakeQuota {
  allow = true;
  charges: Array<{ surface: string; outcome: ChargeOutcome }> = [];
  private chargeResolvers: Array<() => void> = [];
  async checkAllowed(p: { surface: string }) {
    return this.allow
      ? { allowed: true as const, isAdminBypass: false as const }
      : {
          allowed: false as const,
          isAdminBypass: false as const,
          surface: p.surface as never,
          message: "over limit",
        };
  }
  async chargeOnCompletion(p: { surface: string; outcome: ChargeOutcome }) {
    this.charges.push({ surface: p.surface, outcome: p.outcome });
    this.chargeResolvers.splice(0).forEach((r) => r());
  }
  /** Resolves once chargeOnCompletion has been invoked. */
  charged(): Promise<void> {
    if (this.charges.length > 0) return Promise.resolve();
    return new Promise((r) => this.chargeResolvers.push(r));
  }
}

class FakeProviders {
  resolution: ModelResolution = {
    kind: "ok",
    modelId: "m-1",
    displayName: "M1",
    providerId: "p-1",
  };
  async resolveModel(): Promise<ModelResolution> {
    return this.resolution;
  }
}

/** Chat service that yields a fixed event list. */
class FixedChat {
  constructor(private readonly events: AssistantChatEvent[]) {}
  async *chat(): AsyncGenerator<AssistantChatEvent> {
    for (const e of this.events) yield e;
  }
}

function makeApp(opts: {
  withAuth?: boolean;
  chatService: unknown;
  quota?: FakeQuota;
  providers?: FakeProviders;
}) {
  const quota = opts.quota ?? new FakeQuota();
  const providers = opts.providers ?? new FakeProviders();
  const routes = createAssistantRoutes({
    chatService: opts.chatService as never,
    quotaService: quota as never,
    llmProvidersService: providers as never,
    keepAliveIntervalMsResolver: async () => 15_000,
  });
  const app = new Hono();
  if (opts.withAuth !== false) {
    app.use("*", async (c, next) => {
      c.set("auth" as never, AUTH as never);
      await next();
    });
  }
  app.route("/api/v1", routes);
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json(
      buildProblemJsonBody({
        statusCode: status,
        code,
        message: err.message,
        instance: c.req.path,
        requestId: null,
      }),
      status as never,
    );
  });
  return { app, quota, providers };
}

async function postChat(app: Hono, body: unknown) {
  return app.request("/api/v1/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- tests -----------------------------------------------------------------

describe("POST /assistant/chat", () => {
  it("IT-ASST-001: streams chat_start/text_delta/finish with event: + data: framing", async () => {
    const chat = new FixedChat([
      { type: "chat_start", model: "m-1" },
      { type: "chat_text_delta", delta: "Ornn is an API." },
      { type: "chat_finish", usage: { totalTokens: 5 } },
    ]);
    const { app } = makeApp({ chatService: chat });
    const res = await postChat(app, { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: chat_start");
    expect(text).toContain('data: {"type":"chat_start","model":"m-1"}');
    expect(text).toContain("event: chat_text_delta");
    expect(text).toContain("Ornn is an API.");
    expect(text).toContain("event: chat_finish");
  });

  it("IT-ASST-002: charges quota with the assistant surface + success outcome", async () => {
    const chat = new FixedChat([
      { type: "chat_start", model: "m-1" },
      { type: "chat_text_delta", delta: "hello" },
      { type: "chat_finish" },
    ]);
    const quota = new FakeQuota();
    const { app } = makeApp({ chatService: chat, quota });
    const res = await postChat(app, { messages: [{ role: "user", content: "hi" }] });
    await res.text();
    await quota.charged();
    expect(quota.charges).toEqual([{ surface: "assistant", outcome: "success" }]);
  });

  it("IT-ASST-003: 401 when unauthenticated", async () => {
    const { app } = makeApp({ chatService: new FixedChat([]), withAuth: false });
    const res = await postChat(app, { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
  });

  it("IT-ASST-004: 400 on empty messages array", async () => {
    const { app } = makeApp({ chatService: new FixedChat([]) });
    const res = await postChat(app, { messages: [] });
    expect(res.status).toBe(400);
  });

  it("IT-ASST-005: 503 when no model is enabled for the assistant surface", async () => {
    const providers = new FakeProviders();
    providers.resolution = { kind: "no-models-enabled", surface: "assistant" };
    const { app } = makeApp({ chatService: new FixedChat([]), providers });
    const res = await postChat(app, { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(503);
  });

  it("IT-ASST-006: 429 when over quota", async () => {
    const quota = new FakeQuota();
    quota.allow = false;
    const { app } = makeApp({ chatService: new FixedChat([]), quota });
    const res = await postChat(app, { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(429);
  });

  // ---- data-safety through the REAL pipeline -------------------------------

  it("IT-ASST-007: private skill + PII never reach the streamed context", async () => {
    // A fake LLM that echoes the assembled developer grounding back as a
    // text delta. Whatever the model "sees" is what the SSE body carries —
    // so the SSE output IS the assembled context, asserted directly.
    class EchoLlm {
      async *stream(p: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
        const grounding = String(p.input[0]?.content ?? "");
        yield { type: "response.output_text.delta", delta: grounding };
      }
    }

    const publicSkill: SkillDocument = baseSkill({
      guid: "pub",
      name: "public-weather-skill",
      isPrivate: false,
    });
    const privateSkill: SkillDocument = baseSkill({
      guid: "priv",
      name: "TOP-SECRET-private-skill",
      isPrivate: true,
      createdBy: "someone-else",
      createdByEmail: "victim@private.example",
      sharedWithUsers: [],
      sharedWithOrgs: [],
    });

    const search: SkillSearchPort = {
      // Simulate a query-layer that returned BOTH (regression scenario):
      // the projection-layer canReadSkill must still drop the private one.
      async keywordSearch() {
        return { skills: [publicSkill, privateSkill], total: 2 };
      },
    };
    const chatService = new AssistantChatService({
      llmClient: new EchoLlm(),
      kbLoader: { load: () => ({ text: "Ornn KB.", estimatedTokens: 1, budgetTokens: 100, truncated: false }) },
      retriever: new ScopedSkillRetriever({ search }),
      defaultsResolver: async () => ({ model: "m-1", maxOutputTokens: 1000, temperature: 0.3 }),
    });

    const { app } = makeApp({ chatService });
    const res = await postChat(app, {
      messages: [{ role: "user", content: "what skills can I use?" }],
    });
    const body = await res.text();

    // Public skill IS present; private skill + every PII/secret marker is NOT.
    expect(body).toContain("public-weather-skill");
    expect(body).not.toContain("TOP-SECRET-private-skill");
    for (const forbidden of [
      "victim@private.example",
      "author@secret.example",
      "storage/key",
      "sha256:SECRETHASH",
      "someone-else",
    ]) {
      expect(body.includes(forbidden)).toBe(false);
    }
  });
});

function baseSkill(overrides: Partial<SkillDocument>): SkillDocument {
  return {
    guid: "g",
    name: "skill",
    description: "a skill",
    license: null,
    compatibility: null,
    metadata: { category: "misc", tags: ["t"] },
    skillHash: "sha256:SECRETHASH",
    storageKey: "storage/key/zip",
    createdBy: "u-author",
    createdByEmail: "author@secret.example",
    createdByDisplayName: "Author Name",
    createdOn: new Date("2026-01-01T00:00:00.000Z"),
    updatedBy: "u-author",
    updatedOn: new Date("2026-01-01T00:00:00.000Z"),
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0.0",
    ...overrides,
  };
}
