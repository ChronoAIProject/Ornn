/**
 * Tests for #531: PlaygroundChatService must reuse a per-language
 * chrono-sandbox session across tool-use rounds in one chat so
 * installed CLIs, env writes, and filesystem state survive between
 * successive `execute_in_sandbox` tool calls.
 *
 * Scope:
 * - First execute_in_sandbox call creates one session and uses
 *   sessionExecute (NOT the one-shot /execute endpoint).
 * - Same-language follow-up calls hit sessionExecute with the same
 *   session id — no second createSession.
 * - Different-language call creates a second session.
 * - Sessions are cleaned up in the finally block.
 * - createSession failure transparently falls back to one-shot execute
 *   so the playground stays usable even if the session layer is down.
 * - sessionExecute failure drops the stale session and falls back to
 *   one-shot execute for that round.
 */

import { describe, expect, it } from "bun:test";
import { PlaygroundChatService } from "./chatService";
import type {
  CreateSessionParams,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SessionExecuteParams,
  SessionResponse,
} from "../../clients/sandboxClient";
import type {
  NyxLlmClient,
  NyxLlmStreamParams,
  ResponsesApiStreamEvent,
} from "../../clients/nyxid/llm";
import type { SkillService } from "../skills/crud/service";
import type { PlaygroundChatEvent } from "../../shared/types/index";
import { AppError } from "../../shared/types/index";
import { canReadSkill, type ActorContext, type SkillOwnership } from "../skills/crud/authorize";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

function makeToolCallEvents(spec: ToolCallSpec): ResponsesApiStreamEvent[] {
  return [
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: spec.id ?? `call-${spec.name}-${Math.random().toString(36).slice(2, 8)}`,
        call_id: spec.id ?? `call-${spec.name}-${Math.random().toString(36).slice(2, 8)}`,
        name: spec.name,
        arguments: JSON.stringify(spec.args),
      },
    },
  ];
}

const STOP_EVENTS: ResponsesApiStreamEvent[] = [
  { type: "response.output_text.delta", delta: "done" },
];

/** Per-round event sequence — pops on each `.stream()` invocation. */
function makeLlmClient(rounds: ResponsesApiStreamEvent[][]): NyxLlmClient {
  const queue = [...rounds];
  return {
    async *stream(_params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
      const events = queue.shift() ?? STOP_EVENTS;
      for (const e of events) yield e;
    },
    complete: (async () => []) as NyxLlmClient["complete"],
  } as unknown as NyxLlmClient;
}

// #806 — a private skill fixture used to exercise object-level
// authorization on both skill-load paths. The marker string below must
// appear in the package contents and ONLY in the package contents, so a
// "contents leaked?" assertion can grep the transcript for it.
const SECRET_MARKER = "SUPER_SECRET_SKILL_BODY_4f2a";
const PRIVATE_SKILL_FIXTURE: SkillOwnership = {
  createdBy: "owner-1",
  isPrivate: true,
  sharedWithUsers: ["shared-1"],
  sharedWithOrgs: ["org-9"],
};

/**
 * Authz-aware stub: runs the REAL `canReadSkill` against the private
 * fixture and the actor it was handed. Denied → throws the same
 * `skill_not_found` AppError the production service throws; allowed →
 * returns a package whose files embed `SECRET_MARKER`.
 */
const SKILL_SERVICE_STUB: SkillService = {
  getSkillJson: async (_idOrName: string, actor: ActorContext) => {
    if (!canReadSkill(PRIVATE_SKILL_FIXTURE, actor)) {
      throw AppError.notFound("skill_not_found", `Skill '${_idOrName}' not found`);
    }
    return {
      name: "demo-skill",
      description: "",
      version: "1.0",
      metadata: {},
      files: { "SKILL.md": `# demo\n${SECRET_MARKER}` },
    };
  },
} as unknown as SkillService;

const DEFAULTS_RESOLVER = async () => ({
  model: "test-model",
  maxOutputTokens: 256,
  temperature: 0.5,
});

interface SandboxCalls {
  createSession: Array<{ params: CreateSessionParams }>;
  sessionExecute: Array<{ sessionId: string; params: SessionExecuteParams }>;
  execute: Array<{ params: SandboxExecuteParams }>;
  deleteSession: string[];
}

function makeSandboxClient(opts: {
  failCreate?: boolean;
  failSessionExecute?: boolean;
}): { client: NonNullable<unknown>; calls: SandboxCalls } {
  const calls: SandboxCalls = {
    createSession: [],
    sessionExecute: [],
    execute: [],
    deleteSession: [],
  };
  let nextSessionId = 0;
  const okResult: SandboxExecuteResult = {
    success: true,
    output: { stdout: "", stderr: "", exit_code: 0, display_data: [], execution_time_ms: 1 },
  };

  const client = {
    async createSession(params: CreateSessionParams): Promise<SessionResponse> {
      calls.createSession.push({ params });
      if (opts.failCreate) throw new Error("simulated createSession failure");
      const session_id = `sess-${++nextSessionId}`;
      return { session_id, status: "ready", expires_at: Date.now() + 600_000 };
    },
    async sessionExecute(
      sessionId: string,
      params: SessionExecuteParams,
    ): Promise<SandboxExecuteResult> {
      calls.sessionExecute.push({ sessionId, params });
      if (opts.failSessionExecute) throw new Error("simulated sessionExecute failure");
      return okResult;
    },
    async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
      calls.execute.push({ params });
      return okResult;
    },
    async deleteSession(sessionId: string): Promise<void> {
      calls.deleteSession.push(sessionId);
    },
    async *executeStream() { /* unused */ },
    async *sessionExecuteStream() { /* unused */ },
    async listSessions() { return { sessions: [] }; },
  };

  return { client, calls };
}

async function drain(stream: AsyncIterable<PlaygroundChatEvent>): Promise<PlaygroundChatEvent[]> {
  const events: PlaygroundChatEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

function makeService(
  llmRounds: ResponsesApiStreamEvent[][],
  sandbox: ReturnType<typeof makeSandboxClient>,
): PlaygroundChatService {
  return new PlaygroundChatService({
    llmClient: makeLlmClient(llmRounds),
    sandboxClient: sandbox.client as never,
    skillService: SKILL_SERVICE_STUB,
    defaultsResolver: DEFAULTS_RESOLVER,
  });
}

// ---------------------------------------------------------------------------
// #531 — session reuse across same-language sandbox calls
// ---------------------------------------------------------------------------

describe("PlaygroundChatService — sandbox session persistence (#531)", () => {
  it("first execute_in_sandbox call creates one session and uses sessionExecute (not one-shot)", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService(
      [
        makeToolCallEvents({
          name: "execute_in_sandbox",
          args: { script: "console.log('hi')", language: "javascript", dependencies: ["axios"] },
        }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    expect(sandbox.calls.createSession).toHaveLength(1);
    expect(sandbox.calls.createSession[0]!.params).toMatchObject({
      language: "javascript",
      dependencies: ["axios"],
    });
    expect(sandbox.calls.sessionExecute).toHaveLength(1);
    expect(sandbox.calls.sessionExecute[0]!.sessionId).toBe("sess-1");
    expect(sandbox.calls.execute).toHaveLength(0);
  });

  it("two same-language calls reuse one session — only one createSession", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService(
      [
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "step 1", language: "python" } }),
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "step 2", language: "python" } }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    expect(sandbox.calls.createSession).toHaveLength(1);
    expect(sandbox.calls.sessionExecute).toHaveLength(2);
    expect(sandbox.calls.sessionExecute.every((c) => c.sessionId === "sess-1")).toBe(true);
    expect(sandbox.calls.sessionExecute.map((c) => c.params.script)).toEqual(["step 1", "step 2"]);
    expect(sandbox.calls.execute).toHaveLength(0);
  });

  it("different languages get separate sessions", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService(
      [
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "js", language: "javascript" } }),
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "py", language: "python" } }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    expect(sandbox.calls.createSession).toHaveLength(2);
    expect(sandbox.calls.createSession.map((c) => c.params.language)).toEqual(["javascript", "python"]);
    expect(sandbox.calls.sessionExecute).toHaveLength(2);
    expect(sandbox.calls.sessionExecute.map((c) => c.sessionId)).toEqual(["sess-1", "sess-2"]);
  });

  it("sessions are deleted in the finally block at end of chat", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService(
      [
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "x", language: "python" } }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    expect(sandbox.calls.deleteSession).toEqual(["sess-1"]);
  });

  it("createSession failure falls back to one-shot /execute — no crash", async () => {
    const sandbox = makeSandboxClient({ failCreate: true });
    const service = makeService(
      [
        makeToolCallEvents({
          name: "execute_in_sandbox",
          args: { script: "x", language: "javascript", dependencies: ["lodash"] },
        }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    const events = await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    expect(sandbox.calls.createSession).toHaveLength(1);
    expect(sandbox.calls.sessionExecute).toHaveLength(0);
    expect(sandbox.calls.execute).toHaveLength(1);
    expect(sandbox.calls.execute[0]!.params).toMatchObject({
      language: "javascript",
      dependencies: ["lodash"],
      script: "x",
    });
    expect(sandbox.calls.deleteSession).toEqual([]);
    expect(events.some((e) => e.type === "tool-result")).toBe(true);
  });

  it("sessionExecute failure drops the stale session and falls back to one-shot", async () => {
    const sandbox = makeSandboxClient({ failSessionExecute: true });
    const service = makeService(
      [
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "x", language: "python" } }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    expect(sandbox.calls.createSession).toHaveLength(1);
    expect(sandbox.calls.sessionExecute).toHaveLength(1);
    expect(sandbox.calls.execute).toHaveLength(1);
  });

  it("plain (non-sandbox) chats create no sessions", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService([STOP_EVENTS], sandbox);

    await drain(service.chat("u1", { messages: [{ role: "user", content: "hi" }] }));

    expect(sandbox.calls.createSession).toHaveLength(0);
    expect(sandbox.calls.sessionExecute).toHaveLength(0);
    expect(sandbox.calls.execute).toHaveLength(0);
    expect(sandbox.calls.deleteSession).toHaveLength(0);
  });

  it("deleteSession failure does not surface to the caller", async () => {
    const sandbox = makeSandboxClient({});
    // Force deleteSession to throw on the one created session.
    const originalDelete = (sandbox.client as { deleteSession: (id: string) => Promise<void> }).deleteSession;
    (sandbox.client as { deleteSession: (id: string) => Promise<void> }).deleteSession = async (id) => {
      sandbox.calls.deleteSession.push(id);
      throw new Error("simulated delete failure");
    };

    const service = makeService(
      [
        makeToolCallEvents({ name: "execute_in_sandbox", args: { script: "x", language: "python" } }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    // Should complete without throwing despite the delete failure.
    const events = await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));
    expect(events.some((e) => e.type === "finish")).toBe(true);
    expect(sandbox.calls.deleteSession).toEqual(["sess-1"]);
    // Restore in case the test runner shares state.
    (sandbox.client as { deleteSession: (id: string) => Promise<void> }).deleteSession = originalDelete;
  });
});

// ---------------------------------------------------------------------------
// #721 — user-supplied env values must not flow through the LLM
// ---------------------------------------------------------------------------

describe("PlaygroundChatService — env value isolation (#721)", () => {
  it("user-provided envVars override the model's args.env at sandbox-execute time", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService(
      [
        makeToolCallEvents({
          name: "execute_in_sandbox",
          args: {
            script: "print(env)",
            language: "python",
            // Simulate a model that emitted a guessed/leaky value.
            env: { SECRET_TOKEN: "model-guessed-value", PUBLIC_FLAG: "model-set" },
          },
        }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(
      service.chat(
        "u1",
        {
          messages: [{ role: "user", content: "go" }],
          envVars: { SECRET_TOKEN: "REAL_SECRET_FROM_UI" },
        },
      ),
    );

    expect(sandbox.calls.sessionExecute).toHaveLength(1);
    const envSeen = sandbox.calls.sessionExecute[0]!.params.env as Record<string, string>;
    // Real value wins over model-supplied placeholder.
    expect(envSeen.SECRET_TOKEN).toBe("REAL_SECRET_FROM_UI");
    // Keys the user didn't override ride through.
    expect(envSeen.PUBLIC_FLAG).toBe("model-set");
  });

  it("no envVars passed → sandbox env is exactly what the model produced", async () => {
    const sandbox = makeSandboxClient({});
    const service = makeService(
      [
        makeToolCallEvents({
          name: "execute_in_sandbox",
          args: { script: "x", language: "python", env: { MARKER: "test123" } },
        }),
        STOP_EVENTS,
      ],
      sandbox,
    );

    await drain(service.chat("u1", { messages: [{ role: "user", content: "go" }] }));

    const envSeen = sandbox.calls.sessionExecute[0]!.params.env as Record<string, string>;
    expect(envSeen).toEqual({ MARKER: "test123" });
  });
});

// ---------------------------------------------------------------------------
// #806 — object-level authorization (BOLA / OWASP API1) on skill loads.
//
// Two bypass paths must both be gated by the caller's actor:
//   (a) the `request.skillId` developer-message injection
//   (b) the `load_skill` tool call
//
// The stub runs the REAL `canReadSkill` against PRIVATE_SKILL_FIXTURE, so
// these tests exercise the production policy end-to-end through chat().
// ---------------------------------------------------------------------------

const STRANGER: ActorContext = { userId: "stranger", memberships: [], isPlatformAdmin: false };
const OWNER: ActorContext = { userId: "owner-1", memberships: [], isPlatformAdmin: false };
const SHARED_USER: ActorContext = { userId: "shared-1", memberships: [], isPlatformAdmin: false };
const ORG_MEMBER: ActorContext = {
  userId: "someone-else",
  memberships: [{ userId: "org-9", role: "member", displayName: "Org Nine" }],
  isPlatformAdmin: false,
};
const ADMIN: ActorContext = { userId: "admin-1", memberships: [], isPlatformAdmin: true };

/** True if any emitted event's serialized form contains the secret marker. */
function leaksMarker(events: PlaygroundChatEvent[]): boolean {
  return events.some((e) => JSON.stringify(e).includes(SECRET_MARKER));
}

/** Drive a chat over the `request.skillId` injection path for `actor`. */
async function runSkillIdPath(actor: ActorContext): Promise<PlaygroundChatEvent[]> {
  const sandbox = makeSandboxClient({});
  const service = makeService([STOP_EVENTS], sandbox);
  return drain(
    service.chat(
      "u1",
      { messages: [{ role: "user", content: "go" }], skillId: "demo-skill" },
      undefined,
      { actor },
    ),
  );
}

/** Drive a chat that issues a single `load_skill` tool call for `actor`. */
async function runLoadSkillPath(actor: ActorContext): Promise<PlaygroundChatEvent[]> {
  const sandbox = makeSandboxClient({});
  const service = makeService(
    [makeToolCallEvents({ name: "load_skill", args: { skill_id: "demo-skill" } }), STOP_EVENTS],
    sandbox,
  );
  return drain(
    service.chat("u1", { messages: [{ role: "user", content: "load it" }] }, undefined, { actor }),
  );
}

describe("PlaygroundChatService — skill-load authorization (#806)", () => {
  it("(1) stranger via skillId path → error event, NO skill contents injected", async () => {
    const events = await runSkillIdPath(STRANGER);
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain("Failed to load skill");
    expect(events.some((e) => e.type === "finish" && (e as { finishReason?: string }).finishReason === "error")).toBe(true);
    expect(leaksMarker(events)).toBe(false);
  });

  it("(2) stranger via load_skill tool → access-denied tool result, NO contents", async () => {
    const events = await runLoadSkillPath(STRANGER);
    const toolResult = events.find((e) => e.type === "tool-result") as { result: string } | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.result).toContain("Failed to load skill");
    expect(toolResult!.result).not.toContain(SECRET_MARKER);
    expect(leaksMarker(events)).toBe(false);
  });

  it("(3) owner-1 succeeds on both paths", async () => {
    // skillId path: no error event, finishes normally.
    const skillIdEvents = await runSkillIdPath(OWNER);
    expect(skillIdEvents.some((e) => e.type === "error")).toBe(false);
    expect(skillIdEvents.some((e) => e.type === "finish")).toBe(true);
    // load_skill path: tool result carries the package contents.
    const loadEvents = await runLoadSkillPath(OWNER);
    const toolResult = loadEvents.find((e) => e.type === "tool-result") as { result: string } | undefined;
    expect(toolResult!.result).toContain(SECRET_MARKER);
  });

  it("(4) shared-1 (per-user grant) succeeds on both paths", async () => {
    const skillIdEvents = await runSkillIdPath(SHARED_USER);
    expect(skillIdEvents.some((e) => e.type === "error")).toBe(false);
    const loadEvents = await runLoadSkillPath(SHARED_USER);
    const toolResult = loadEvents.find((e) => e.type === "tool-result") as { result: string } | undefined;
    expect(toolResult!.result).toContain(SECRET_MARKER);
  });

  it("(5) org-9 member (per-org grant) succeeds on both paths", async () => {
    const skillIdEvents = await runSkillIdPath(ORG_MEMBER);
    expect(skillIdEvents.some((e) => e.type === "error")).toBe(false);
    const loadEvents = await runLoadSkillPath(ORG_MEMBER);
    const toolResult = loadEvents.find((e) => e.type === "tool-result") as { result: string } | undefined;
    expect(toolResult!.result).toContain(SECRET_MARKER);
  });

  it("(6) platform admin succeeds on both paths", async () => {
    const skillIdEvents = await runSkillIdPath(ADMIN);
    expect(skillIdEvents.some((e) => e.type === "error")).toBe(false);
    const loadEvents = await runLoadSkillPath(ADMIN);
    const toolResult = loadEvents.find((e) => e.type === "tool-result") as { result: string } | undefined;
    expect(toolResult!.result).toContain(SECRET_MARKER);
  });
});
