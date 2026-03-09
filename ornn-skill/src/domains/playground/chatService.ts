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
  ResponsesApiStreamEvent,
  ResponsesApiTool,
} from "../../clients/nyxLlmClient";
import type { SandboxClient } from "../../clients/sandboxClient";
import type { SkillService } from "../skillCrud/service";
import type { PlaygroundChatEvent } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "playgroundChatService" });

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
- timeout_secs: 120 (default)

Be concise. Act, don't explain.`;

export interface PlaygroundMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolCallId?: string;
}

export interface PlaygroundChatRequest {
  messages: PlaygroundMessage[];
  skillId?: string;
  envVars?: Record<string, string>;
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
        timeout_secs: {
          type: "number",
          description: "Execution timeout in seconds (1-600, default 60)",
        },
      },
      required: ["script", "language"],
    },
  },
];

export interface ChatServiceConfig {
  llmClient: NyxLlmClient;
  sandboxClient: SandboxClient;
  skillService: SkillService;
  defaultModel: string;
  maxOutputTokens: number;
  temperature: number;
}

export class PlaygroundChatService {
  private readonly llmClient: NyxLlmClient;
  private readonly sandboxClient: SandboxClient;
  private readonly skillService: SkillService;
  private readonly defaultModel: string;
  private readonly maxOutputTokens: number;
  private readonly temperature: number;

  constructor(config: ChatServiceConfig) {
    this.llmClient = config.llmClient;
    this.sandboxClient = config.sandboxClient;
    this.skillService = config.skillService;
    this.defaultModel = config.defaultModel;
    this.maxOutputTokens = config.maxOutputTokens;
    this.temperature = config.temperature;
  }

  async *chat(
    userId: string,
    request: PlaygroundChatRequest,
    userToken: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<PlaygroundChatEvent> {
    const input = this.buildInput(request);

    // Inject system prompt as developer message (instructions field is ignored by upstream LLM)
    input.unshift({
      role: "developer" as const,
      content: BASE_SYSTEM_PROMPT,
    });

    // Auto-inject skill context if skillId is provided
    if (request.skillId) {
      try {
        const skillJson = await this.skillService.getSkillJson(request.skillId);
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

    // Tool-use loop: stream LLM → if tool call → execute → feed result → stream again
    const MAX_TOOL_ROUNDS = 5;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      try {
        const streamEvents = this.llmClient.stream({
          model: this.defaultModel,
          input,
          max_output_tokens: this.maxOutputTokens,
          temperature: this.temperature,
          tools: PLAYGROUND_TOOLS,
          userToken,
        });

        let pendingToolCall: { id: string; name: string; args: Record<string, unknown> } | null = null;

        for await (const event of streamEvents) {
          if (abortSignal?.aborted) {
            yield { type: "error", message: "Request aborted" };
            yield { type: "finish", finishReason: "abort" };
            return;
          }

          const eventType = (event as any).type;

          // Stream text deltas to client
          if (eventType === "response.output_text.delta") {
            const delta = (event as any).delta;
            if (typeof delta === "string") yield { type: "text-delta", delta };
            continue;
          }
          if (eventType === "response.content_part.delta") {
            const delta = (event as any).delta;
            if (delta?.type === "output_text" && typeof delta.text === "string") {
              yield { type: "text-delta", delta: delta.text };
            }
            continue;
          }

          // Capture complete function call from output_item.done
          // This event contains everything: item.id, item.name, item.arguments
          if (eventType === "response.output_item.done") {
            const item = (event as any).item;
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

        const toolResult = await this.executeToolCall(pendingToolCall);
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
  }

  /**
   * Execute a tool call server-side. Returns text result and any output files.
   */
  private async executeToolCall(
    toolCall: { id: string; name: string; args: Record<string, unknown> },
  ): Promise<{ text: string; files: Array<{ path: string; content: string; size: number; mimeType: string }> }> {
    const { name, args } = toolCall;
    const noFiles: Array<{ path: string; content: string; size: number; mimeType: string }> = [];

    if (name === "execute_in_sandbox") {
      try {
        const result = await this.sandboxClient.execute({
          script: (args.script as string) ?? "",
          language: (args.language as string) ?? "python",
          outputType: (args.output_type as "text" | "file") ?? "text",
          env: (args.env as Record<string, string>) ?? {},
          dependencies: (args.dependencies as string[]) ?? [],
          retrieveFiles: (args.retrieve_files as string[]) ?? [],
          timeoutSecs: (args.timeout_secs as number) ?? 120,
        });

        // Extract retrieved files
        const files = (result.output?.files ?? [])
          .filter((f) => f.content && !f.error)
          .map((f) => ({
            path: f.path,
            content: f.content, // base64
            size: f.size,
            mimeType: guessMimeType(f.path),
          }));

        const filesSummary = files.length > 0
          ? `\nFiles retrieved: ${files.map((f) => `${f.path} (${f.size} bytes)`).join(", ")}`
          : "";

        const text = result.success
          ? `Execution succeeded (exit code ${result.output?.exit_code}).\nstdout:\n${result.output?.stdout ?? ""}\nstderr:\n${result.output?.stderr ?? ""}${filesSummary}`
          : `Execution failed: ${result.error?.message ?? "unknown error"}\nstdout:\n${result.output?.stdout ?? ""}\nstderr:\n${result.output?.stderr ?? ""}`;

        return { text, files };
      } catch (err) {
        return { text: `Sandbox execution failed: ${err instanceof Error ? err.message : String(err)}`, files: noFiles };
      }
    }

    if (name === "load_skill") {
      try {
        const skillJson = await this.skillService.getSkillJson((args.skill_id as string) ?? "");
        return { text: JSON.stringify(skillJson, null, 2), files: noFiles };
      } catch (err) {
        return { text: `Failed to load skill: ${err instanceof Error ? err.message : String(err)}`, files: noFiles };
      }
    }

    return { text: `Unknown tool: ${name}`, files: noFiles };
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

    // Add user-provided env vars
    if (envVars && Object.keys(envVars).length > 0) {
      lines.push("### User-provided Environment Variables");
      for (const [key, value] of Object.entries(envVars)) {
        lines.push(`- ${key}=${value}`);
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
