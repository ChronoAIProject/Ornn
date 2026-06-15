/**
 * Context assembly for the Ornn Assistant (#970).
 *
 * Turns (curated KB grounding + visibility-scoped skills + the
 * conversation) into the `input` message array for ONE streamed
 * completion. There is NO tool loop and NO agentic behaviour — the model
 * sees the grounding once and answers.
 *
 * The persona + grounding are injected as a single leading `developer`
 * message (the playground does the same — the upstream gateway ignores
 * the Responses-API `instructions` field, so grounding must ride in the
 * message list). The user/assistant turns follow verbatim.
 *
 * @module domains/assistant/contextAssembler
 */

import type { ResponsesApiInputMessage } from "../../clients/nyxid/llm";
import type { AssistantMessage, RetrievedSkill } from "./types";

/**
 * Assistant persona + guardrails. Constrains the model to grounded Q&A
 * and forbids inventing facts or leaking anything outside the grounding.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are the Ornn Assistant, a helpful Q&A guide for Ornn — the agent-facing skill-lifecycle API (think "npm registry + npm CLI, fused, model-agnostic").

Your job:
- Answer questions about what Ornn is, how it is different, and how to use it (search, pull, install, execute, build, upload, share skills).
- Help the user understand the skills that appear in the "relevant skills" section below — these are already filtered to what THIS user is allowed to see.

Hard rules:
- You are a read-only Q&A assistant. You cannot run, install, modify, upload, or execute anything. If asked to perform an action, explain how the user/agent can do it via the Ornn API instead.
- Ground every answer in the knowledge base and the relevant-skills section below. If the answer is not supported there, say you don't know and point the user to the docs or the relevant API endpoint — never invent endpoints, fields, behaviour, or skills.
- Only discuss skills that appear in the relevant-skills section. Never speculate about skills that aren't listed, and never reveal author emails, internal IDs, storage details, sharing lists, secrets, quotas, or any other user's private data.
- Be concise and technical — the audience is agent developers.`;

const SEPARATOR = "\n\n---\n\n";

/**
 * Build the LLM `input` for one assistant completion.
 */
export function assembleAssistantInput(opts: {
  readonly kbText: string;
  readonly skills: ReadonlyArray<RetrievedSkill>;
  readonly messages: ReadonlyArray<AssistantMessage>;
}): { input: ResponsesApiInputMessage[] } {
  const grounding = buildGroundingBlock(opts.kbText, opts.skills);
  const input: ResponsesApiInputMessage[] = [
    { role: "developer", content: grounding },
  ];
  for (const m of opts.messages) {
    input.push({ role: m.role, content: m.content });
  }
  return { input };
}

/** Assemble persona + KB + scoped-skills into one developer message. */
function buildGroundingBlock(
  kbText: string,
  skills: ReadonlyArray<RetrievedSkill>,
): string {
  const parts: string[] = [ASSISTANT_SYSTEM_PROMPT];

  const kb = kbText.trim();
  if (kb.length > 0) {
    parts.push(`# Ornn knowledge base\n\n${kb}`);
  }

  if (skills.length > 0) {
    const rendered = skills.map(renderSkill).join("\n");
    parts.push(
      `# Relevant skills (already filtered to what this user may see)\n\n${rendered}`,
    );
  } else {
    parts.push(
      `# Relevant skills\n\n(No skills matching the question are visible to this user.)`,
    );
  }

  return parts.join(SEPARATOR);
}

/** One-line, SAFE rendering of a retrieved skill. */
function renderSkill(s: RetrievedSkill): string {
  const category = s.category ? ` (category: ${s.category})` : "";
  const tags = s.tags.length > 0 ? ` [tags: ${s.tags.join(", ")}]` : "";
  return `- ${s.name}: ${s.description}${category}${tags} — created ${s.createdOn} by ${s.createdBy}`;
}
