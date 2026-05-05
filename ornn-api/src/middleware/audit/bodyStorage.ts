/**
 * Audit body offload to MinIO.
 *
 * Bodies (request + response) for write ops or 4xx/5xx responses get
 * gzip-compressed and uploaded to `${MINIO_AUDIT_BUCKET}` under a
 * date-partitioned key. The Mongo doc stores only the key; the bytes
 * live in MinIO. Read 200s skip the offload entirely — the spec says
 * we don't keep their bodies, only metadata.
 *
 * The actual transport reuses `IStorageClient` (the existing
 * chrono-storage HTTP wrapper). Two reasons: (1) bucket isolation and
 * presigned-URL generation already work there, so we don't reimplement
 * them; (2) keeping a single client surface means the deployment / auth
 * story (SA-token forwarding when the URL contains `proxy`) carries
 * over for free.
 *
 * @module middleware/audit/bodyStorage
 */

import { gzipSync } from "node:zlib";
import pino from "pino";
import type { IStorageClient } from "../../clients/storageClient";

const logger = pino({ level: "info" }).child({ module: "auditBodyStorage" });

export interface BodyStoragePutInput {
  /** ULID — used as part of the object key. */
  readonly auditId: string;
  /** "req" or "res" — distinguishes the two halves of one request. */
  readonly side: "req" | "res";
  /** The (already-redacted) JSON-serializable body to persist. */
  readonly body: unknown;
}

export interface BodyStoragePutResult {
  /** Object key written to MinIO, relative to the bucket. */
  readonly key: string;
}

export interface IAuditBodyStorage {
  put(input: BodyStoragePutInput): Promise<BodyStoragePutResult>;
}

export class AuditBodyStorage implements IAuditBodyStorage {
  private readonly storage: IStorageClient;
  private readonly bucket: string;

  constructor(storage: IStorageClient, bucket: string) {
    this.storage = storage;
    this.bucket = bucket;
  }

  async put(input: BodyStoragePutInput): Promise<BodyStoragePutResult> {
    const key = buildKey(input.auditId, input.side, new Date());
    const json = JSON.stringify(input.body ?? null);
    const gzipped = gzipSync(Buffer.from(json, "utf-8"));
    await this.storage.upload(this.bucket, key, gzipped, "application/gzip");
    logger.debug({ key, size: gzipped.byteLength }, "audit body uploaded");
    return { key };
  }
}

/**
 * `YYYY/MM/DD/<auditId>-<side>.json.gz`. Date partitioning keeps prefix
 * scans cheap when forensic queries narrow to a time window. Day
 * granularity matches the TTL anchor (Mongo TTL is per-doc so the day
 * partitioning is informational only — MinIO lifecycle rules expire by
 * key prefix).
 */
function buildKey(auditId: string, side: "req" | "res", at: Date): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(at.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${auditId}-${side}.json.gz`;
}

/** Exposed for unit tests. */
export const _internals = { buildKey };
