/**
 * Share-request service.
 *
 * Orchestrates the audit-gated share flow (#94 / #95 / #96 / #97):
 *
 *   1. `initiateShare` — kicks off audit, stamps initial status.
 *   2. `submitJustification` — owner path when audit didn't pass.
 *   3. `review` — reviewer accept/reject.
 *   4. `cancel` — owner aborts before review.
 *
 * Actually granting the share (adding to `sharedWithUsers` /
 * flipping `isPrivate`) is done via the existing skillService when we
 * reach an `accepted` terminal state; this service does not touch the
 * skill doc directly.
 *
 * @module domains/shares/service
 */

import pino from "pino";
import { AppError } from "../../shared/types/index";
import type { AuditService } from "../skills/audit/service";
import type { SkillService } from "../skills/crud/service";
import type { ShareRepository } from "./repository";
import type {
  ShareJustifications,
  ShareRequest,
  ShareStatus,
  ShareTarget,
  ShareTargetType,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "shareService" });

export interface ShareServiceDeps {
  readonly shareRepo: ShareRepository;
  readonly auditService: AuditService;
  readonly skillService: SkillService;
}

export interface InitiateShareInput {
  skillIdOrName: string;
  ownerUserId: string;
  target: ShareTarget;
}

export interface SubmitJustificationInput {
  whyCannotPass: string;
  whySafe: string;
  whyShare: string;
}

export class ShareService {
  private readonly shareRepo: ShareRepository;
  private readonly auditService: AuditService;
  private readonly skillService: SkillService;

  constructor(deps: ShareServiceDeps) {
    this.shareRepo = deps.shareRepo;
    this.auditService = deps.auditService;
    this.skillService = deps.skillService;
  }

  /**
   * Initiate a share — run audit, decide initial status.
   *
   * - Green verdict → the share is granted immediately and the request
   *   lands in status `green`.
   * - Anything else → the request sits at `needs-justification` waiting
   *   for the owner.
   */
  async initiateShare(input: InitiateShareInput): Promise<ShareRequest> {
    const skill = await this.skillService.getSkill(input.skillIdOrName);
    if (skill.createdBy !== input.ownerUserId) {
      throw AppError.forbidden(
        "NOT_SKILL_OWNER",
        "Only the skill's author can initiate a share",
      );
    }
    validateTarget(input.target);

    // Run (or reuse cached) audit for this specific package.
    const audit = await this.auditService.runAudit(skill.guid, {
      triggeredBy: input.ownerUserId,
      force: false,
    });

    const initialStatus: ShareStatus =
      audit.verdict === "green" ? "green" : "needs-justification";

    const request = await this.shareRepo.create({
      skillGuid: skill.guid,
      skillVersion: skill.version,
      skillHash: skill.skillHash,
      ownerUserId: input.ownerUserId,
      target: input.target,
      initialStatus,
      auditVerdict: audit.verdict,
      auditOverallScore: audit.overallScore,
      auditRecordId: audit._id,
    });

    if (initialStatus === "green") {
      await this.applyAcceptedShare(skill.guid, input.target, input.ownerUserId);
    }

    logger.info(
      {
        shareRequestId: request._id,
        skillGuid: skill.guid,
        status: initialStatus,
        verdict: audit.verdict,
      },
      "Share initiated",
    );
    return request;
  }

  async submitJustification(
    requestId: string,
    ownerUserId: string,
    input: SubmitJustificationInput,
  ): Promise<ShareRequest> {
    const request = await this.mustFind(requestId);
    if (request.ownerUserId !== ownerUserId) {
      throw AppError.forbidden("NOT_SHARE_OWNER", "Only the share owner can submit justifications");
    }
    if (request.status !== "needs-justification") {
      throw AppError.conflict(
        "INVALID_SHARE_TRANSITION",
        `Cannot submit justifications in status '${request.status}'`,
      );
    }
    for (const [k, v] of [
      ["whyCannotPass", input.whyCannotPass],
      ["whySafe", input.whySafe],
      ["whyShare", input.whyShare],
    ] as const) {
      if (typeof v !== "string" || v.trim().length < 10) {
        throw AppError.badRequest(
          "JUSTIFICATION_TOO_SHORT",
          `'${k}' must be at least 10 characters`,
        );
      }
    }
    const justifications: ShareJustifications = {
      whyCannotPass: input.whyCannotPass.trim(),
      whySafe: input.whySafe.trim(),
      whyShare: input.whyShare.trim(),
      submittedAt: new Date(),
    };
    const updated = await this.shareRepo.transitionStatus(requestId, "pending-review", {
      justifications,
    });
    if (!updated) {
      throw AppError.internalError("SHARE_UPDATE_FAILED", "Failed to persist share transition");
    }
    return updated;
  }

  async review(
    requestId: string,
    reviewerUserId: string,
    reviewerOrgIds: string[],
    isPlatformAdmin: boolean,
    decision: "accept" | "reject",
    note: string | undefined,
  ): Promise<ShareRequest> {
    const request = await this.mustFind(requestId);
    if (request.status !== "pending-review") {
      throw AppError.conflict(
        "INVALID_SHARE_TRANSITION",
        `Cannot review in status '${request.status}'`,
      );
    }
    if (!this.isAuthorizedReviewer(request, reviewerUserId, reviewerOrgIds, isPlatformAdmin)) {
      throw AppError.forbidden(
        "NOT_SHARE_REVIEWER",
        "Caller is not an authorized reviewer for this share",
      );
    }
    const finalStatus: ShareStatus = decision === "accept" ? "accepted" : "rejected";
    const updated = await this.shareRepo.transitionStatus(requestId, finalStatus, {
      reviewerDecision: {
        decision,
        note,
        reviewerUserId,
        reviewedAt: new Date(),
      },
    });
    if (!updated) {
      throw AppError.internalError("SHARE_UPDATE_FAILED", "Failed to persist review decision");
    }
    if (decision === "accept") {
      await this.applyAcceptedShare(
        request.skillGuid,
        request.target,
        request.ownerUserId,
      );
    }
    logger.info(
      { shareRequestId: requestId, reviewerUserId, decision, finalStatus },
      "Share reviewed",
    );
    return updated;
  }

  async cancel(requestId: string, ownerUserId: string): Promise<ShareRequest> {
    const request = await this.mustFind(requestId);
    if (request.ownerUserId !== ownerUserId) {
      throw AppError.forbidden("NOT_SHARE_OWNER", "Only the share owner can cancel this request");
    }
    if (
      request.status !== "needs-justification" &&
      request.status !== "pending-review" &&
      request.status !== "pending-audit"
    ) {
      throw AppError.conflict(
        "INVALID_SHARE_TRANSITION",
        `Cannot cancel in status '${request.status}'`,
      );
    }
    const updated = await this.shareRepo.transitionStatus(requestId, "cancelled");
    return updated!;
  }

  async get(requestId: string, callerUserId: string, isPlatformAdmin: boolean): Promise<ShareRequest> {
    const request = await this.mustFind(requestId);
    const isOwner = request.ownerUserId === callerUserId;
    const isDirectRecipient =
      request.target.type === "user" && request.target.id === callerUserId;
    if (!isOwner && !isDirectRecipient && !isPlatformAdmin) {
      // Org-admin case is handled at the route level via reviewerOrgIds. For
      // get-by-id we fall back to owner / recipient / platform admin. Org
      // admins who aren't in one of those roles can still see the request
      // via the review-queue listing.
      throw AppError.notFound("SHARE_NOT_FOUND", "Share request not found");
    }
    return request;
  }

  async listMine(ownerUserId: string, limit = 50): Promise<ShareRequest[]> {
    return this.shareRepo.listByOwner(ownerUserId, limit);
  }

  async listReviewQueue(params: {
    reviewerUserId: string;
    reviewerOrgIds: string[];
    isPlatformAdmin: boolean;
    limit?: number;
  }): Promise<ShareRequest[]> {
    return this.shareRepo.listReviewQueue({
      reviewerUserId: params.reviewerUserId,
      reviewerOrgIds: params.reviewerOrgIds,
      includePublic: params.isPlatformAdmin,
      limit: params.limit ?? 50,
    });
  }

  // ---- Internals ---------------------------------------------------------

  private async mustFind(requestId: string): Promise<ShareRequest> {
    const request = await this.shareRepo.findById(requestId);
    if (!request) {
      throw AppError.notFound("SHARE_NOT_FOUND", `Share request '${requestId}' not found`);
    }
    return request;
  }

  private isAuthorizedReviewer(
    request: ShareRequest,
    reviewerUserId: string,
    reviewerOrgIds: string[],
    isPlatformAdmin: boolean,
  ): boolean {
    switch (request.target.type) {
      case "user":
        return request.target.id === reviewerUserId;
      case "org":
        return reviewerOrgIds.includes(request.target.id ?? "");
      case "public":
        return isPlatformAdmin;
      default:
        return false;
    }
  }

  /**
   * Apply an accepted share to the underlying skill:
   *   - `public` → flip `isPrivate=false`
   *   - `user`   → append to `sharedWithUsers`
   *   - `org`    → append to `sharedWithOrgs`
   *
   * Uses the skill-service's permissions path so all the existing
   * validation / activity logging runs.
   */
  private async applyAcceptedShare(
    skillGuid: string,
    target: ShareTarget,
    actorUserId: string,
  ): Promise<void> {
    // Re-read the latest skill state so we don't clobber concurrent edits.
    const current = await this.skillService.getSkill(skillGuid);
    const nextPrivate =
      target.type === "public" ? false : current.isPrivate;
    const nextUsers = new Set(current.sharedWithUsers);
    const nextOrgs = new Set(current.sharedWithOrgs);
    if (target.type === "user" && target.id) nextUsers.add(target.id);
    if (target.type === "org" && target.id) nextOrgs.add(target.id);

    await this.skillService.setSkillPermissions(skillGuid, actorUserId, {
      isPrivate: nextPrivate,
      sharedWithUsers: Array.from(nextUsers),
      sharedWithOrgs: Array.from(nextOrgs),
    });
  }
}

function validateTarget(target: ShareTarget): void {
  const validTypes: ShareTargetType[] = ["user", "org", "public"];
  if (!validTypes.includes(target.type)) {
    throw AppError.badRequest(
      "INVALID_SHARE_TARGET",
      `Share target type must be one of ${validTypes.join(", ")}`,
    );
  }
  if ((target.type === "user" || target.type === "org") && !target.id) {
    throw AppError.badRequest(
      "INVALID_SHARE_TARGET",
      `Share target type '${target.type}' requires a target id`,
    );
  }
}
