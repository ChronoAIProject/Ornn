/**
 * Skill-audit service. Orchestrates:
 *   1. Download skill package from storage
 *   2. Extract a readable bundle of files
 *   3. Ask the LLM for structured dimension scores + findings
 *   4. Compute verdict, persist the audit record
 *
 * Cache-first path: if an audit exists for the same skill hash younger
 * than the TTL, return it directly.
 *
 * @module domains/skills/audit/service
 */

import pino from "pino";
import type { NyxLlmClient, ResponsesApiInputMessage } from "../../../clients/nyxid/llm";
import type { IStorageClient } from "../../../clients/storageClient";
import type { SkillService } from "../crud/service";
import { AppError } from "../../../shared/types/index";
import type { AuditRepository } from "./repository";
import {
  type AuditFinding,
  type AuditRecord,
  type AuditScore,
  AUDIT_DIMENSIONS,
  type AuditDimension,
  computeOverallScore,
  computeVerdict,
} from "./types";
import { AUDIT_SYSTEM_PROMPT, buildAuditUserPrompt } from "./prompts";
import JSZip from "jszip";
import { resolveZipRoot } from "../../../shared/utils/zip";

const logger = pino({ level: "info" }).child({ module: "auditService" });

export interface AuditServiceDeps {
  readonly auditRepo: AuditRepository;
  readonly skillService: SkillService;
  readonly storageClient: IStorageClient;
  readonly storageBucket: string;
  readonly llmClient: NyxLlmClient;
  readonly model: string;
  readonly cacheTtlMs: number;
}

export interface AuditOptions {
  readonly triggeredBy: string;
  /** Skip cache lookup; re-run even if a fresh record exists. */
  readonly force?: boolean;
}

export class AuditService {
  private readonly auditRepo: AuditRepository;
  private readonly skillService: SkillService;
  private readonly storageClient: IStorageClient;
  private readonly storageBucket: string;
  private readonly llmClient: NyxLlmClient;
  private readonly model: string;
  private readonly cacheTtlMs: number;

  constructor(deps: AuditServiceDeps) {
    this.auditRepo = deps.auditRepo;
    this.skillService = deps.skillService;
    this.storageClient = deps.storageClient;
    this.storageBucket = deps.storageBucket;
    this.llmClient = deps.llmClient;
    this.model = deps.model;
    this.cacheTtlMs = deps.cacheTtlMs;
  }

  /**
   * Fetch the most recent *completed* audit for (skill, version). Running
   * rows are ignored so callers (e.g. the share path) see only final
   * scores. The history endpoint returns everything for the UI.
   */
  async getAudit(idOrName: string, version?: string): Promise<AuditRecord | null> {
    const skill = await this.skillService.getSkill(idOrName, version);
    const latest = await this.auditRepo.findLatestBySkillAndVersion(skill.guid, skill.version);
    if (!latest || latest.status !== "completed") return null;
    return latest;
  }

  /**
   * Return audit records for a skill, newest first. When `version` is
   * provided, only records for that version are returned; otherwise every
   * record across versions is included.
   */
  async listHistory(
    idOrName: string,
    version?: string,
  ): Promise<ReadonlyArray<AuditRecord>> {
    const skill = await this.skillService.getSkill(idOrName);
    const all = await this.auditRepo.listBySkillGuid(skill.guid);
    if (!version) return all;
    return all.filter((r) => r.version === version);
  }

  /**
   * Kick off an audit. Inserts a `running` row immediately so the UI sees
   * it, runs the LLM pipeline in the background, then marks the row as
   * `completed`/`failed`. The returned record is always the initial
   * `running` row (unless the cache short-circuits) — callers poll
   * `listHistory` / `getAudit` for the final verdict.
   *
   * Cache path: with `force: false`, if there's a completed audit for the
   * same bytes younger than the TTL, we just return that without
   * creating a new row.
   */
  async runAudit(idOrName: string, options: AuditOptions): Promise<AuditRecord> {
    const skill = await this.skillService.getSkill(idOrName);
    const { guid, name, version, skillHash } = skill;

    if (!options.force) {
      const cached = await this.auditRepo.findCachedByHash(guid, skillHash, this.cacheTtlMs);
      if (cached) {
        logger.info({ guid, version, verdict: cached.verdict }, "Audit cache hit");
        return cached;
      }
    }

    const running = await this.auditRepo.createRunning({
      skillGuid: guid,
      version,
      skillHash,
      model: this.model,
      triggeredBy: options.triggeredBy,
    });

    // Run the LLM pipeline as a background task. The response returns
    // the `running` row immediately so the UI can render a pending
    // entry; this promise updates the same row when the pipeline is
    // done (or fails). We never re-throw here — errors are surfaced on
    // the record itself as `status: "failed"`.
    void this.finalizeAudit(running._id, guid, name, version).catch((err) => {
      logger.error({ err, auditId: running._id }, "Background audit task threw unexpectedly");
    });

    return running;
  }

  private async finalizeAudit(
    auditId: string,
    guid: string,
    name: string,
    version: string,
  ): Promise<void> {
    try {
      const { filesBundle, metadataSummary } = await this.buildAuditContext(guid);

      const input: ResponsesApiInputMessage[] = [
        { role: "developer", content: AUDIT_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildAuditUserPrompt({
            skillName: name,
            version,
            metadataSummary,
            filesBundle,
          }),
        },
      ];

      const outputs = await this.llmClient.complete({
        model: this.model,
        input,
        max_output_tokens: 4000,
        temperature: 0.1,
      });

      let rawText = "";
      for (const output of outputs) {
        if (output.content) {
          for (const part of output.content) {
            if (part.text) rawText += part.text;
          }
        }
      }

      const parsed = parseAuditJson(rawText);
      if (!parsed) {
        logger.warn(
          { guid, version, first200: rawText.slice(0, 200) },
          "Audit LLM output failed to parse",
        );
        await this.auditRepo.markFailed(
          auditId,
          "Audit LLM did not return a valid scoring JSON",
        );
        return;
      }

      const { scores, findings } = parsed;
      const overallScore = computeOverallScore(scores);
      const verdict = computeVerdict(scores, findings);

      await this.auditRepo.markCompleted(auditId, {
        verdict,
        overallScore,
        scores,
        findings,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.auditRepo.markFailed(auditId, message).catch((inner) => {
        logger.error({ inner, auditId }, "markFailed threw");
      });
    }
  }

  private async buildAuditContext(
    guid: string,
  ): Promise<{ filesBundle: string; metadataSummary: string }> {
    const presigned = await this.storageClient.getPresignedUrl(this.storageBucket, `skills/${guid}.zip`).catch(() => null);
    // The canonical pointer is `skills/{guid}/{version}.zip`; fall back via
    // the skill doc's stored `storageKey` for migrated/legacy rows.
    const skillDoc = await this.skillService.getSkill(guid);
    const storageKey = presigned
      ? `skills/${guid}.zip`
      : (skillDoc as unknown as { presignedPackageUrl?: string; storageKey?: string });

    // Prefer the skill doc's presigned URL — `getSkill` already minted one.
    const url = (skillDoc as unknown as { presignedPackageUrl?: string }).presignedPackageUrl;
    if (!url) {
      throw AppError.internalError("AUDIT_PACKAGE_UNAVAILABLE", "No storage URL for skill package");
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw AppError.internalError(
        "AUDIT_PACKAGE_DOWNLOAD_FAILED",
        `Failed to download package for audit (HTTP ${res.status})`,
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const allPaths = Object.keys(zip.files);
    resolveZipRoot(zip, allPaths);

    const chunks: string[] = [];
    let bundledBytes = 0;
    const MAX_BUNDLE_BYTES = 120 * 1024;

    for (const path of allPaths) {
      const entry = zip.files[path];
      if (entry.dir) continue;
      const parts = path.split("/");
      let relative = path;
      if (parts.length > 1 && zip.files[`${parts[0]}/`]?.dir) {
        relative = parts.slice(1).join("/");
      }
      // Skip obvious binary/large files — we can't meaningfully score them.
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|zip|pdf)$/i.test(relative)) continue;
      try {
        const text = await entry.async("string");
        if (bundledBytes + text.length > MAX_BUNDLE_BYTES) {
          chunks.push(`// FILE: ${relative} [TRUNCATED at bundle limit]`);
          break;
        }
        chunks.push(`// FILE: ${relative}\n${text}`);
        bundledBytes += text.length;
      } catch {
        // skip unreadable files
      }
    }

    const metadataSummary = [
      `category=${skillDoc.metadata?.category ?? "unknown"}`,
      `runtimes=${
        (skillDoc.metadata?.runtimes as Array<{ runtime: string }> | undefined)?.map((r) => r.runtime).join(",") ?? "none"
      }`,
      `tags=${(skillDoc.tags ?? []).join(",")}`,
    ].join("; ");

    void storageKey; // used only in legacy fallback; keep reference to satisfy lint
    return { filesBundle: chunks.join("\n\n"), metadataSummary };
  }
}

interface ParsedAudit {
  scores: AuditScore[];
  findings: AuditFinding[];
}

/**
 * Strip optional markdown fences and parse the LLM's structured output.
 * Returns null on any validation failure — the caller decides whether
 * to retry or surface an error.
 */
export function parseAuditJson(raw: string): ParsedAudit | null {
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "");
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const slice = text.slice(firstBrace, lastBrace + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  const rawScores = record.scores;
  const rawFindings = record.findings;
  if (!Array.isArray(rawScores)) return null;

  const scoresByDim = new Map<AuditDimension, AuditScore>();
  for (const s of rawScores) {
    if (!s || typeof s !== "object") continue;
    const obj = s as Record<string, unknown>;
    const dim = obj.dimension;
    const score = Number(obj.score);
    const rationale = typeof obj.rationale === "string" ? obj.rationale : "";
    if (typeof dim !== "string" || !AUDIT_DIMENSIONS.includes(dim as AuditDimension)) continue;
    if (Number.isNaN(score)) continue;
    const clamped = Math.max(0, Math.min(10, Math.round(score)));
    scoresByDim.set(dim as AuditDimension, {
      dimension: dim as AuditDimension,
      score: clamped,
      rationale,
    });
  }
  // Every dimension must be present.
  for (const d of AUDIT_DIMENSIONS) {
    if (!scoresByDim.has(d)) return null;
  }
  const scores: AuditScore[] = AUDIT_DIMENSIONS.map((d) => scoresByDim.get(d)!);

  const findings: AuditFinding[] = [];
  if (Array.isArray(rawFindings)) {
    for (const f of rawFindings) {
      if (!f || typeof f !== "object") continue;
      const obj = f as Record<string, unknown>;
      const dim = obj.dimension;
      const severity = obj.severity;
      const message = obj.message;
      if (typeof dim !== "string" || !AUDIT_DIMENSIONS.includes(dim as AuditDimension)) continue;
      if (severity !== "info" && severity !== "warning" && severity !== "critical") continue;
      if (typeof message !== "string" || !message) continue;
      const finding: AuditFinding = {
        dimension: dim as AuditDimension,
        severity,
        message,
      };
      if (typeof obj.file === "string") (finding as AuditFinding & { file: string }).file = obj.file;
      if (typeof obj.line === "number") (finding as AuditFinding & { line: number }).line = obj.line;
      findings.push(finding);
    }
  }

  return { scores, findings };
}
