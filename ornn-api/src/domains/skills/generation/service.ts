/**
 * Skill generation service using Nyx Provider (Responses API format).
 * Replaces Vercel AI SDK and OpenAI SDK with NyxLlmClient.
 * Streams generation events via SSE. Does NOT auto-persist.
 * @module domains/skills/generation/service
 */

import type { NyxLlmClient, ResponsesApiStreamEvent, ResponsesApiInputMessage } from "../../../clients/nyxid/llm";
import type { GeneratedSkill, SkillStreamEvent } from "../../../shared/types/index";
import {
  buildDirectGenerationPrompt,
  buildOpenApiGenerationPrompt,
  buildSourceCodeGenerationPrompt,
  GENERATION_SYSTEM_PROMPT,
  OPENAPI_GENERATION_SYSTEM_PROMPT,
  SOURCE_CODE_GENERATION_SYSTEM_PROMPT,
} from "./prompts";
import { parseGeneratedSkill } from "./validation";
import { createLogger } from "../../../shared/logger";
const logger = createLogger("skillGenerationService");

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
   * Direct generation streaming. Streams tokens via SSE events.
   * Uses Nyx Provider Responses API format. `modelOverride` (when set)
   * picks an admin-curated model; otherwise the service-level default
   * applies.
   */
  async *generateStream(
    query: string,
    signal?: AbortSignal,
    modelOverride?: string,
  ): AsyncIterable<SkillStreamEvent> {
    const ctx = yield* this.begin(signal, modelOverride);
    if (!ctx) return;

    const { userPrompt } = buildDirectGenerationPrompt(query);
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: GENERATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const accumulated = yield* this.streamLlm(input, ctx, signal, "direct");
    if (accumulated === null) return;

    // Validate the accumulated output
    const parsed = this.parseAndValidate(accumulated);
    if (!parsed) {
      logger.warn("LLM output failed validation, attempting retry");
      yield { type: "validation_error", message: "Invalid JSON from LLM", retrying: true };

      // Retry with non-streaming complete call
      if (!signal?.aborted) {
        try {
          const retryInput: ResponsesApiInputMessage[] = [
            { role: "developer", content: GENERATION_SYSTEM_PROMPT },
            { role: "user", content: `${userPrompt}\n\nIMPORTANT: Output ONLY valid JSON. No markdown fences. No extra text.` },
          ];

          const retryText = await this.completeLlm(retryInput, ctx);

          const retryParsed = this.parseAndValidate(retryText);
          if (retryParsed) {
            yield { type: "generation_complete", raw: retryText };
            return;
          }
        } catch (retryErr) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          logger.error({ err: msg }, "LLM retry error");
          yield { type: "error", message: `LLM retry error: ${msg}` };
          return;
        }
      }

      yield { type: "error", message: "LLM produced invalid output after retry" };
      return;
    }

    yield { type: "generation_complete", raw: accumulated };
  }

  /**
   * Multi-turn generation. Converts message history to Responses API format.
   */
  async *generateStreamWithHistory(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    signal?: AbortSignal,
    modelOverride?: string,
  ): AsyncIterable<SkillStreamEvent> {
    const ctx = yield* this.begin(signal, modelOverride);
    if (!ctx) return;

    // Put system prompt as developer message in input array (not as instructions)
    // because some LLM providers ignore the instructions field.
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: GENERATION_SYSTEM_PROMPT },
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
      { accumulatedLength: accumulated.length, first200: accumulated.slice(0, 200), last200: accumulated.slice(-200) },
      "Multi-turn generation accumulated text",
    );

    const parsed = this.parseAndValidate(accumulated);
    if (!parsed) {
      logger.warn({ first500: accumulated.slice(0, 500) }, "Multi-turn validation failed");
      yield { type: "validation_error", message: "Invalid JSON from LLM", retrying: false };
    } else {
      logger.info({ skillName: parsed.name }, "Multi-turn validation passed");
    }

    yield { type: "generation_complete", raw: accumulated };
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

    const parsed = this.parseAndValidate(accumulated);
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

    const parsed = this.parseAndValidate(accumulated);
    if (!parsed) {
      logger.warn("Source-code generation output failed validation");
      yield { type: "validation_error", message: "Invalid JSON from LLM", retrying: false };
    }

    yield { type: "generation_complete", raw: accumulated };
  }

  parseAndValidate(raw: string): GeneratedSkill | null {
    return parseGeneratedSkill(raw);
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
