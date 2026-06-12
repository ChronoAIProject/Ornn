/**
 * Playground chat service with skill loading and sandbox execution.
 * Tools: load_skill, execute_in_sandbox (both auto-executed server-side).
 * When skillId is provided, auto-injects skill context as developer message.
 * Implements a tool-use loop: LLM → tool call → auto-execute → feed result → next round.
 * @module domains/playground/chatService
 */

import type {
  NyxLlmClient,
  ResponsesApiInputMessage,
  ResponsesApiTool,
} from "../../clients/nyxid/llm";
import type {
  SandboxClient,
  SandboxExecuteResult,
} from "../../clients/sandboxClient";
import type { SkillService } from "../skills/crud/service";
import type { PlaygroundChatEvent } from "../../shared/types/index";
import type { ActorContext } from "../skills/crud/authorize";
import { createLogger } from "../../shared/logger";
import { z } from "zod";

const logger = createLogger("playgroundChatService");

/**
 * Zod schemas for the four LLM Responses-API event shapes we
 * consume on the playground stream (#449). `as any` previously
 * propagated unchecked field renames upstream into `undefined`
 * flowing through SSE; with a discriminated union we ignore
 * malformed events explicitly and log them.
 *
 * Schemas are intentionally permissive — only fields we read are
 * required; the upstream API may add fields freely without
 * breaking us.
 */
const textDeltaEventSchema = z.object({
  type: z.literal("response.output_text.delta"),
  delta: z.string(),
});

const contentPartDeltaEventSchema = z.object({
  type: z.literal("response.content_part.delta"),
  delta: z.object({
    type: z.string().optional(),
    text: z.string().optional(),
  }).optional(),
});

const outputItemDoneEventSchema = z.object({
  type: z.literal("response.output_item.done"),
  item: z.object({
    type: z.string().optional(),
    id: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).optional(),
});

const anyKnownEventSchema = z.union([
  textDeltaEventSchema,
  contentPartDeltaEventSchema,
  outputItemDoneEventSchema,
]);

/** Server-side tool-call return shape consumed by the playground stream. */
interface ToolCallResult {
  text: string;
  files: Array<{ path: string; content: string; size: number; mimeType: string }>;
}

/**
 * Translate a thrown error from `sandboxClient.{execute,sessionExecute}`
 * into a user-facing one-liner for the playground transcript (#530).
 *
 * `SandboxClient.post` throws an `Error` whose message is
 * `"Sandbox service error (<status>): <raw body text>"`. The raw body
 * is often an `{ error, error_code, message }` JSON envelope from
 * chrono-sandbox; the legacy formatter spat that JSON straight into
 * the chat. Try to parse the body — if it's the structured envelope
 * we surface a friendly sentence plus an internal-code hint admins
 * can grep on. Otherwise fall back to the raw message so any new
 * upstream shape still makes it to the operator.
 */
function formatSandboxError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/^Sandbox service error \((\d+)\): (.*)$/s);
  if (!match) return `Sandbox execution failed: ${raw}`;
  const status = match[1]!;
  const body = match[2]!;
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      error_code?: number;
      message?: string;
    };
    const codeHint =
      typeof parsed.error_code === "number" ? ` [code ${parsed.error_code}]` : "";
    const summary = parsed.message ?? parsed.error ?? `HTTP ${status}`;
    if (status === "500" || (parsed.error_code === 1006)) {
      return `Sandbox is having trouble running this script${codeHint}. This is usually a transient sandbox-server issue — try again, or simplify the script if it keeps failing.`;
    }
    if (status === "504" || status === "503") {
      return `Sandbox timed out / temporarily unavailable${codeHint}. Try again in a few seconds.`;
    }
    return `Sandbox execution failed (HTTP ${status})${codeHint}: ${summary}`;
  } catch {
    return `Sandbox execution failed (HTTP ${status}): ${body.slice(0, 200)}`;
  }
}

/**
 * Translate a chrono-sandbox `SandboxExecuteResult` (both /execute and
 * /sessions/{id}/execute return this shape) into the {text, files}
 * envelope the playground stream feeds back to the LLM and emits as
 * `file-output` events to the client.
 */
function formatSandboxResult(result: SandboxExecuteResult): ToolCallResult {
  const files = (result.output?.files ?? [])
    .filter((f): f is typeof f & { content: string } => !!f.content && !f.error)
    .map((f) => ({
      path: f.path,
      content: f.content,
      size: f.size ?? 0,
      mimeType: guessMimeType(f.path),
    }));

  const filesSummary = files.length > 0
    ? `\nFiles retrieved: ${files.map((f) => `${f.path} (${f.size} bytes)`).join(", ")}`
    : "";

  const text = result.success
    ? `Execution succeeded (exit code ${result.output?.exit_code}).\nstdout:\n${result.output?.stdout ?? ""}\nstderr:\n${result.output?.stderr ?? ""}${filesSummary}`
    : `Execution failed: ${result.error?.message ?? "unknown error"}\nstdout:\n${result.output?.stdout ?? ""}\nstderr:\n${result.output?.stderr ?? ""}`;

  return { text, files };
}

/** Guess MIME type from file extension. */
function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    svg: "image/svg+xml", webp: "image/webp", pdf: "application/pdf",
    json: "application/json", txt: "text/plain", csv: "text/csv",
    html: "text/html", mp3: "audio/mpeg", mp4: "video/mp4", zip: "application/zip",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

const BASE_SYSTEM_PROMPT = `You are an AI agent in the ornn skill playground. You execute skills on behalf of the user.

IMPORTANT RULES:
1. When the user asks you to run a skill or do something that the loaded skill can do, you MUST call execute_in_sandbox immediately. Do NOT just explain how to run it manually — actually run it.
2. The user has already provided environment variables via the UI. These are included in the skill context under "User-provided Environment Variables". Use them directly in the env parameter of execute_in_sandbox. You are authorized to use these values.
3. For runtime-based skills, you MUST ADAPT the skill's script for the sandbox environment before executing. See SANDBOX RUNTIME below.
4. Include all dependencies from the skill's dependencies/runtime-dependency list.
5. For plain skills (no scripts), just follow the SKILL.md instructions directly using your own LLM reasoning.

SANDBOX RUNTIME CONSTRAINTS:
The sandbox executes code via Jupyter kernels, NOT via Bun or direct Node.js. You MUST adapt scripts:
- Use "javascript" (NOT "typescript") as the language — the sandbox Node/JS kernel supports top-level await and ESM-style code.
- Replace Bun-specific APIs: use fs.writeFileSync() instead of Bun.write(), use fetch() for HTTP.
- Replace process.argv with hardcoded values — pass data via env vars or inline the values.
- For file output: write files to the current directory using fs (require('fs')).
- console.log() output will appear in stdout.
- npm dependencies are auto-installed before execution.

When calling execute_in_sandbox:
- script: the ADAPTED source code (fix Bun APIs, fix top-level await, use Node-compatible APIs)
- language: "javascript" for JS/TS skills, "python" for Python skills
- dependencies: from the skill's dependency list
- env: the user-provided environment variables (already in context)
- output_type: from metadata (text or file)
- retrieve_files: glob patterns for output files (e.g. ["*.png", "*.jpg"])
- timeout_secs: 60 (default, clamped to 1-600)

Be concise. Act, don't explain.`;

export interface PlaygroundMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> | undefined;
  toolCallId?: string | undefined;
}

// Optionals widen to `T | undefined` so the Zod-inferred shape from the
// validated request body assigns cleanly under exactOptionalPropertyTypes
// (#657). The fields are still semantically optional; only the type
// boundary widens.
export interface PlaygroundChatRequest {
  messages: PlaygroundMessage[];
  skillId?: string | undefined;
  envVars?: Record<string, string> | undefined;
  modelId?: string | undefined;
}

/** Tools for the playground agent. */
const PLAYGROUND_TOOLS: ResponsesApiTool[] = [
  {
    type: "function",
    name: "load_skill",
    description: "Load a skill by ID or name. Returns the full skill package as JSON with all file contents.",
    parameters: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "GUID or name of the skill to load" },
      },
      required: ["skill_id"],
    },
  },
  {
    type: "function",
    name: "execute_in_sandbox",
    description: "Execute a script in an isolated sandbox. Pass the full script content, language, dependencies, and env vars. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Full script content to execute" },
        language: {
          type: "string",
          enum: ["python", "javascript", "typescript", "bash", "go", "java"],
          description: "Programming language",
        },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description: "Package dependencies to install (e.g. ['puppeteer@21.0.0', 'axios'])",
        },
        env: {
          type: "object",
          description: "Environment variables as key-value pairs",
        },
        output_type: {
          type: "string",
          enum: ["text", "file"],
          description: "Expected output type. Use 'file' if script produces files.",
        },
        retrieve_files: {
          type: "array",
          items: { type: "string" },
          description: "Glob patterns for files to retrieve (only when output_type='file')",
        },
        input_files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Target path relative to /workspace" },
              content: { type: "string", description: "Base64-encoded file content" },
            },
            required: ["path", "content"],
          },
          description: "Files to inject into the sandbox before execution",
        },
        timeout_secs: {
          type: "number",
          description: "Execution timeout in seconds (1-600, default 60)",
        },
      },
      required: ["script", "language"],
    },
  },
];

/**
 * Per-call resolution of LLM defaults from admin settings (`playground`
 * section + selected provider's `maxOutputTokens` / `defaultTemperature`).
 * Pulled fresh on every chat so an admin can swap the default provider
 * without restarting the pod. Caching is the resolver's responsibility
 * (SettingsService caches with a short TTL).
 */
export interface PlaygroundLlmDefaults {
  /** Default model id when caller does not specify one. */
  model: string;
  maxOutputTokens: number;
  temperature: number;
}

export type PlaygroundLlmDefaultsResolver = () => Promise<PlaygroundLlmDefaults>;

export interface ChatServiceConfig {
  llmClient: NyxLlmClient;
  sandboxClient: SandboxClient;
  skillService: SkillService;
  /**
   * Resolver returning the active LLM defaults for the playground
   * surface. Read on every chat. NO env fallback: invalid resolver
   * output (empty model, non-positive token cap, NaN temperature)
   * surfaces as a 503 to the caller — never falls through to a stale
   * literal.
   */
  defaultsResolver: PlaygroundLlmDefaultsResolver;
}

export class PlaygroundChatService {
  private readonly llmClient: NyxLlmClient;
  private readonly sandboxClient: SandboxClient;
  private readonly skillService: SkillService;
  private readonly defaultsResolver: PlaygroundLlmDefaultsResolver;

  constructor(config: ChatServiceConfig) {
    this.llmClient = config.llmClient;
    this.sandboxClient = config.sandboxClient;
    this.skillService = config.skillService;
    this.defaultsResolver = config.defaultsResolver;
  }

  async *chat(
    userId: string,
    request: PlaygroundChatRequest,
    abortSignal: AbortSignal | undefined,
    options: { modelId?: string; actor: ActorContext },
  ): AsyncGenerator<PlaygroundChatEvent> {
    // #806/#826 — object-level authorization for skill loads. The actor
    // is REQUIRED: every caller (routes + tests) must supply the real
    // caller context. This single actor gates BOTH skill bypass paths
    // below (skillId injection + the load_skill tool).
    const actor = options.actor;
    // Resolve LLM defaults from admin settings on every call so
    // operator updates land without a pod restart.
    let defaults: PlaygroundLlmDefaults;
    try {
      defaults = await this.defaultsResolver();
    } catch (err) {
      logger.error(
        { userId, err: (err as Error).message },
        "Failed to resolve playground LLM defaults from settings",
      );
      yield { type: "error", message: "Playground LLM is not configured. Ask an admin to set the default provider in /admin/settings/playground." };
      yield { type: "finish", finishReason: "error" };
      return;
    }
    if (!defaults.model || defaults.model.trim().length === 0) {
      logger.error({ userId }, "Playground default model is empty in settings");
      yield { type: "error", message: "Playground LLM is not configured. Ask an admin to set the default model in /admin/settings/playground." };
      yield { type: "finish", finishReason: "error" };
      return;
    }
    // Resolved model id (already validated by the route). Falls back
    // to settings default for tests / internal callers that don't
    // go through the model picker.
    const model = options.modelId ?? defaults.model;
    const input = this.buildInput(request);

    // Inject system prompt as developer message (instructions field is ignored by upstream LLM)
    input.unshift({
      role: "developer" as const,
      content: BASE_SYSTEM_PROMPT,
    });

    // Auto-inject skill context if skillId is provided
    if (request.skillId) {
      try {
        const skillJson = await this.skillService.getSkillJson(request.skillId, actor);
        const skillContext = this.buildSkillContext(skillJson, request.envVars);
        input.unshift({
          role: "developer" as const,
          content: skillContext,
        });
        logger.info({ userId, skillId: request.skillId, skillName: skillJson.name }, "Skill context injected");
      } catch (err) {
        logger.error({ userId, skillId: request.skillId, err }, "Failed to load skill for context injection");
        yield { type: "error", message: `Failed to load skill: ${err instanceof Error ? err.message : String(err)}` };
        yield { type: "finish", finishReason: "error" };
        return;
      }
    }

    // Per-chat sandbox session reuse (#531). Same-language tool calls
    // within one chat share a persistent kernel — installed CLIs,
    // filesystem state, and env survive across rounds. Sessions are
    // created lazily on first execute_in_sandbox call and torn down
    // best-effort in `finally`. Keyed by language because chrono-sandbox
    // kernels are per-language; a TS skill and a Python skill in the
    // same chat each get their own session.
    const sandboxSessions = new Map<string, string>();
    const createdSessionIds: string[] = [];

    try {
      // Tool-use loop: stream LLM → if tool call → execute → feed result → stream again
      const MAX_TOOL_ROUNDS = 5;
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        try {
          const streamEvents = this.llmClient.stream({
            model,
            input,
            max_output_tokens: defaults.maxOutputTokens,
            temperature: defaults.temperature,
            tools: PLAYGROUND_TOOLS,
          });

          let pendingToolCall: { id: string; name: string; args: Record<string, unknown> } | null = null;

          for await (const event of streamEvents) {
            if (abortSignal?.aborted) {
              yield { type: "error", message: "Request aborted" };
              yield { type: "finish", finishReason: "abort" };
              return;
            }

            // #449 — parse with a discriminated Zod union instead of
            // `as any`. Unknown event types are ignored (forward-compat
            // with new upstream events); shape-mismatch on a known event
            // logs at debug and is dropped.
            const parsed = anyKnownEventSchema.safeParse(event);
            if (!parsed.success) {
              logger.debug(
                { issues: parsed.error.issues.slice(0, 2) },
                "Unrecognized LLM event shape — dropping",
              );
              continue;
            }
            const parsedEvent = parsed.data;

            // Stream text deltas to client
            if (parsedEvent.type === "response.output_text.delta") {
              yield { type: "text-delta", delta: parsedEvent.delta };
              continue;
            }
            if (parsedEvent.type === "response.content_part.delta") {
              const delta = parsedEvent.delta;
              if (delta?.type === "output_text" && typeof delta.text === "string") {
                yield { type: "text-delta", delta: delta.text };
              }
              continue;
            }

            // Capture complete function call from output_item.done
            // This event contains everything: item.id, item.name, item.arguments
            if (parsedEvent.type === "response.output_item.done") {
              const item = parsedEvent.item;
              if (item?.type === "function_call") {
                const toolName = item.name ?? "";
                const toolCallId = item.call_id ?? item.id ?? "";
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(item.arguments ?? "{}");
                } catch {
                  logger.error({ rawArgs: String(item.arguments).slice(0, 200) }, "Failed to parse function call arguments");
                }
                pendingToolCall = { id: toolCallId, name: toolName, args };
                logger.info({ toolName, toolCallId }, "Tool call received from LLM");
              }
              continue;
            }
          }

          // If no tool call, we're done
          if (!pendingToolCall) {
            yield { type: "finish", finishReason: "stop" };
            return;
          }

          // Auto-execute the tool call server-side
          logger.info({ toolName: pendingToolCall.name, round }, "Auto-executing tool call");
          yield { type: "tool-call", toolCall: pendingToolCall };

          const toolResult = await this.executeToolCall(
            pendingToolCall,
            sandboxSessions,
            createdSessionIds,
            request.envVars,
            actor,
          );
          yield { type: "tool-result", toolCallId: pendingToolCall.id, result: toolResult.text };

          // Emit file outputs if any
          for (const file of toolResult.files) {
            yield { type: "file-output", file };
          }

          // Feed tool result back to LLM for next round
          input.push({
            role: "assistant" as const,
            content: `[Tool call: ${pendingToolCall.name}(${JSON.stringify(pendingToolCall.args)})]`,
          });
          input.push({
            role: "user" as const,
            content: `Tool result for ${pendingToolCall.name}: ${toolResult.text}`,
          });

        } catch (err) {
          logger.error({ userId, err, round }, "Chat stream error");
          yield { type: "error", message: err instanceof Error ? err.message : "Stream failed" };
          yield { type: "finish", finishReason: "error" };
          return;
        }
      }

      yield { type: "finish", finishReason: "stop" };
    } finally {
      // Best-effort session cleanup. chrono-sandbox sessions also
      // expire via ttlSecs, but explicit teardown frees the container
      // immediately. Swallow errors — a leftover session will TTL out.
      if (createdSessionIds.length > 0) {
        await Promise.allSettled(
          createdSessionIds.map(async (sessionId) => {
            try {
              await this.sandboxClient.deleteSession(sessionId);
            } catch (err) {
              logger.warn(
                { sessionId, err: (err as Error).message },
                "Sandbox session delete failed — relying on TTL",
              );
            }
          }),
        );
      }
    }
  }

  /**
   * Execute a tool call server-side. Returns text result and any
   * output files. `sandboxSessions` and `createdSessionIds` are
   * owned by the caller (`chat()`) — per-chat state that lets
   * `execute_in_sandbox` reuse the same chrono-sandbox kernel across
   * tool-use rounds so installed CLIs, env, and filesystem persist
   * (#531).
   */
  private async executeToolCall(
    toolCall: { id: string; name: string; args: Record<string, unknown> },
    sandboxSessions: Map<string, string>,
    createdSessionIds: string[],
    userEnvVars: Record<string, string> | undefined,
    actor: ActorContext,
  ): Promise<ToolCallResult> {
    const { name, args } = toolCall;

    if (name === "execute_in_sandbox") {
      return await this.runSandboxToolCall(
        args,
        sandboxSessions,
        createdSessionIds,
        userEnvVars,
      );
    }

    if (name === "load_skill") {
      try {
        // #806 — gate the load through the caller's actor. A skill the
        // caller can't read throws skill_not_found here, so the tool
        // result below carries the denial string, never the contents.
        const skillJson = await this.skillService.getSkillJson((args.skill_id as string) ?? "", actor);
        return { text: JSON.stringify(skillJson, null, 2), files: [] };
      } catch (err) {
        return { text: `Failed to load skill: ${err instanceof Error ? err.message : String(err)}`, files: [] };
      }
    }

    return { text: `Unknown tool: ${name}`, files: [] };
  }

  /**
   * Dispatch a single `execute_in_sandbox` tool call.
   *
   * Lazily reuses a per-language chrono-sandbox session for the chat —
   * the first call for a language pays the createSession cost (with
   * the LLM-supplied dependency list installed once); subsequent
   * same-language calls hit the persistent kernel and see prior CLI
   * installs, env writes, and filesystem state (#531).
   *
   * Fail-open fallbacks keep one-call behaviour identical to
   * pre-session if session APIs error: createSession failure or
   * sessionExecute failure both retry via the one-shot `/execute`
   * endpoint, log a warning, and (for sessionExecute) drop the stale
   * session id so the next call can recreate.
   */
  private async runSandboxToolCall(
    args: Record<string, unknown>,
    sandboxSessions: Map<string, string>,
    createdSessionIds: string[],
    userEnvVars: Record<string, string> | undefined,
  ): Promise<ToolCallResult> {
    const script = (args.script as string) ?? "";
    const language = (args.language as string) ?? "python";
    const outputType = (args.output_type as "text" | "file") ?? "text";
    // #721 — user-provided env values always win over what the model
    // supplied in `args.env`. Since #721 we no longer feed the actual
    // env *values* into the developer message; the model only sees
    // placeholder shapes (`KEY=<provided-server-side>`) and is told
    // to reference them by name. Here we replace whatever the model
    // emitted with the real values for any key the user supplied,
    // closing the leak path where a chat-completion provider could
    // serialize the tool call as assistant text and echo the env
    // back to the user. Keys the model added that aren't in
    // `userEnvVars` ride through unchanged (the model legitimately
    // sets ad-hoc env like sentinel markers).
    const env: Record<string, string> = {
      ...((args.env as Record<string, string>) ?? {}),
      ...(userEnvVars ?? {}),
    };
    const dependencies = (args.dependencies as string[]) ?? [];
    const retrieveFiles = (args.retrieve_files as string[]) ?? [];
    const inputFiles = (args.input_files as Array<{ path: string; content: string }>) ?? [];
    // #819 — coerce + clamp the model-supplied timeout before it reaches the
    // sandbox client. Computed once here; flows into the session path and both
    // one-shot fallbacks, so this is the single chokepoint for this value.
    // Non-numeric / NaN falls back to the documented 60s default.
    const rawTimeout = Number(args.timeout_secs);
    const timeoutSecs = Number.isFinite(rawTimeout)
      ? Math.min(600, Math.max(1, Math.trunc(rawTimeout)))
      : 60;

    let sessionId = sandboxSessions.get(language);

    if (!sessionId) {
      try {
        const session = await this.sandboxClient.createSession({
          language,
          dependencies,
          env,
          inputFiles,
          // 10 min covers a typical multi-round playground session; the
          // server also bumps last_used_at on each execute, so an
          // active chat won't expire mid-conversation.
          ttlSecs: 600,
          networkEnabled: true,
        });
        sessionId = session.session_id;
        sandboxSessions.set(language, sessionId);
        createdSessionIds.push(sessionId);
        logger.info(
          { language, sessionId, deps: dependencies.length },
          "Sandbox session created for chat",
        );
      } catch (err) {
        logger.warn(
          { language, err: (err as Error).message },
          "createSession failed — falling back to one-shot execute",
        );
        return await this.runSandboxOneShot({
          script, language, outputType, env, dependencies,
          retrieveFiles, inputFiles, timeoutSecs,
        });
      }
    }

    try {
      const result = await this.sandboxClient.sessionExecute(sessionId, {
        script,
        language,
        outputType,
        env,
        inputFiles,
        retrieveFiles,
        timeoutSecs,
      });
      return formatSandboxResult(result);
    } catch (err) {
      logger.warn(
        { sessionId, language, err: (err as Error).message },
        "sessionExecute failed — dropping session and falling back to one-shot",
      );
      sandboxSessions.delete(language);
      return await this.runSandboxOneShot({
        script, language, outputType, env, dependencies,
        retrieveFiles, inputFiles, timeoutSecs,
      });
    }
  }

  /**
   * One-shot fallback path used when session APIs are unavailable.
   * Matches the legacy pre-#531 behaviour exactly so a broken sandbox
   * session layer never makes the playground worse than it was.
   */
  private async runSandboxOneShot(params: {
    script: string;
    language: string;
    outputType: "text" | "file";
    env: Record<string, string>;
    dependencies: string[];
    retrieveFiles: string[];
    inputFiles: Array<{ path: string; content: string }>;
    timeoutSecs: number;
  }): Promise<ToolCallResult> {
    try {
      const result = await this.sandboxClient.execute(params);
      return formatSandboxResult(result);
    } catch (err) {
      logger.error(
        {
          language: params.language,
          scriptLen: params.script.length,
          err: (err as Error).message,
        },
        "Sandbox one-shot execute failed",
      );
      return { text: formatSandboxError(err), files: [] };
    }
  }

  /**
   * Build skill context string for developer message injection.
   */
  private buildSkillContext(
    skillJson: { name: string; description: string; metadata: Record<string, unknown>; files: Record<string, string> },
    envVars?: Record<string, string>,
  ): string {
    const lines: string[] = [
      `## Loaded Skill: ${skillJson.name}`,
      `**Description:** ${skillJson.description}`,
      `**Metadata:** ${JSON.stringify(skillJson.metadata, null, 2)}`,
      "",
    ];

    // Add file contents
    for (const [path, content] of Object.entries(skillJson.files)) {
      lines.push(`### File: ${path}`);
      lines.push("```");
      lines.push(content);
      lines.push("```");
      lines.push("");
    }

    // #721 — list ONLY the env var NAMES the user provided values for,
    // never the values themselves. If the model ever echoes the
    // developer message back (as it can do when chat-completion
    // providers serialize `execute_in_sandbox` to assistant text
    // instead of a structured tool call), the transcript would leak
    // the user's secret. The server-side path (`runSandboxToolCall`)
    // injects the real values into the sandbox env at execution
    // time — the LLM never needs the literal value to issue the
    // tool call.
    if (envVars && Object.keys(envVars).length > 0) {
      lines.push("### User-provided Environment Variables");
      lines.push(
        "The user has supplied values for the variables below. Reference each",
        "by name when constructing `execute_in_sandbox`'s `env` argument —",
        "the runtime will inject the real values server-side. DO NOT attempt to",
        "guess, repeat, or echo the values; you do not have them.",
      );
      for (const key of Object.keys(envVars)) {
        lines.push(`- ${key}=<provided-server-side>`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  private buildInput(request: PlaygroundChatRequest): ResponsesApiInputMessage[] {
    return request.messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "user" as const,
          content: [{ type: "input_text" as const, text: `Tool result: ${msg.content}` }],
        };
      }

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const parts: Array<{ type: "output_text"; text: string }> = [];
        if (msg.content) {
          parts.push({ type: "output_text", text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          parts.push({ type: "output_text", text: `[Tool call: ${tc.name}(${JSON.stringify(tc.args)})]` });
        }
        return { role: "assistant" as const, content: parts };
      }

      if (msg.role === "system") {
        return { role: "developer" as const, content: msg.content };
      }

      return {
        role: (msg.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: msg.content,
      };
    });
  }

}
