/**
 * API-audit Mongo repository — one collection, `api_audit`.
 *
 * Writes are fire-and-forget from the middleware: a Mongo outage MUST
 * NOT impact the business response. Indexes serve the four primary read
 * paths the spec calls out (timestamp scan, per-caller history, per-path
 * history, per-callerType slice) plus a TTL index that drops records
 * after `retentionDays`.
 *
 * Reads aren't implemented yet — admin tooling (#C in the issue) will
 * own them. The repository keeps the write surface narrow on purpose so
 * future reads bolt on without changing this contract.
 *
 * Naming: this file owns a class called `ApiAuditRepository` to avoid a
 * collision with `domains/skills/audit/repository.ts`'s `AuditRepository`
 * (skill-content audit, a different subsystem entirely).
 *
 * @module middleware/audit/repository
 */

import type { Collection, Db, Document } from "mongodb";
import pino from "pino";
import type { AuditDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "apiAuditRepository" });

const COLLECTION_NAME = "api_audit";

export class ApiAuditRepository {
  private readonly collection: Collection<Document>;
  private readonly retentionSeconds: number;

  constructor(db: Db, retentionDays: number) {
    this.collection = db.collection(COLLECTION_NAME);
    this.retentionSeconds = Math.max(1, Math.floor(retentionDays * 24 * 60 * 60));
  }

  /**
   * Idempotent index creation. Called from bootstrap with a `void` /
   * fire-and-forget pattern so a Mongo hiccup at startup doesn't block
   * the API from coming up.
   *
   * The TTL index uses `expireAfterSeconds` against `timestamp`. If the
   * operator changes `AUDIT_RETENTION_DAYS` after the index already
   * exists, Mongo throws `IndexOptionsConflict` (code 85 / 86) — we log
   * and continue on that case rather than failing the boot. Operators
   * who need to flip retention drop the existing index out-of-band.
   */
  async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ timestamp: -1 });
      await this.collection.createIndex({ callerIdentity: 1, timestamp: -1 });
      await this.collection.createIndex({ path: 1, timestamp: -1 });
      await this.collection.createIndex({ callerType: 1, timestamp: -1 });
      await this.collection.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: this.retentionSeconds, name: "ttl_timestamp" },
      );
      logger.debug({ retentionSeconds: this.retentionSeconds }, "audit indexes ensured");
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 85 || code === 86) {
        logger.warn({ err }, "audit TTL index exists with different options — keeping existing");
        return;
      }
      logger.error({ err }, "Failed to ensure audit indexes");
    }
  }

  /**
   * Insert an audit doc. Logs and swallows errors — the middleware's
   * contract is that audit failures never propagate to the business
   * response. Returns void; callers don't act on the result.
   */
  async insert(doc: AuditDocument): Promise<void> {
    try {
      await this.collection.insertOne(doc as unknown as Document);
    } catch (err) {
      logger.error(
        { err, auditId: doc._id, path: doc.path },
        "Failed to insert audit doc",
      );
    }
  }
}
