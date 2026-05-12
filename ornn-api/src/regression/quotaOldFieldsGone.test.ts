/**
 * RT-QUOTA-OLD-FIELDS-GONE + RT-QUOTA-OLD-GRANT-FIELDS-GONE.
 *
 * Sweep `ornn-api/src/domains/quota/` for any reference to the old
 * daily-ceiling / time-period grant model. The bucket model dropped
 * `dailyUsed`, `dailyCeiling`, `dailyResetMarker`, `nextDailyResetAt`,
 * `periodMonths`, and per-grant `expiresAt`. Any literal occurrence in
 * non-archive source code is a regression.
 *
 * The migration script + its test legitimately reference the old field
 * names because they read the legacy collection — those files are
 * exempt by path.
 *
 * @module regression/quotaOldFieldsGone.test
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const QUOTA_DIR = join(import.meta.dir, "..", "domains", "quota");

const FORBIDDEN_DAILY = ["dailyUsed", "dailyCeiling", "dailyResetMarker", "nextDailyResetAt"];
const FORBIDDEN_GRANT = ["periodMonths", "expiresAt"];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      yield full;
    }
  }
}

interface Hit {
  file: string;
  line: number;
  match: string;
}

function scanFor(forbidden: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of walk(QUOTA_DIR)) {
    const text = readFileSync(file, "utf-8");
    text.split("\n").forEach((line, idx) => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      ) {
        return;
      }
      for (const word of forbidden) {
        if (line.includes(word)) {
          hits.push({ file, line: idx + 1, match: word });
        }
      }
    });
  }
  return hits;
}

describe("RT-QUOTA-OLD-FIELDS-GONE", () => {
  test("no daily-ceiling references in domains/quota source", () => {
    const hits = scanFor(FORBIDDEN_DAILY);
    if (hits.length > 0) {
      const report = hits.map((h) => `${h.file}:${h.line}  ${h.match}`).join("\n");
      throw new Error(`Daily-ceiling field references still in quota domain:\n${report}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("RT-QUOTA-OLD-GRANT-FIELDS-GONE", () => {
  test("no periodMonths / expiresAt references in domains/quota source", () => {
    const hits = scanFor(FORBIDDEN_GRANT);
    if (hits.length > 0) {
      const report = hits.map((h) => `${h.file}:${h.line}  ${h.match}`).join("\n");
      throw new Error(`Old grant-period field references still in quota domain:\n${report}`);
    }
    expect(hits).toEqual([]);
  });
});
