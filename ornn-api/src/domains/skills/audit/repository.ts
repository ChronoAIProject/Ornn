/**
 * Persistence layer for skill audits. Thin wrapper over a single Mongo
 * collection keyed by `${skillGuid}@${version}`.
 *
 * @module domains/skills/audit/repository
 */

import type { Db, Collection, Document } from "mongodb";
import pino from "pino";
import type { AuditRecord, AuditFinding, AuditScore, AuditVerdict } from "./types";

const logger = pino({ level: "info" }).child({ module: "auditRepository" });

export interface CreateAuditInput {
  skillGuid: string;
  version: string;
  skillHash: string;
  verdict: AuditVerdict;
  overallScore: number;
  scores: ReadonlyArray<AuditScore>;
  findings: ReadonlyArray<AuditFinding>;
  model: string;
  triggeredBy: string;
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
        this.collection.createIndex({ createdAt: -1 }),
      ]);
    } catch (err) {
      logger.error({ err }, "Failed to create audit indexes");
    }
  }

  /**
   * Upsert an audit record. Two audits for the exact same bytes collapse
   * to one row (replace in-place) — we only keep the latest for a given
   * skillHash. Different versions / different hashes live as separate
   * rows so the history survives.
   */
  async upsert(input: CreateAuditInput): Promise<AuditRecord> {
    const createdAt = new Date();
    const doc: Document = {
      _id: `${input.skillGuid}@${input.version}` as unknown as Document["_id"],
      skillGuid: input.skillGuid,
      version: input.version,
      skillHash: input.skillHash,
      verdict: input.verdict,
      overallScore: input.overallScore,
      scores: input.scores,
      findings: input.findings,
      model: input.model,
      createdAt,
      triggeredBy: input.triggeredBy,
    };
    await this.collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
    logger.info(
      {
        skillGuid: input.skillGuid,
        version: input.version,
        verdict: input.verdict,
        overallScore: input.overallScore,
      },
      "Audit record upserted",
    );
    return mapDoc(doc)!;
  }

  /** Fetch the audit for a specific (skill, version). */
  async findBySkillAndVersion(skillGuid: string, version: string): Promise<AuditRecord | null> {
    const doc = await this.collection.findOne({ _id: `${skillGuid}@${version}` as unknown as Document["_id"] });
    return mapDoc(doc);
  }

  /**
   * Cache hit check — returns the stored audit when the skill bytes
   * match. The caller passes the current `skillHash`; if a record
   * exists for this hash and the stored record is fresher than
   * `maxAgeMs`, reuse it.
   */
  async findCachedByHash(
    skillGuid: string,
    skillHash: string,
    maxAgeMs: number,
  ): Promise<AuditRecord | null> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const doc = await this.collection.findOne({
      skillGuid,
      skillHash,
      createdAt: { $gte: cutoff },
    });
    return mapDoc(doc);
  }
}

function mapDoc(doc: Document | null): AuditRecord | null {
  if (!doc) return null;
  return {
    _id: doc._id as string,
    skillGuid: String(doc.skillGuid),
    version: String(doc.version),
    skillHash: String(doc.skillHash),
    verdict: doc.verdict as AuditVerdict,
    overallScore: Number(doc.overallScore ?? 0),
    scores: (doc.scores as AuditScore[]) ?? [],
    findings: (doc.findings as AuditFinding[]) ?? [],
    model: String(doc.model ?? ""),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
    triggeredBy: String(doc.triggeredBy ?? "system"),
  };
}
