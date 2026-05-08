/**
 * Redemption-code lifecycle service.
 *
 *   mint        — admin issues a new code carrying ≥1 surface grants.
 *   list        — paginated admin browse (with status + search filter).
 *   invalidate  — admin retires an active code.
 *   redeem      — caller consumes a code, applying grants to their own
 *                 current-month buckets via `QuotaService.grant`.
 *
 * The single-use guarantee comes from `repo.tryClaimForRedeem` (atomic
 * `findOneAndUpdate`). Grant fan-out happens AFTER the claim — if a
 * mid-loop grant fails we deliberately don't roll back the code's
 * `redeemed` status: the code is consumed, the admin can manually
 * top-up the missing surface from the audit log.
 *
 * @module domains/redemption-codes/service
 */

import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import pino from "pino";
import { isDuplicateKeyError } from "../../shared/types/index";
import type { Surface } from "../quota/types";
import type { QuotaService } from "../quota/service";
import type { RedemptionCodeRepository } from "./repository";
import {
  REDEMPTION_CODE_ALPHABET,
  REDEMPTION_CODE_LENGTH,
  type ActorMeta,
  type RedemptionCodeDoc,
  type RedemptionCodeStatus,
  type RedemptionGrantEntry,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "redemptionCodeService" });

const MINT_RETRY_LIMIT = 5;

export interface RedemptionCodeServiceConfig {
  repo: RedemptionCodeRepository;
  quotaService: QuotaService;
}

export interface MintParams {
  admin: ActorMeta;
  grants: RedemptionGrantEntry[];
  note?: string;
  expiresAt: Date;
  now?: Date;
}

export interface ListParams {
  page: number;
  pageSize: number;
  status?: RedemptionCodeStatus;
  search?: string;
}

export interface ListResult {
  items: RedemptionCodeDoc[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvalidateParams {
  id: string;
  admin: ActorMeta;
  now?: Date;
}

export interface RedeemParams {
  code: string;
  redeemer: ActorMeta;
  permissions: readonly string[] | undefined;
  now?: Date;
}

export interface AppliedGrant {
  surface: Surface;
  amount: number;
  auditId: string;
  monthMarker: string;
  newAdminGrant: number;
}

export interface RedeemResult {
  code: RedemptionCodeDoc;
  appliedGrants: AppliedGrant[];
}

/**
 * Service-level error sentinels. Routes pattern-match on the message
 * prefix to map to the right HTTP status + error code. Using prefix
 * strings rather than a custom subclass keeps this layer independent
 * of the AppError type.
 */
export const REDEEM_ERROR_PREFIXES = [
  "NOT_FOUND",
  "EXPIRED",
  "ALREADY_REDEEMED",
  "ALREADY_INVALIDATED",
] as const;

export class RedemptionCodeService {
  private readonly repo: RedemptionCodeRepository;
  private readonly quotaService: QuotaService;

  constructor(config: RedemptionCodeServiceConfig) {
    this.repo = config.repo;
    this.quotaService = config.quotaService;
  }

  /**
   * Generate one candidate code. The `% alphabet.length` step
   * introduces a sub-1.5% modulo bias (256 % 31), which is harmless
   * for human-shareable IDs since the unique index + retry loop
   * absorbs collisions regardless.
   */
  private generateCode(): string {
    const bytes = randomBytes(REDEMPTION_CODE_LENGTH);
    let out = "";
    for (let i = 0; i < REDEMPTION_CODE_LENGTH; i++) {
      out += REDEMPTION_CODE_ALPHABET[bytes[i] % REDEMPTION_CODE_ALPHABET.length];
    }
    return out;
  }

  async mint(params: MintParams): Promise<RedemptionCodeDoc> {
    const now = params.now ?? new Date();

    if (!Array.isArray(params.grants) || params.grants.length === 0) {
      throw new Error("INVALID_GRANTS: grants must be non-empty");
    }
    const surfaces = new Set(params.grants.map((g) => g.surface));
    if (surfaces.size !== params.grants.length) {
      throw new Error("INVALID_GRANTS: duplicate surface in grants");
    }
    for (const g of params.grants) {
      if (!Number.isInteger(g.amount) || g.amount <= 0) {
        throw new Error(`INVALID_GRANTS: grant amount must be a positive integer (got ${g.amount})`);
      }
    }
    if (!(params.expiresAt instanceof Date) || Number.isNaN(params.expiresAt.getTime())) {
      throw new Error("INVALID_EXPIRES_AT: expiresAt must be a valid Date");
    }
    if (params.expiresAt.getTime() <= now.getTime()) {
      throw new Error("INVALID_EXPIRES_AT: expiresAt must be in the future");
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MINT_RETRY_LIMIT; attempt++) {
      const code = this.generateCode();
      const doc: RedemptionCodeDoc = {
        _id: new ObjectId().toHexString(),
        code,
        grants: params.grants.map((g) => ({ surface: g.surface, amount: g.amount })),
        note: params.note,
        createdAt: now,
        createdBy: params.admin,
        expiresAt: params.expiresAt,
        status: "active",
      };
      try {
        await this.repo.insertCode(doc);
        logger.info(
          {
            codeId: doc._id,
            createdBy: params.admin.userId,
            expiresAt: doc.expiresAt.toISOString(),
            grantCount: doc.grants.length,
          },
          "Redemption code minted",
        );
        return doc;
      } catch (err) {
        lastErr = err;
        if (isDuplicateKeyError(err)) {
          logger.warn(
            { attempt, codeId: doc._id },
            "Redemption code collision — retrying",
          );
          continue;
        }
        throw err;
      }
    }
    logger.error({ err: lastErr }, "Redemption code mint exhausted retries");
    throw new Error(
      `Failed to generate unique redemption code after ${MINT_RETRY_LIMIT} attempts`,
    );
  }

  async list(params: ListParams): Promise<ListResult> {
    const { items, total } = await this.repo.list(params);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async findById(id: string): Promise<RedemptionCodeDoc | null> {
    return this.repo.findById(id);
  }

  async findByCode(code: string): Promise<RedemptionCodeDoc | null> {
    return this.repo.findByCode(code);
  }

  async listRedeemedByUser(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: RedemptionCodeDoc[]; total: number }> {
    return this.repo.listRedeemedByUser(userId, page, pageSize);
  }

  async invalidate(params: InvalidateParams): Promise<RedemptionCodeDoc> {
    const now = params.now ?? new Date();
    const updated = await this.repo.tryInvalidate({
      id: params.id,
      invalidatedBy: params.admin,
      now,
    });
    if (updated) {
      logger.info(
        { codeId: updated._id, invalidatedBy: params.admin.userId },
        "Redemption code invalidated",
      );
      return updated;
    }
    const existing = await this.repo.findById(params.id);
    if (!existing) {
      throw new Error(`NOT_FOUND: redemption code ${params.id}`);
    }
    if (existing.status === "redeemed") {
      throw new Error(
        `ALREADY_REDEEMED: code ${params.id} was already redeemed; cannot invalidate`,
      );
    }
    if (existing.status === "invalidated") {
      throw new Error(`ALREADY_INVALIDATED: code ${params.id} is already invalidated`);
    }
    throw new Error(`NOT_FOUND: redemption code ${params.id} could not be invalidated`);
  }

  async redeem(params: RedeemParams): Promise<RedeemResult> {
    const now = params.now ?? new Date();
    const claimed = await this.repo.tryClaimForRedeem({
      code: params.code,
      redeemedBy: params.redeemer,
      now,
    });

    if (!claimed) {
      const existing = await this.repo.findByCode(params.code);
      if (!existing) {
        throw new Error(`NOT_FOUND: unknown redemption code`);
      }
      if (existing.status === "invalidated") {
        throw new Error(`ALREADY_INVALIDATED: this code has been invalidated`);
      }
      if (existing.status === "redeemed") {
        throw new Error(`ALREADY_REDEEMED: this code has already been redeemed`);
      }
      if (existing.expiresAt.getTime() <= now.getTime()) {
        throw new Error(`EXPIRED: this code expired on ${existing.expiresAt.toISOString()}`);
      }
      // Should not happen — race with another concurrent claim winning.
      throw new Error(`ALREADY_REDEEMED: this code has already been redeemed`);
    }

    const codePrefix = claimed.code.slice(0, 4);
    const applied: AppliedGrant[] = [];
    for (const grant of claimed.grants) {
      // The redeemer is passed as both `admin` and `targetUserId` —
      // grant() requires admin metadata for the audit row. The audit
      // entry transparently shows a self-grant; the note carries the
      // code prefix so it's clear this came from a redemption.
      // Deliberately NO rollback if a later grant fails: the code is
      // already consumed by the atomic pivot above. An admin can
      // top-up the missing surface manually from the audit log.
      const result = await this.quotaService.grant({
        admin: params.redeemer,
        targetUserId: params.redeemer.userId,
        surface: grant.surface,
        amount: grant.amount,
        note: `Redeemed code ${codePrefix}…`,
        now,
      });
      applied.push({
        surface: grant.surface,
        amount: grant.amount,
        auditId: result.auditId,
        monthMarker: result.monthMarker,
        newAdminGrant: result.newAdminGrant,
      });
    }

    logger.info(
      {
        codeId: claimed._id,
        redeemerUserId: params.redeemer.userId,
        surfaces: claimed.grants.map((g) => g.surface),
      },
      "Redemption code redeemed",
    );

    return { code: claimed, appliedGrants: applied };
  }
}
