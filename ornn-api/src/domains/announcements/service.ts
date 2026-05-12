/**
 * Announcement service — thin wrapper around the repo, plus the
 * `getActive()` rule used by the public landing-page endpoint.
 *
 * Validation lives in the route layer (Zod). Business rules here are
 * limited to:
 *   - "Active = enabled + within window, newest first."
 *   - "endsAt must be strictly after startsAt when both are set."
 *
 * @module domains/announcements/service
 */

import pino from "pino";
import { AppError } from "../../shared/types/index";
import type {
  AnnouncementRepository,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from "./repository";
import type {
  AnnouncementDocument,
  PublicAnnouncement,
  PublicAnnouncementListItem,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "announcementService" });

export interface AnnouncementServiceDeps {
  readonly repo: AnnouncementRepository;
  /** Override for tests; defaults to `() => new Date()` in production. */
  readonly clock?: () => Date;
}

export class AnnouncementService {
  private readonly repo: AnnouncementRepository;
  private readonly clock: () => Date;

  constructor(deps: AnnouncementServiceDeps) {
    this.repo = deps.repo;
    this.clock = deps.clock ?? (() => new Date());
  }

  // ---- Public surface ----------------------------------------------------

  /**
   * Returns the announcement to show to landing-page visitors right now,
   * or `null` if none qualifies. Anonymous users hit this endpoint —
   * never include audit fields (`createdBy`, raw timestamps) in the
   * response shape.
   */
  async getActive(): Promise<PublicAnnouncement | null> {
    const doc = await this.repo.findActive(this.clock());
    return doc ? toPublic(doc) : null;
  }

  /**
   * Returns every released announcement for the public News page
   * (#357), newest first. Anonymous-safe — same audit-field discipline
   * as `getActive`, plus a serialized `publishedAt` so the page can
   * render a date eyebrow.
   */
  async listPublished(): Promise<PublicAnnouncementListItem[]> {
    const docs = await this.repo.findAllReleased(this.clock());
    return docs.map(toPublicListItem);
  }

  // ---- Admin surface -----------------------------------------------------

  async listAll(): Promise<AnnouncementDocument[]> {
    return this.repo.listAll();
  }

  async getById(id: string): Promise<AnnouncementDocument> {
    const doc = await this.repo.findById(id);
    if (!doc) {
      throw AppError.notFound("ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
    }
    return doc;
  }

  async create(input: CreateAnnouncementInput): Promise<AnnouncementDocument> {
    this.assertWindowOrder(input.startsAt ?? null, input.endsAt ?? null);
    const doc = await this.repo.create(input);
    logger.info(
      { announcementId: doc._id, enabled: doc.enabled, by: input.createdBy },
      "Announcement created",
    );
    return doc;
  }

  async update(id: string, patch: UpdateAnnouncementInput): Promise<AnnouncementDocument> {
    // When either bound is in the patch, validate against the resulting
    // pair (existing value preserved on the side that wasn't sent).
    if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
      const existing = await this.getById(id);
      const startsAt = patch.startsAt !== undefined ? patch.startsAt : existing.startsAt;
      const endsAt = patch.endsAt !== undefined ? patch.endsAt : existing.endsAt;
      this.assertWindowOrder(startsAt, endsAt);
    }
    const updated = await this.repo.update(id, patch);
    if (!updated) {
      throw AppError.notFound("ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
    }
    logger.info({ announcementId: id, enabled: updated.enabled }, "Announcement updated");
    return updated;
  }

  async delete(id: string): Promise<void> {
    const removed = await this.repo.delete(id);
    if (!removed) {
      throw AppError.notFound("ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
    }
    logger.info({ announcementId: id }, "Announcement deleted");
  }

  private assertWindowOrder(startsAt: Date | null, endsAt: Date | null): void {
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw AppError.badRequest(
        "INVALID_ANNOUNCEMENT_WINDOW",
        "endsAt must be strictly after startsAt",
      );
    }
  }
}

function toPublic(doc: AnnouncementDocument): PublicAnnouncement {
  return {
    id: doc._id,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    ctaLabel: doc.ctaLabel,
    ctaUrl: doc.ctaUrl,
  };
}

function toPublicListItem(doc: AnnouncementDocument): PublicAnnouncementListItem {
  // `publishedAt` = when the announcement was meant to go live. Falls
  // back to `createdAt` when no schedule was set — this is the same
  // semantics used by the popup's "release gate" filter, so the date
  // shown to the user always reflects "when this became visible".
  const publishedAt = (doc.startsAt ?? doc.createdAt).toISOString();
  return {
    ...toPublic(doc),
    publishedAt,
  };
}
