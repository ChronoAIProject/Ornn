/**
 * text-summarizer example skill.
 *
 * Reads `{ text, length? }` from stdin (single JSON blob), asks Claude
 * for a summary of roughly `length` words, writes `{ summary }` to
 * stdout. On any failure: `{ error }` on stderr + exit code 1.
 *
 * Intentionally minimal — no retries, no streaming, no input
 * sanitisation. See SKILL.md "Adapt this" for production hardening.
 */

import Anthropic from "@anthropic-ai/sdk";

interface Input {
  text: string;
  length?: number;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const raw = (await readStdin()).trim();
  if (!raw) {
    throw new Error("expected JSON `{ text, length? }` on stdin");
  }

  const input = JSON.parse(raw) as Input;
  if (typeof input.text !== "string" || input.text.length === 0) {
    throw new Error("`text` is required and must be a non-empty string");
  }
  const length = typeof input.length === "number" && input.length > 0 ? input.length : 60;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: Math.max(256, length * 4),
    messages: [
      {
        role: "user",
        content: `Summarise the following text in approximately ${length} words. Reply with only the summary, no preamble.\n\n${input.text}`,
      },
    ],
  });

  const summary = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  process.stdout.write(JSON.stringify({ summary }) + "\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ error: message }) + "\n");
  process.exit(1);
});
