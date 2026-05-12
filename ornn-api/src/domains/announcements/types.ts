/**
 * Announcement (landing-page popup) domain types.
 *
 * Single-active model: at most one announcement is shown to visitors at
 * a time. Admin curates the list; the public surface picks the most
 * recently-created enabled record currently within its `[startsAt, endsAt]`
 * window. A null bound means open-ended on that side.
 *
 * @module domains/announcements/types
 */

export interface AnnouncementDocument {
  readonly _id: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly ctaLabel: string | null;
  readonly ctaUrl: string | null;
  readonly enabled: boolean;
  /** Optional start of the visibility window. `null` = no lower bound. */
  readonly startsAt: Date | null;
  /** Optional end of the visibility window (exclusive). `null` = no upper bound. */
  readonly endsAt: Date | null;
  /** NyxID user_id of the admin who created the announcement. */
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Shape returned to anonymous landing-page visitors. Strips internal
 * scheduling + audit fields — the SPA only needs what it renders.
 */
export interface PublicAnnouncement {
  readonly id: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly ctaLabel: string | null;
  readonly ctaUrl: string | null;
}

/**
 * Shape returned by the public list endpoint (#357 News page). Adds
 * a serialized publish timestamp so the page can render a date eyebrow
 * above each entry. `publishedAt` is `startsAt ?? createdAt` — i.e.,
 * when the announcement was meant to go live, falling back to its
 * authoring time when no schedule was set.
 */
export interface PublicAnnouncementListItem extends PublicAnnouncement {
  readonly publishedAt: string;
}
