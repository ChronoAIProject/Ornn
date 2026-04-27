/**
 * Persistence layer for skill audits. Each call to "Start Auditing"
 * inserts a new row keyed by a UUID — never overwrites. The row starts
 * life as `status: "running"` and is updated in place to
 * `completed`/`failed` when the LLM pipeline finishes.
 *
 * @module domains/skills/audit/repository
 */

import { randomUUID } from "node:crypto";
import type { Db, Collection, Document } from "mongodb";
import pino from "pino";
import type {
  AuditFinding,
  AuditRecord,
  AuditScore,
  AuditStatus,
  AuditVerdict,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "auditRepository" });

export interface CreateRunningInput {
  skillGuid: string;
  version: string;
  skillHash: string;
  model: string;
  triggeredBy: string;
}

export interface CompleteAuditInput {
  verdict: AuditVerdict;
  overallScore: number;
  scores: ReadonlyArray<AuditScore>;
  findings: ReadonlyArray<AuditFinding>;
}

export class AuditRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("skill_audits");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.collection.createIndex({ skillGuid: 1, version: 1 }, { unique: false }),
        this.collection.createIndex({ skillGuid: 1, skillHash: 1 }, { unique: false }),
        this.collection.createIndex({ skillGuid: 1, createdAt: -1 }),
        this.collection.createIndex({ createdAt: -1 }),
      ]);
    } catch (err) {
      logger.error({ err }, "Failed to create audit indexes");
    }
  }

  /**
   * Persist a fresh audit at `status: "running"`. The caller is expected
   * to kick off the pipeline and call `markCompleted`/`markFailed` with
   * this row's `_id` later. The record is visible to the UI immediately
   * so the user gets feedback that something is happening.
   */
  async createRunning(input: CreateRunningInput): Promise<AuditRecord> {
    const createdAt = new Date();
    const doc: Document = {
      _id: randomUUID() as unknown as Document["_id"],
      skillGuid: input.skillGuid,
      version: input.version,
      skillHash: input.skillHash,
      status: "running",
      verdict: "yellow", // placeholder; recomputed on complete
      overallScore: 0,
      scores: [],
      findings: [],
      model: input.model,
      createdAt,
      triggeredBy: input.triggeredBy,
    };
    await this.collection.insertOne(doc);
    logger.info(
      { auditId: doc._id, skillGuid: input.skillGuid, version: input.version },
      "Audit run created (running)",
    );
    return mapDoc(doc)!;
  }

  /** Transition `running` → `completed` with the final pipeline output. */
  async markCompleted(auditId: string, result: CompleteAuditInput): Promise<AuditRecord | null> {
    const completedAt = new Date();
    const updated = await this.collection.findOneAndUpdate(
      { _id: auditId as unknown as Document["_id"] },
      {
        $set: {
          status: "completed" satisfies AuditStatus,
          verdict: result.verdict,
          overallScore: result.overallScore,
          scores: result.scores,
          findings: result.findings,
          completedAt,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) return null;
    logger.info(
      {
        auditId,
        verdict: result.verdict,
        overallScore: result.overallScore,
      },
      "Audit run completed",
    );
    return mapDoc(updated);
  }

  /** Transition `running` → `failed` so the user sees the outcome. */
  async markFailed(auditId: string, errorMessage: string): Promise<AuditRecord | null> {
    const completedAt = new Date();
    const updated = await this.collection.findOneAndUpdate(
      { _id: auditId as unknown as Document["_id"] },
      {
        $set: {
          status: "failed" satisfies AuditStatus,
          errorMessage: errorMessage.slice(0, 500),
          completedAt,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) return null;
    logger.warn({ auditId, errorMessage }, "Audit run failed");
    return mapDoc(updated);
  }

  /**
   * Fetch the most recent audit for (skill, version). Used for single-
   * record reads (e.g. the latest score surfaced on SkillDetailPage).
   * Includes running rows so the UI can distinguish "not audited yet"
   * from "audit in flight".
   */
  async findLatestBySkillAndVersion(
    skillGuid: string,
    version: string,
  ): Promise<AuditRecord | null> {
    const doc = await this.collection
      .find({ skillGuid, version })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    return mapDoc(doc);
  }

  /**
   * List every audit record stored for a skill, newest first. Includes
   * every status so the user sees running/failed runs too.
   */
  async listBySkillGuid(skillGuid: string): Promise<ReadonlyArray<AuditRecord>> {
    const docs = await this.collection
      .find({ skillGuid })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((d) => mapDoc(d)!).filter((r): r is AuditRecord => r !== null);
  }

  /**
   * Cache hit check — returns the most recent *completed* audit when the
   * skill bytes match. Running rows are ignored (they can't serve as a
   * gate for sharing, and they might end up failed).
   */
  async findCachedByHash(
    skillGuid: string,
    skillHash: string,
    maxAgeMs: number,
  ): Promise<AuditRecord | null> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const doc = await this.collection
      .find({
        skillGuid,
        skillHash,
        status: "completed",
        createdAt: { $gte: cutoff },
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    return mapDoc(doc);
  }
}

function mapDoc(doc: Document | null): AuditRecord | null {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    skillGuid: String(doc.skillGuid),
    version: String(doc.version),
    skillHash: String(doc.skillHash),
    status: (doc.status as AuditStatus) ?? "completed",
    verdict: doc.verdict as AuditVerdict,
    overallScore: Number(doc.overallScore ?? 0),
    scores: (doc.scores as AuditScore[]) ?? [],
    findings: (doc.findings as AuditFinding[]) ?? [],
    model: String(doc.model ?? ""),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
    completedAt:
      doc.completedAt instanceof Date
        ? doc.completedAt
        : doc.completedAt
          ? new Date(doc.completedAt)
          : undefined,
    errorMessage: doc.errorMessage ? String(doc.errorMessage) : undefined,
    triggeredBy: String(doc.triggeredBy ?? "system"),
  };
}
