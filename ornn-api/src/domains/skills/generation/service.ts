/**
 * Skill generation service using Nyx Provider (Responses API format).
 * Replaces Vercel AI SDK and OpenAI SDK with NyxLlmClient.
 * Streams generation events via SSE. Does NOT auto-persist.
 * @module domains/skills/generation/service
 */

import type { NyxLlmClient, ResponsesApiStreamEvent, ResponsesApiInputMessage } from "../../../clients/nyxid/llm";
import {
  DEFAULT_GENERATION_MODE,
  type GenerationMode,
  type SkillStreamEvent,
} from "../../../shared/types/index";
import {
  buildDirectGenerationPrompt,
  buildOpenApiGenerationPrompt,
  buildSourceCodeGenerationPrompt,
  getGenerationSystemPrompt,
  OPENAPI_GENERATION_SYSTEM_PROMPT,
  SIMPLE_MODE_RETRY_INSTRUCTION,
  SOURCE_CODE_GENERATION_SYSTEM_PROMPT,
} from "./prompts";
import {
  parseGeneratedSkill,
  validateGeneratedSkill,
  type GeneratedSkillValidation,
} from "./validation";
import { createLogger } from "../../../shared/logger";
const logger = createLogger("skillGenerationService");

/** Appended to the user turn when the first answer was not valid JSON. */
const JSON_RETRY_INSTRUCTION =
  "IMPORTANT: Output ONLY valid JSON. No markdown fences. No extra text.";

/**
 * Per-call resolution of LLM defaults from admin settings (`skillGen`
 * section + selected provider's `maxOutputTokens` / `defaultTemperature`).
 * Pulled fresh on every generation so an admin can swap the default
 * provider without a redeploy.
 */
export interface SkillGenLlmDefaults {
  model: string;
  maxOutputTokens: number;
  temperature: number;
}

export type SkillGenLlmDefaultsResolver = () => Promise<SkillGenLlmDefaults>;

export interface GenerationServiceConfig {
  llmClient: NyxLlmClient;
  /**
   * Resolver returning the active LLM defaults for the skill-generation
   * surface. Read on every generate* call. NO env fallback: the route
   * surfaces an explicit error to the caller when settings are missing.
   */
  defaultsResolver: SkillGenLlmDefaultsResolver;
}

/** Resolved per-call LLM parameters shared by every generator. */
interface LlmCallContext {
  model: string;
  defaults: SkillGenLlmDefaults;
}

/**
 * Per-call options for the prompt-driven generators (#1242). Optional
 * members widen with `| undefined` for exactOptionalPropertyTypes (#657).
 */
export interface GenerateOptions {
  signal?: AbortSignal | undefined;
  /** Admin-curated model id; the surface default applies when unset. */
  modelOverride?: string | undefined;
  /** Package shape the caller asked for. Defaults to `advanced`. */
  mode?: GenerationMode | undefined;
}

export class SkillGenerationService {
  private readonly llmClient: NyxLlmClient;
  private readonly defaultsResolver: SkillGenLlmDefaultsResolver;

  constructor(config: GenerationServiceConfig) {
    this.llmClient = config.llmClient;
    this.defaultsResolver = config.defaultsResolver;
  }

  private async resolveDefaults(): Promise<SkillGenLlmDefaults> {
    const d = await this.defaultsResolver();
    if (!d.model || d.model.trim().length === 0) {
      throw new Error(
        "SKILLGEN_LLM_NOT_CONFIGURED: default model not set in /admin/settings/skill-generation",
      );
    }
    return d;
  }

  /**
   * Common preamble for every generator: resolve LLM defaults, honour a
   * pre-aborted signal, and open the stream with `generation_start`.
   * Returns `null` after yielding the terminal `error` event so callers
   * can simply `return`.
   */
  private async *begin(
    signal: AbortSignal | undefined,
    modelOverride: string | undefined,
  ): AsyncGenerator<SkillStreamEvent, LlmCallContext | null> {
    let defaults: SkillGenLlmDefaults;
    try {
      defaults = await this.resolveDefaults();
    } catch (err) {
      yield { type: "error", message: (err as Error).message };
      return null;
    }
    const model = modelOverride ?? defaults.model;
    if (signal?.aborted) {
      yield { type: "error", message: "Request aborted" };
      return null;
    }

    yield { type: "generation_start" };
    return { model, defaults };
  }

  /**
   * Stream one LLM call, yielding `token` events as text arrives.
   * Returns the accumulated text, or `null` after yielding the terminal
   * `error` event (abort mid-stream or provider failure). `logLabel`
   * keeps the per-generator error log lines distinguishable.
   */
  private async *streamLlm(
    input: ResponsesApiInputMessage[],
    ctx: LlmCallContext,
    signal: AbortSignal | undefined,
    logLabel: string,
  ): AsyncGenerator<SkillStreamEvent, string | null> {
    let accumulated = "";

    try {
      const streamEvents = this.llmClient.stream({
        model: ctx.model,
        input,
        max_output_tokens: ctx.defaults.maxOutputTokens,
        temperature: ctx.defaults.temperature,
      });

      for await (const event of streamEvents) {
        if (signal?.aborted) {
          yield { type: "error", message: "Request aborted" };
          return null;
        }

        const text = extractTextFromEvent(event);
        if (text) {
          accumulated += text;
          yield { type: "token", content: text };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, `${logLabel} LLM stream error`);
      yield { type: "error", message: `LLM error: ${message}` };
      return null;
    }

    return accumulated;
  }

  /** Non-streaming completion — used for the single-turn retry. */
  private async completeLlm(
    input: ResponsesApiInputMessage[],
    ctx: LlmCallContext,
  ): Promise<string> {
    const outputs = await this.llmClient.complete({
      model: ctx.model,
      input,
      max_output_tokens: ctx.defaults.maxOutputTokens,
      temperature: ctx.defaults.temperature,
    });

    let text = "";
    for (const output of outputs) {
      if (output.content) {
        for (const part of output.content) {
          if (part.text) text += part.text;
        }
      }
    }
    return text;
  }

  /**
   * Pick the retry instruction that addresses the actual rejection: a
   * simple-mode violation gets the "fold everything into SKILL.md"
   * nudge, anything else the plain "output valid JSON" one.
   */
  private static retryInstructionFor(rejection: GeneratedSkillValidation): string {
    return !rejection.ok && rejection.reason === "mode_violation"
      ? SIMPLE_MODE_RETRY_INSTRUCTION
      : JSON_RETRY_INSTRUCTION;
  }

  /** Terminal `error` message once the retry also failed. */
  private static exhaustedMessageFor(rejection: GeneratedSkillValidation): string {
    return !rejection.ok && rejection.reason === "mode_violation"
      ? "LLM produced advanced materials in simple mode after retry"
      : "LLM produced invalid output after retry";
  }

  /**
   * One non-streaming retry after a rejected answer. Yields the terminal
   * frame — `generation_complete` on success, `error` otherwise — so the
   * caller just returns afterwards.
   */
  private async *retryOnce(
    retryInput: ResponsesApiInputMessage[],
    ctx: LlmCallContext,
    mode: GenerationMode,
    firstRejection: GeneratedSkillValidation,
  ): AsyncGenerator<SkillStreamEvent, void> {
    let retryText: string;
    try {
      retryText = await this.completeLlm(retryInput, ctx);
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      logger.error({ err: msg, mode }, "LLM retry error");
      yield { type: "error", message: `LLM retry error: ${msg}` };
      return;
    }

    const retried = validateGeneratedSkill(retryText, mode);
    if (retried.ok) {
      logger.info({ mode, skillName: retried.skill.name }, "Generation retry passed validation");
      yield { type: "generation_complete", raw: retryText };
      return;
    }

    logger.warn(
      { mode, firstReason: firstRejection.ok ? null : firstRejection.reason, retryReason: retried.reason, violations: retried.violations },
      "Generation retry failed validation",
    );
    yield { type: "error", message: SkillGenerationService.exhaustedMessageFor(retried) };
  }

  /**
   * Direct generation streaming. Streams tokens via SSE events.
   * Uses Nyx Provider Responses API format. `modelOverride` (when set)
   * picks an admin-curated model; otherwise the service-level default
   * applies. `mode` selects the system prompt and the package-shape
   * validation (#1242).
   *
   * Any rejected first answer (invalid JSON, schema failure, or a
   * simple-mode violation) is retried once with a corrective
   * instruction; a second rejection ends the stream with `error` and no
   * `generation_complete`.
   */
  async *generateStream(
    query: string,
    options: GenerateOptions = {},
  ): AsyncIterable<SkillStreamEvent> {
    const { signal, modelOverride } = options;
    const mode = options.mode ?? DEFAULT_GENERATION_MODE;
    const ctx = yield* this.begin(signal, modelOverride);
    if (!ctx) return;

    const { instructions, userPrompt } = buildDirectGenerationPrompt(query, mode);
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: instructions },
      { role: "user", content: userPrompt },
    ];

    const accumulated = yield* this.streamLlm(input, ctx, signal, "direct");
    if (accumulated === null) return;

    const validation = validateGeneratedSkill(accumulated, mode);
    if (validation.ok) {
      yield { type: "generation_complete", raw: accumulated };
      return;
    }

    logger.warn(
      { mode, reason: validation.reason, violations: validation.violations },
      "LLM output failed validation, attempting retry",
    );
    yield { type: "validation_error", message: validation.message, retrying: true };

    if (signal?.aborted) {
      yield { type: "error", message: SkillGenerationService.exhaustedMessageFor(validation) };
      return;
    }

    const retryInput: ResponsesApiInputMessage[] = [
      { role: "developer", content: instructions },
      { role: "user", content: `${userPrompt}\n\n${SkillGenerationService.retryInstructionFor(validation)}` },
    ];
    yield* this.retryOnce(retryInput, ctx, mode, validation);
  }

  /**
   * Multi-turn generation. Converts message history to Responses API format.
   *
   * Unlike the single-turn path this does NOT retry an answer that is
   * merely not valid JSON — a refinement turn may legitimately be prose
   * (the model asking a question), so the raw text is still delivered in
   * `generation_complete` after a `validation_error` with
   * `retrying: false`. The one exception is a simple-mode violation
   * (#1242): the "SKILL.md only" guarantee is load-bearing for agents,
   * so that case gets one corrective retry and ends in `error` if the
   * model still emits files.
   */
  async *generateStreamWithHistory(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options: GenerateOptions = {},
  ): AsyncIterable<SkillStreamEvent> {
    const { signal, modelOverride } = options;
    const mode = options.mode ?? DEFAULT_GENERATION_MODE;
    const ctx = yield* this.begin(signal, modelOverride);
    if (!ctx) return;

    // Put system prompt as developer message in input array (not as instructions)
    // because some LLM providers ignore the instructions field.
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: getGenerationSystemPrompt(mode) },
      ...messages.map((m, i) => {
        if (i === 0 && m.role === "user") {
          return {
            role: "user" as const,
            content: `Generate a skill for: "${m.content}"`,
          };
        }
        return {
          role: m.role === "assistant" ? "assistant" as const : "user" as const,
          content: m.content,
        };
      }),
    ];

    const accumulated = yield* this.streamLlm(input, ctx, signal, "multi-turn");
    if (accumulated === null) return;

    logger.info(
      { mode, accumulatedLength: accumulated.length, first200: accumulated.slice(0, 200), last200: accumulated.slice(-200) },
      "Multi-turn generation accumulated text",
    );

    const validation = validateGeneratedSkill(accumulated, mode);
    if (validation.ok) {
      logger.info({ mode, skillName: validation.skill.name }, "Multi-turn validation passed");
      yield { type: "generation_complete", raw: accumulated };
      return;
    }

    if (validation.reason !== "mode_violation") {
      logger.warn({ mode, reason: validation.reason, first500: accumulated.slice(0, 500) }, "Multi-turn validation failed");
      yield { type: "validation_error", message: validation.message, retrying: false };
      yield { type: "generation_complete", raw: accumulated };
      return;
    }

    logger.warn(
      { mode, violations: validation.violations },
      "Multi-turn output violates simple mode, attempting retry",
    );
    yield { type: "validation_error", message: validation.message, retrying: true };

    if (signal?.aborted) {
      yield { type: "error", message: SkillGenerationService.exhaustedMessageFor(validation) };
      return;
    }

    // Continue the conversation: the offending answer becomes an
    // assistant turn and the corrective instruction the next user turn,
    // so the model rewrites what it just produced rather than starting
    // from the original prompt alone.
    const retryInput: ResponsesApiInputMessage[] = [
      ...input,
      { role: "assistant", content: accumulated },
      { role: "user", content: SIMPLE_MODE_RETRY_INSTRUCTION },
    ];
    yield* this.retryOnce(retryInput, ctx, mode, validation);
  }

  /**
   * Generate a skill from an OpenAPI spec. Streams tokens via SSE events.
   */
  async *generateFromOpenApi(
    specContent: string,
    // exactOptionalPropertyTypes (#657)
    options?: { endpoints?: string[] | undefined; description?: string | undefined },
    signal?: AbortSignal,
    modelOverride?: string,
  ): AsyncIterable<SkillStreamEvent> {
    const ctx = yield* this.begin(signal, modelOverride);
    if (!ctx) return;

    const userPrompt = buildOpenApiGenerationPrompt(specContent, options);
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: OPENAPI_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const accumulated = yield* this.streamLlm(input, ctx, signal, "OpenAPI generation");
    if (accumulated === null) return;

    const parsed = parseGeneratedSkill(accumulated);
    if (!parsed) {
      logger.warn("OpenAPI generation output failed validation");
      yield { type: "validation_error", message: "Invalid JSON from LLM", retrying: false };
    }

    yield { type: "generation_complete", raw: accumulated };
  }

  /**
   * Generate a skill from raw backend source code (route / controller /
   * handler files). Streams tokens via the same SSE event vocabulary as
   * the other generators.
   *
   * `code` is typically a concatenation of several source files, each
   * preceded by a `// FILE: <path>` marker — that's exactly what
   * {@link fetchGithubSourceBundle} produces.
   */
  async *generateFromSource(
    code: string,
    // exactOptionalPropertyTypes (#657)
    options?: {
      framework?: string | undefined;
      description?: string | undefined;
      sourceUrl?: string | undefined;
    },
    signal?: AbortSignal,
    modelOverride?: string,
  ): AsyncIterable<SkillStreamEvent> {
    const ctx = yield* this.begin(signal, modelOverride);
    if (!ctx) return;

    const userPrompt = buildSourceCodeGenerationPrompt(code, options);
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: SOURCE_CODE_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const accumulated = yield* this.streamLlm(input, ctx, signal, "Source-code generation");
    if (accumulated === null) return;

    const parsed = parseGeneratedSkill(accumulated);
    if (!parsed) {
      logger.warn("Source-code generation output failed validation");
      yield { type: "validation_error", message: "Invalid JSON from LLM", retrying: false };
    }

    yield { type: "generation_complete", raw: accumulated };
  }

}

/**
 * Extract text content from a Responses API stream event.
 * Handles response.output_text.delta and response.content_part.delta events.
 */
function extractTextFromEvent(event: ResponsesApiStreamEvent): string | null {
  const eventType = event.type;

  if (eventType === "response.output_text.delta") {
    return (event.delta as string | undefined) ?? null;
  }

  if (eventType === "response.content_part.delta") {
    const delta = event.delta as { type?: unknown; text?: unknown } | undefined;
    if (delta && typeof delta === "object" && delta.type === "output_text" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  return null;
}
