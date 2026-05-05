/**
 * AgentSeal subprocess scanner (issue #253).
 *
 * Wraps `agentseal guard --output json` behind a tiny `IAgentSealScanner`
 * interface so:
 *   1. The publish path can call it without knowing how the binary is
 *      invoked.
 *   2. Tests can substitute a fake scanner without spawning processes.
 *   3. Operators can flip `AGENTSEAL_ENABLED=false` and the implementation
 *      degrades to a no-scan that doesn't block publishing.
 *
 * Concurrency: each call spawns its own subprocess and pipes the package
 * bytes via stdin (`--package -`) so multiple publishes don't collide on
 * a shared workdir. The CLI is read-only against its arguments — no
 * side-effects on the host filesystem.
 *
 * v1 is warn-only — failures (timeout, crash, malformed output) are
 * logged but never thrown into the publish path. The caller treats
 * `result === null` as "no scan available" and persists nothing.
 *
 * @module infra/agentseal
 */

import { spawn } from "node:child_process";
import pino, { type Logger } from "pino";

const moduleLogger = pino({ level: "info" }).child({ module: "agentseal" });

export interface ScanInput {
  /** Skill identity for log correlation. */
  readonly skillGuid: string;
  /** Version label being scanned. */
  readonly version: string;
  /** Raw ZIP bytes of the skill package. Piped to AgentSeal via stdin. */
  readonly zipBuffer: Uint8Array;
}

export interface ScanResult {
  /** Trust score 0–100, clamped at parse time. */
  readonly score: number;
  /** Raw findings array — passed through verbatim from the CLI. */
  readonly findings: ReadonlyArray<Record<string, unknown>>;
  /** ISO timestamp of when the scan completed. */
  readonly scannedAt: string;
  /** Pinned `agentseal` package version that produced this scan. */
  readonly agentsealVersion: string;
}

/**
 * Public interface — the publish path depends on this, not the concrete
 * scanner. Returning null (rather than throwing) is the v1 contract: the
 * scan is advisory and never blocks publish.
 */
export interface IAgentSealScanner {
  /** Returns `null` on any failure (timeout, crash, parse). */
  scan(input: ScanInput): Promise<ScanResult | null>;
}

export interface AgentSealScannerConfig {
  /** Path or PATH name of the agentseal CLI. Defaults to `agentseal`. */
  readonly command: string;
  /** Hard timeout, ms. Default 60_000 from config. */
  readonly timeoutMs: number;
  /** Master kill-switch. When false `scan()` short-circuits to null. */
  readonly enabled: boolean;
  readonly logger?: Logger;
}

export class AgentSealScanner implements IAgentSealScanner {
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  private readonly logger: Logger;

  constructor(cfg: AgentSealScannerConfig) {
    this.command = cfg.command;
    this.timeoutMs = cfg.timeoutMs;
    this.enabled = cfg.enabled;
    this.logger = (cfg.logger ?? moduleLogger).child({ module: "agentseal" });
  }

  async scan(input: ScanInput): Promise<ScanResult | null> {
    if (!this.enabled) {
      this.logger.debug(
        { skillGuid: input.skillGuid, version: input.version },
        "AgentSeal disabled — skipping scan",
      );
      return null;
    }

    const startedAt = Date.now();
    let raw: string;
    try {
      raw = await this.runGuardSubprocess(input);
    } catch (err) {
      this.logger.error(
        {
          err,
          skillGuid: input.skillGuid,
          version: input.version,
          durationMs: Date.now() - startedAt,
        },
        "AgentSeal subprocess failed",
      );
      return null;
    }

    const parsed = parseGuardOutput(raw);
    if (!parsed) {
      this.logger.warn(
        {
          skillGuid: input.skillGuid,
          version: input.version,
          // Truncate to avoid mega-logs on misconfigured CLIs.
          rawSnippet: raw.slice(0, 500),
        },
        "AgentSeal output failed to parse — skipping persist",
      );
      return null;
    }

    const result: ScanResult = {
      score: parsed.score,
      findings: parsed.findings,
      scannedAt: new Date().toISOString(),
      agentsealVersion: parsed.agentsealVersion,
    };

    this.logger.info(
      {
        skillGuid: input.skillGuid,
        version: input.version,
        score: result.score,
        findings: result.findings.length,
        agentsealVersion: result.agentsealVersion,
        durationMs: Date.now() - startedAt,
      },
      "AgentSeal scan complete",
    );
    return result;
  }

  /**
   * Spawn `agentseal guard --output json --package -`, pipe the ZIP via
   * stdin, collect stdout, kill on timeout. Errors thrown here are
   * caught and logged by `scan()`.
   */
  private runGuardSubprocess(input: ScanInput): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        this.command,
        ["guard", "--output", "json", "--package", "-"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      // Hard timeout — SIGTERM, then SIGKILL after a short grace.
      const killTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              /* already dead */
            }
          }, 1_000).unref();
        } catch {
          /* spawn may have already exited */
        }
        reject(new Error(`AgentSeal timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      killTimer.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (code !== 0) {
          reject(
            new Error(
              `AgentSeal exited ${code}: ${stderr.slice(0, 500) || "<empty stderr>"}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });

      // Pipe the ZIP bytes in. AgentSeal's stdin reader closes when
      // it sees EOF, so we end() once the buffer is written.
      try {
        child.stdin.write(Buffer.from(input.zipBuffer));
        child.stdin.end();
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        reject(err);
      }
    });
  }
}

/**
 * Parse `agentseal guard --output json` output. The CLI's exact key
 * names have shifted between releases (`score` vs `trustScore`); we
 * accept either and clamp the score into 0–100.
 *
 * Exported for tests.
 */
export function parseGuardOutput(raw: string): ScanResult | null {
  let stripped = raw.trim();
  // Strip ```json … ``` fences if the CLI ever emits them.
  if (stripped.startsWith("```")) {
    const start = stripped.indexOf("\n");
    const end = stripped.lastIndexOf("```");
    if (start > -1 && end > start) {
      stripped = stripped.slice(start + 1, end).trim();
    }
  }
  if (!stripped) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  const rawScore =
    typeof obj.score === "number"
      ? obj.score
      : typeof obj.trustScore === "number"
        ? obj.trustScore
        : null;
  if (rawScore === null || Number.isNaN(rawScore)) return null;
  // Clamp into 0–100 and round to integer for stable display.
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: Array<Record<string, unknown>> = [];
  for (const f of rawFindings) {
    if (f && typeof f === "object" && !Array.isArray(f)) {
      findings.push(f as Record<string, unknown>);
    }
  }

  const agentsealVersion =
    typeof obj.agentsealVersion === "string"
      ? obj.agentsealVersion
      : typeof obj.version === "string"
        ? obj.version
        : "unknown";

  return {
    score,
    findings,
    scannedAt: new Date(0).toISOString(), // placeholder; caller restamps
    agentsealVersion,
  };
}
