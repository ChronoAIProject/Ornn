/**
 * Token-budget arithmetic for the Ornn Assistant knowledge base (#970).
 *
 * The assistant grounds every answer in a curated, size-budgeted digest
 * of the repo's knowledge-bearing docs. We never want that grounding to
 * blow the model's context window, so the digest is bounded by a *token
 * budget* both at build time (the curation pass) and at load time (a
 * defensive clamp).
 *
 * Token counts here are deliberately a cheap, deterministic heuristic
 * (chars ÷ 4) rather than a real tokenizer: the digest is model-agnostic
 * (Claude / GPT / Gemini all differ), so an exact count for one model is
 * meaningless for another. ~4 chars/token is the well-known English
 * average and is conservative enough for budgeting headroom. Determinism
 * matters more than precision — the same input must always yield the same
 * digest so the loader cache and CI artifact stay stable.
 *
 * @module domains/assistant/kb/tokens
 */

/** Conservative average characters-per-token for English prose. */
export const CHARS_PER_TOKEN = 4;

/**
 * Default grounding budget in tokens (~15–20k target per #970). Kept well
 * under any modern model's context window so the retrieved-skills block +
 * the conversation still fit comfortably alongside it.
 */
export const DEFAULT_KB_TOKEN_BUDGET = 18_000;

/** Env var name for overriding the digest token budget (build + load). */
export const KB_TOKEN_BUDGET_ENV = "ASSISTANT_KB_TOKEN_BUDGET";

/**
 * Resolve the active token budget from the environment, falling back to
 * {@link DEFAULT_KB_TOKEN_BUDGET}. Invalid / non-positive values are
 * ignored (fall back to the default) rather than throwing — a misconfig
 * must never take the assistant offline.
 */
export function resolveKbTokenBudget(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[KB_TOKEN_BUDGET_ENV];
  if (raw === undefined || raw.trim() === "") return DEFAULT_KB_TOKEN_BUDGET;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_KB_TOKEN_BUDGET;
  return Math.floor(parsed);
}

/** Estimate the token count of `text` using the chars-per-token heuristic. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Clip `text` so its estimated token count does not exceed `budgetTokens`.
 * Clips on a whitespace boundary near the limit when possible so the digest
 * doesn't end mid-word. Returns the (possibly clipped) text and whether a
 * clip happened.
 */
export function clampToTokenBudget(
  text: string,
  budgetTokens: number,
): { readonly text: string; readonly truncated: boolean } {
  if (budgetTokens <= 0) return { text: "", truncated: text.length > 0 };
  const maxChars = budgetTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return { text, truncated: false };
  const hardCut = text.slice(0, maxChars);
  // Prefer the last newline, then the last space, to avoid cutting a word.
  const lastBreak = Math.max(hardCut.lastIndexOf("\n"), hardCut.lastIndexOf(" "));
  // Only honour the soft break if it's reasonably close to the limit
  // (within the last 20%) — otherwise a doc with no whitespace near the
  // cut would throw away too much content.
  const softCut =
    lastBreak >= maxChars * 0.8 ? hardCut.slice(0, lastBreak) : hardCut;
  return { text: softCut.trimEnd(), truncated: true };
}
