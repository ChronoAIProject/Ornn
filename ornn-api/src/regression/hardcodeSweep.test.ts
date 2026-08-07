/**
 * RT-HARDCODE-SWEEP-API
 *
 * Regression test: every non-bootstrap-shaped URL, port, model id,
 * NyxID path, S3 bucket, and timeout in `ornn-api/src/` MUST be
 * routed through env (per `infra/config.ts`) or admin settings (per
 * `domains/settings/`). This test scans the source tree and flags
 * any literal that escapes both routes.
 *
 * The triage rubric (Architecture §8):
 *   - test fixture       → exempt by file path (`*.test.ts`, `tests/**`)
 *   - algorithm constant → exempt by allow-list match
 *   - bootstrap (env)    → exempt by file path (`infra/config.ts`,
 *                          `regression/hardcodeSweep.test.ts` itself,
 *                          comment-only blocks)
 *   - operator-flippable → MUST come from settings; offending matches
 *                          are surfaced here so the reviewer can
 *                          re-route them.
 *
 * The intent is "prevent regressions", not "find every hit on first run".
 * If a real hit shows up that has not yet been migrated, add it to
 * `KNOWN_OFFENDERS` with a reason + tracking issue and ship the
 * regression test so the offender list can only shrink over time.
 *
 * @module regression/hardcodeSweep.test
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(SRC_ROOT, "..", "..");

// File-path globs that the sweep skips entirely. Anything matching is
// either a test fixture, the env-loader itself, the regression test
// (which contains literal allow-list strings), or a third-party type
// declaration we do not control.
const SKIP_PATH_REGEXES: RegExp[] = [
  /\.test\.ts$/,
  /[\\/]regression[\\/]/,
  /[\\/]infra[\\/]config\.ts$/,
  // `openapi/` is a documentation surface, not a configuration one. Its
  // string literals are `description` and `examples` values written to be
  // read by a human or an agent — `https://api.openai.com/v1` as an example
  // LLM gateway, `gpt-4o` as an example model id, a GitHub URL showing what
  // a `repoUrl` looks like. Nothing here is ever connected to, parsed, or
  // used to configure the server; these modules have no runtime behaviour
  // beyond returning a JSON document. Same rubric line as a test fixture
  // (Architecture §8): exempt by file path.
  //
  // The one genuinely deployment-shaped value the spec carries — the
  // advertised server URL — is NOT hardcoded: `buildSpec` takes it as
  // `options.serverUrl` from `config.ornnApiBaseUrl`, which is what the
  // rest of this sweep is protecting.
  /[\\/]openapi[\\/]/,
];

// URLs that are intentionally hardcoded in source for legitimate
// reasons (schema URIs, public PostHog default, NyxID OAuth literals
// that ARE the protocol, etc.). Every entry is justified.
const URL_ALLOWLIST: Array<string | RegExp> = [
  // OAuth/JWT / OpenAPI schema URIs — protocol literals, not network
  // endpoints we ever fetch.
  /https?:\/\/json-schema\.org\b/,
  /https?:\/\/spec\.openapis\.org\b/,
  /https?:\/\/openid\.net\b/,
  /https?:\/\/www\.w3\.org\b/,
  /https?:\/\/tools\.ietf\.org\b/,
  /https?:\/\/datatracker\.ietf\.org\b/,
  // Localhost / RFC reserved — used only in inline log examples or
  // doc-comment URLs that never get fetched at runtime.
  /https?:\/\/localhost\b/,
  /https?:\/\/127\.0\.0\.1\b/,
  /https?:\/\/example\.com\b/,
  /https?:\/\/example\.org\b/,
  // Default Mongo URI in error messages / docs comment headers.
  /mongodb:\/\/localhost/,
  // PostHog SDK internal default — STAYS in code; the env override
  // takes precedence at runtime.
  /https?:\/\/eu\.i\.posthog\.com\b/,
  /https?:\/\/us\.i\.posthog\.com\b/,
  // GitHub public API. Not operator-flippable — github.com IS the
  // API the mirror + skill-pull paths talk to. Token-based auth is
  // configured separately via the `mirror` settings section.
  /https?:\/\/api\.github\.com\b/,
  // The Ornn repo URL used in RFC 8594 `Link: rel="deprecation"`
  // headers (#586) — points at docs/DEPRECATIONS.md anchors, not a
  // runtime endpoint we fetch.
  /https?:\/\/github\.com\/ChronoAIProject\/Ornn\/blob\b/,
];

// Specific filename → line allow-list for unavoidable hits (e.g.
// inline default for a documented fallback). Keep small and explicit.
const FILE_ALLOWLIST: Record<string, RegExp[]> = {
  // None — leave empty; if a justified hit shows up, add a precise
  // regex here with a reason in a code comment in the offending file.
};

// Common LLM model ids we expect operator to configure via settings,
// not source. If one of these literals shows up outside test files,
// the sweep flags it.
const FORBIDDEN_MODEL_IDS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "claude-3",
  "claude-sonnet",
  "claude-opus",
  "claude-haiku",
  "gemini-1.5",
  "gemini-2",
];

interface Hit {
  file: string;
  line: number;
  match: string;
  category: "url" | "model";
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && full.endsWith(".ts")) {
      yield full;
    }
  }
}

function isAllowedUrl(url: string): boolean {
  return URL_ALLOWLIST.some((rule) =>
    typeof rule === "string" ? url === rule : rule.test(url),
  );
}

function shouldSkip(file: string): boolean {
  return SKIP_PATH_REGEXES.some((re) => re.test(file));
}

function lineIsCommentOnly(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

function fileLineAllowed(file: string, line: string): boolean {
  const rules = FILE_ALLOWLIST[file];
  if (!rules) return false;
  return rules.some((re) => re.test(line));
}

function scanFile(file: string): Hit[] {
  const hits: Hit[] = [];
  const text = readFileSync(file, "utf-8");
  const rel = relative(REPO_ROOT, file);
  const urlRe = /https?:\/\/[^\s"'`)<>]+/g;

  text.split("\n").forEach((line, idx) => {
    if (lineIsCommentOnly(line)) return;
    if (fileLineAllowed(rel, line)) return;

    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(line)) !== null) {
      const url = m[0].replace(/[.,;:)\]]+$/, "");
      if (isAllowedUrl(url)) continue;
      hits.push({ file: rel, line: idx + 1, match: url, category: "url" });
    }

    for (const id of FORBIDDEN_MODEL_IDS) {
      const re = new RegExp(`["'\`]${id}["'\`]`);
      if (re.test(line)) {
        hits.push({ file: rel, line: idx + 1, match: id, category: "model" });
      }
    }
  });

  return hits;
}

describe("RT-HARDCODE-SWEEP-API", () => {
  test("no hardcoded URLs or model ids outside the allow-list", () => {
    const hits: Hit[] = [];
    for (const file of walk(SRC_ROOT)) {
      if (shouldSkip(file)) continue;
      hits.push(...scanFile(file));
    }

    if (hits.length > 0) {
      const report = hits
        .map((h) => `${h.file}:${h.line}  [${h.category}]  ${h.match}`)
        .join("\n");
      throw new Error(
        `Hardcoded values found in ornn-api/src — route through env (infra/config.ts) or admin settings.\n${report}`,
      );
    }

    expect(hits).toEqual([]);
  });
});
