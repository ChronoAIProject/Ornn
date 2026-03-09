/**
 * Skill generation service using Nyx Provider (Responses API format).
 * Replaces Vercel AI SDK and OpenAI SDK with NyxLlmClient.
 * Streams generation events via SSE. Does NOT auto-persist.
 * @module domains/skillGeneration/service
 */

import { z } from "zod";
import type { NyxLlmClient, ResponsesApiStreamEvent, ResponsesApiInputMessage } from "../../clients/nyxLlmClient";
import type { GeneratedSkill, SkillStreamEvent } from "../../shared/types/index";
import { AppError } from "../../shared/types/index";
import { buildDirectGenerationPrompt, GENERATION_SYSTEM_PROMPT } from "./prompts";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillGenerationService" });

const generatedSkillSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().min(10).max(500),
  category: z.enum(["plain", "runtime-based"]),
  outputType: z.enum(["text", "file"]).optional(),
  tags: z.array(z.string().min(2).max(30).regex(/^[a-z0-9-]+$/)).min(1).max(10),
  readmeBody: z.string().min(50).max(20_000),
  runtimes: z.array(z.string()).default([]),
  dependencies: z.array(z.string().max(200)).default([]),
  envVars: z.array(z.string().max(100)).default([]),
  scripts: z.array(z.object({
    filename: z.string().min(1).max(200),
    content: z.string().min(1).max(50_000),
  })).default([]),
});

export { generatedSkillSchema };

export interface GenerationServiceConfig {
  llmClient: NyxLlmClient;
  defaultModel: string;
  maxOutputTokens: number;
  temperature: number;
}

export class SkillGenerationService {
  private readonly llmClient: NyxLlmClient;
  private readonly defaultModel: string;
  private readonly maxOutputTokens: number;
  private readonly temperature: number;

  constructor(config: GenerationServiceConfig) {
    this.llmClient = config.llmClient;
    this.defaultModel = config.defaultModel;
    this.maxOutputTokens = config.maxOutputTokens;
    this.temperature = config.temperature;
  }

  /**
   * Direct generation streaming. Streams tokens via SSE events.
   * Uses Nyx Provider Responses API format.
   */
  async *generateStream(
    query: string,
    userToken: string,
    signal?: AbortSignal,
  ): AsyncIterable<SkillStreamEvent> {
    if (signal?.aborted) {
      yield { type: "error", message: "Request aborted" };
      return;
    }

    yield { type: "generation_start" };

    const { userPrompt } = buildDirectGenerationPrompt(query);
    const input: ResponsesApiInputMessage[] = [
      { role: "developer", content: GENERATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    let accumulated = "";

    try {
      const streamEvents = this.llmClient.stream({
        model: this.defaultModel,
        input,
        max_output_tokens: this.maxOutputTokens,
        temperature: this.temperature,
        userToken,
      });

      for await (const event of streamEvents) {
        if (signal?.aborted) {
          yield { type: "error", message: "Request aborted" };
          return;
        }

        const text = extractTextFromEvent(event);
        if (text) {
          accumulated += text;
          yield { type: "token", content: text };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "LLM stream error");
      yield { type: "error", message: `LLM error: ${message}` };
      return;
    }

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

          const outputs = await this.llmClient.complete({
            model: this.defaultModel,
            input: retryInput,
            max_output_tokens: this.maxOutputTokens,
            temperature: this.temperature,
            userToken,
          });

          let retryText = "";
          for (const output of outputs) {
            if (output.content) {
              for (const part of output.content) {
                if (part.text) retryText += part.text;
              }
            }
          }

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
    userToken: string,
    signal?: AbortSignal,
  ): AsyncIterable<SkillStreamEvent> {
    if (signal?.aborted) {
      yield { type: "error", message: "Request aborted" };
      return;
    }

    yield { type: "generation_start" };

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

    let accumulated = "";

    try {
      const streamEvents = this.llmClient.stream({
        model: this.defaultModel,
        input,
        max_output_tokens: this.maxOutputTokens,
        temperature: this.temperature,
        userToken,
      });

      for await (const event of streamEvents) {
        if (signal?.aborted) {
          yield { type: "error", message: "Request aborted" };
          return;
        }

        const text = extractTextFromEvent(event);
        if (text) {
          accumulated += text;
          yield { type: "token", content: text };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "LLM multi-turn stream error");
      yield { type: "error", message: `LLM error: ${message}` };
      return;
    }

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

  parseAndValidate(raw: string): GeneratedSkill | null {
    try {
      let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      }

      const json = JSON.parse(cleaned);

      // Handle backward-compat: rename readmeMd -> readmeBody
      if (json.readmeMd && !json.readmeBody) {
        const md = json.readmeMd as string;
        const fmEnd = md.indexOf("\n---", 3);
        json.readmeBody = fmEnd > 0 ? md.slice(fmEnd + 4).trim() : md;
        delete json.readmeMd;
      }

      const result = generatedSkillSchema.safeParse(json);
      if (!result.success) {
        logger.debug({ errors: result.error.issues }, "Generated skill validation failed");
        return null;
      }

      return result.data;
    } catch {
      return null;
    }
  }
}

/**
 * Extract text content from a Responses API stream event.
 * Handles response.output_text.delta and response.content_part.delta events.
 */
function extractTextFromEvent(event: ResponsesApiStreamEvent): string | null {
  const eventType = event.type;

  if (eventType === "response.output_text.delta") {
    return (event as any).delta ?? null;
  }

  if (eventType === "response.content_part.delta") {
    const delta = (event as any).delta;
    if (delta && typeof delta === "object" && delta.type === "output_text" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  return null;
}
