/**
 * AgentSeal subprocess scanner (issue #253).
 *
 * Wraps `python scan_skill.py <zip-path>` behind a tiny `IAgentSealScanner`
 * interface so:
 *   1. The publish path can call it without knowing how the binary is
 *      invoked.
 *   2. Tests can substitute a fake scanner without spawning processes.
 *   3. Operators can flip `AGENTSEAL_ENABLED=false` and the implementation
 *      degrades to a no-scan that doesn't block publishing.
 *
 * Why a Python wrapper, not the agentseal CLI:
 *   `agentseal guard` is designed to scan installed agent configs on a
 *   developer's machine, NOT arbitrary skill packages. The `agentseal`
 *   package does ship a library-level `SkillScanner` class that runs
 *   the same threat-detection rules per file, which is exactly what we
 *   want — the wrapper script (`ornn-api/scripts/scan_skill.py`) calls
 *   that class on every text-like file in the extracted ZIP and emits
 *   one JSON line.
 *
 * Concurrency: each call spawns its own subprocess + writes the ZIP to
 * a unique temp file, so multiple publishes don't collide.
 *
 * v1 is warn-only — failures (timeout, crash, malformed output, missing
 * binary) are logged but never thrown into the publish path. The caller
 * treats `result === null` as "no scan available" and persists nothing.
 *
 * @module infra/agentseal
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino, { type Logger } from "pino";

const moduleLogger = pino({ level: "info" }).child({ module: "agentseal" });

export interface ScanInput {
  /** Skill identity for log correlation. */
  readonly skillGuid: string;
  /** Version label being scanned. */
  readonly version: string;
  /** Raw ZIP bytes of the skill package. Written to a temp file before scan. */
  readonly zipBuffer: Uint8Array;
}

export interface ScanResult {
  /** Trust score 0–100, clamped at parse time. */
  readonly score: number;
  /** Raw findings array — passed through verbatim from the wrapper. */
  readonly findings: ReadonlyArray<Record<string, unknown>>;
  /** ISO timestamp of when the scan completed. */
  readonly scannedAt: string;
  /** Pinned `agentseal` package version that produced this scan. */
  readonly agentsealVersion: string;
  /** Count of files the scanner actually walked (excluding binaries / oversized). */
  readonly scannedFiles: number;
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
  /** Path to the python interpreter (e.g. `/opt/agentseal/bin/python`). */
  readonly python: string;
  /** Path to `scan_skill.py` baked into the image. */
  readonly script: string;
  /** Hard timeout, ms. Default 60_000 from config. */
  readonly timeoutMs: number;
  /** Master kill-switch. When false `scan()` short-circuits to null. */
  readonly enabled: boolean;
  readonly logger?: Logger;
}

export class AgentSealScanner implements IAgentSealScanner {
  private readonly python: string;
  private readonly script: string;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  private readonly logger: Logger;

  constructor(cfg: AgentSealScannerConfig) {
    this.python = cfg.python;
    this.script = cfg.script;
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

    // Stage the ZIP on disk; the wrapper script extracts it itself.
    let workdir: string | null = null;
    let zipPath: string | null = null;
    try {
      workdir = await mkdtemp(join(tmpdir(), "ornn-agentseal-"));
      zipPath = join(workdir, "skill.zip");
      await writeFile(zipPath, Buffer.from(input.zipBuffer));
    } catch (err) {
      this.logger.error({ err, skillGuid: input.skillGuid }, "Failed to stage skill ZIP for scan");
      // Best-effort cleanup
      if (workdir) {
        await rm(workdir, { recursive: true, force: true }).catch(() => {});
      }
      return null;
    }

    let raw: string;
    try {
      raw = await this.runScannerSubprocess(zipPath);
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
    } finally {
      // Always clean up — never leak temp dirs even on success.
      if (workdir) {
        rm(workdir, { recursive: true, force: true }).catch((err) => {
          this.logger.warn({ err, workdir }, "Failed to clean AgentSeal temp dir");
        });
      }
    }

    const parsed = parseSkillScanOutput(raw);
    if (!parsed) {
      this.logger.warn(
        {
          skillGuid: input.skillGuid,
          version: input.version,
          // Truncate to avoid mega-logs on misconfigured wrappers.
          rawSnippet: raw.slice(0, 500),
        },
        "AgentSeal output failed to parse — skipping persist",
      );
      return null;
    }

    const result: ScanResult = {
      score: parsed.score,
      findings: parsed.findings,
      scannedAt: parsed.scannedAt ?? new Date().toISOString(),
      agentsealVersion: parsed.agentsealVersion,
      scannedFiles: parsed.scannedFiles,
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
   * Spawn `python scan_skill.py <zip-path>`, collect stdout, kill on
   * timeout. Errors thrown here are caught and logged by `scan()`.
   */
  private runScannerSubprocess(zipPath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.python, [this.script, zipPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

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
        // The wrapper emits JSON on both success (exit 0) and structured
        // errors (non-zero). Surface stdout regardless so the parser can
        // see the `error` field. If stdout is empty, fall back to stderr
        // for the failure message.
        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              `AgentSeal exited ${code}: ${stderr.slice(0, 500) || "<empty stderr>"}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });
  }
}

interface ParsedScan {
  score: number;
  findings: Array<Record<string, unknown>>;
  agentsealVersion: string;
  scannedAt?: string;
  scannedFiles: number;
}

/**
 * Parse the wrapper script's JSON output. Surfaces `null` on any shape
 * mismatch so the caller can degrade silently without persisting bogus
 * scores.
 *
 * Exported for tests.
 */
export function parseSkillScanOutput(raw: string): ParsedScan | null {
  const stripped = raw.trim();
  if (!stripped) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  // Wrapper signals failure with `{"error": "..."}` and exits non-zero.
  // Treat as soft failure — never persist.
  if (typeof obj.error === "string") return null;

  const rawScore = typeof obj.score === "number" ? obj.score : null;
  if (rawScore === null || Number.isNaN(rawScore)) return null;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: Array<Record<string, unknown>> = [];
  for (const f of rawFindings) {
    if (f && typeof f === "object" && !Array.isArray(f)) {
      findings.push(f as Record<string, unknown>);
    }
  }

  const agentsealVersion =
    typeof obj.agentsealVersion === "string" ? obj.agentsealVersion : "unknown";
  const scannedAt =
    typeof obj.scannedAt === "string" ? obj.scannedAt : undefined;
  const scannedFiles =
    typeof obj.scannedFiles === "number" && Number.isFinite(obj.scannedFiles)
      ? Math.max(0, Math.round(obj.scannedFiles))
      : 0;

  return { score, findings, agentsealVersion, scannedAt, scannedFiles };
}
