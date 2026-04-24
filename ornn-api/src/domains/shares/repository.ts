/**
 * ShareRequest repository — a single Mongo collection, small surface.
 *
 * @module domains/shares/repository
 */

import { randomUUID } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
import pino from "pino";
import type {
  ShareJustifications,
  ShareRequest,
  ShareReviewerDecision,
  ShareStatus,
  ShareTarget,
} from "./types";
import type { AuditVerdict } from "../skills/audit/types";

const logger = pino({ level: "info" }).child({ module: "shareRepository" });

export interface CreateShareRequestInput {
  skillGuid: string;
  skillVersion: string;
  skillHash: string;
  ownerUserId: string;
  target: ShareTarget;
  initialStatus: ShareStatus;
  auditVerdict?: AuditVerdict;
  auditOverallScore?: number;
  auditRecordId?: string;
}

export class ShareRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("share_requests");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.collection.createIndex({ skillGuid: 1, status: 1 }),
        this.collection.createIndex({ ownerUserId: 1, createdAt: -1 }),
        this.collection.createIndex({ "target.type": 1, "target.id": 1, status: 1 }),
        this.collection.createIndex({ createdAt: -1 }),
      ]);
    } catch (err) {
      logger.error({ err }, "Failed to create share_requests indexes");
    }
  }

  async create(input: CreateShareRequestInput): Promise<ShareRequest> {
    const now = new Date();
    const doc: Document = {
      _id: randomUUID() as unknown as Document["_id"],
      skillGuid: input.skillGuid,
      skillVersion: input.skillVersion,
      skillHash: input.skillHash,
      ownerUserId: input.ownerUserId,
      target: input.target,
      status: input.initialStatus,
      auditVerdict: input.auditVerdict,
      auditOverallScore: input.auditOverallScore,
      auditRecordId: input.auditRecordId,
      createdAt: now,
      updatedAt: now,
    };
    await this.collection.insertOne(doc);
    logger.info(
      { id: doc._id, skillGuid: input.skillGuid, status: input.initialStatus, target: input.target },
      "Share request created",
    );
    return mapDoc(doc)!;
  }

  async findById(id: string): Promise<ShareRequest | null> {
    const doc = await this.collection.findOne({ _id: id as unknown as Document["_id"] });
    return mapDoc(doc);
  }

  async transitionStatus(
    id: string,
    nextStatus: ShareStatus,
    extra: {
      justifications?: ShareJustifications;
      reviewerDecision?: ShareReviewerDecision;
    } = {},
  ): Promise<ShareRequest | null> {
    const set: Record<string, unknown> = { status: nextStatus, updatedAt: new Date() };
    if (extra.justifications) set.justifications = extra.justifications;
    if (extra.reviewerDecision) set.reviewerDecision = extra.reviewerDecision;
    await this.collection.updateOne(
      { _id: id as unknown as Document["_id"] },
      { $set: set },
    );
    return this.findById(id);
  }

  async listByOwner(ownerUserId: string, limit = 50): Promise<ShareRequest[]> {
    const docs = await this.collection
      .find({ ownerUserId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Reviewer queue.
   *
   *   - targetType = "user"   → recipient reviews: target.id = reviewerUserId
   *   - targetType = "org"    → org admin reviews: target.id ∈ reviewerOrgIds
   *   - targetType = "public" → Ornn platform admin reviews: caller opts in via `includePublic`
   */
  async listReviewQueue(params: {
    reviewerUserId: string;
    reviewerOrgIds: string[];
    includePublic: boolean;
    limit: number;
  }): Promise<ShareRequest[]> {
    const orConditions: Array<Record<string, unknown>> = [
      { "target.type": "user", "target.id": params.reviewerUserId },
    ];
    if (params.reviewerOrgIds.length > 0) {
      orConditions.push({ "target.type": "org", "target.id": { $in: params.reviewerOrgIds } });
    }
    if (params.includePublic) {
      orConditions.push({ "target.type": "public" });
    }
    const docs = await this.collection
      .find({ status: "pending-review", $or: orConditions })
      .sort({ createdAt: -1 })
      .limit(params.limit)
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Historical review log — every share request where the caller is the
   * recorded reviewer. Used by the "Review History" admin page so a
   * reviewer can see their past decisions.
   */
  async listByReviewer(reviewerUserId: string, limit = 100): Promise<ShareRequest[]> {
    const docs = await this.collection
      .find({ "reviewerDecision.reviewerUserId": reviewerUserId })
      .sort({ "reviewerDecision.reviewedAt": -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }
}

function mapDoc(doc: Document | null): ShareRequest | null {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    skillGuid: String(doc.skillGuid),
    skillVersion: String(doc.skillVersion),
    skillHash: String(doc.skillHash),
    ownerUserId: String(doc.ownerUserId),
    target: doc.target as ShareTarget,
    status: doc.status as ShareStatus,
    auditVerdict: doc.auditVerdict,
    auditOverallScore: typeof doc.auditOverallScore === "number" ? doc.auditOverallScore : undefined,
    auditRecordId: doc.auditRecordId ? String(doc.auditRecordId) : undefined,
    justifications: doc.justifications
      ? {
          whyCannotPass: String(doc.justifications.whyCannotPass ?? ""),
          whySafe: String(doc.justifications.whySafe ?? ""),
          whyShare: String(doc.justifications.whyShare ?? ""),
          submittedAt:
            doc.justifications.submittedAt instanceof Date
              ? doc.justifications.submittedAt
              : new Date(doc.justifications.submittedAt),
        }
      : undefined,
    reviewerDecision: doc.reviewerDecision
      ? {
          decision: doc.reviewerDecision.decision,
          note: doc.reviewerDecision.note,
          reviewerUserId: String(doc.reviewerDecision.reviewerUserId),
          reviewedAt:
            doc.reviewerDecision.reviewedAt instanceof Date
              ? doc.reviewerDecision.reviewedAt
              : new Date(doc.reviewerDecision.reviewedAt),
        }
      : undefined,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt),
  };
}
