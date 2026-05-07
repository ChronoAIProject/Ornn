/**
 * RT-HARDCODE-SWEEP-WEB — guard against hardcoded backend URLs, NyxID
 * frontend hosts, and model id strings outside test fixtures.
 *
 * The frontend reads runtime config from `config.ts` (which itself
 * pulls from window.ORNN_RUNTIME_CONFIG injected by the nginx
 * configmap). Anything in `src/` that looks like a hardcoded production
 * URL or model identifier is a regression — admin settings + runtime
 * config are the only operator-flippable surfaces.
 *
 * Scope: walks `ornn-web/src/`. Allowlists any path containing
 * `/__tests__/`, `.test.`, `.spec.`, `/test/`, or that ends in
 * `i18n/` (locale strings sometimes contain example URLs).
 *
 * @module __tests__/regression/hardcodeSweep
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");

interface Hit {
  file: string;
  line: number;
  text: string;
  rule: string;
}

const BANNED: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "chrono-ai.fun production host", pattern: /(?<!cdn\.)[a-z0-9-]+\.chrono-ai\.fun/g },
  { rule: "ornn-cluster k8s host", pattern: /\bornn-(api|web)[a-z0-9-]*\.ornn-cluster\b/g },
  { rule: "raw GPT model id", pattern: /\bgpt-(3\.5|4|4o|4-turbo|4\.1|5)\b/g },
  { rule: "raw Claude model id (excluding the brand-name strings)", pattern: /\bclaude-(opus|sonnet|haiku)-\d/g },
];

const ALLOWLIST_DIRS = [
  "/__tests__/",
  "/test/",
  "/i18n/",
];

const ALLOWLIST_FILES = [
  ".test.",
  ".spec.",
];

function shouldSkip(rel: string): boolean {
  if (ALLOWLIST_DIRS.some((d) => rel.includes(d))) return true;
  if (ALLOWLIST_FILES.some((f) => rel.includes(f))) return true;
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file: string): Hit[] {
  const rel = relative(ROOT, file);
  if (shouldSkip(rel)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Allow `// allow-hardcode` opt-out comments on a per-line basis.
    if (line.includes("allow-hardcode")) continue;
    for (const { rule, pattern } of BANNED) {
      pattern.lastIndex = 0;
      const m = line.match(pattern);
      if (m) {
        hits.push({ file: rel, line: i + 1, text: line.trim(), rule });
      }
    }
  }
  return hits;
}

describe("RT-HARDCODE-SWEEP-WEB", () => {
  it("ornn-web/src has no hardcoded backend URLs or model IDs", () => {
    const files = walk(ROOT);
    const hits = files.flatMap(scanFile);
    if (hits.length > 0) {
      const msg = hits
        .map((h) => `[${h.rule}] ${h.file}:${h.line}  ${h.text}`)
        .join("\n");
      throw new Error(
        `Hardcoded values detected — move to runtime config or admin settings:\n${msg}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
