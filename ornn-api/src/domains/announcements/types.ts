/**
 * Announcement (landing-page popup) domain types.
 *
 * Single-active model: at most one announcement is shown to visitors at
 * a time. Admin curates the list; the public surface picks the most
 * recently-created enabled record currently within its `[startsAt, endsAt]`
 * window. A null bound means open-ended on that side.
 *
 * **Bilingual content (en + zh).** Title, body, and CTA label are stored
 * per-locale with flat field names (`titleEn` / `titleZh` etc.). EN is
 * the canonical / required content; ZH is optional — the frontend
 * resolves at render time, falling back to EN whenever the active
 * locale's slot is empty.
 *
 * @module domains/announcements/types
 */

export interface AnnouncementDocument {
  readonly _id: string;
  /** English title — required, non-empty. */
  readonly titleEn: string;
  /** Chinese title — optional; empty string when unset. Frontend falls back to `titleEn`. */
  readonly titleZh: string;
  /** English body markdown — required, non-empty. */
  readonly bodyMarkdownEn: string;
  /** Chinese body markdown — optional; empty string when unset. Frontend falls back to `bodyMarkdownEn`. */
  readonly bodyMarkdownZh: string;
  /** English CTA label. Non-null iff `ctaUrl` is non-null. */
  readonly ctaLabelEn: string | null;
  /** Chinese CTA label. Optional even when `ctaUrl` is set; frontend falls back to `ctaLabelEn`. */
  readonly ctaLabelZh: string | null;
  /** Single CTA URL (locale-independent). */
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
 * Shape returned to anonymous landing-page visitors. Returns BOTH locales
 * so the SPA can switch languages without a refetch. Strips internal
 * scheduling + audit fields — the SPA only needs what it renders.
 */
export interface PublicAnnouncement {
  readonly id: string;
  readonly titleEn: string;
  readonly titleZh: string;
  readonly bodyMarkdownEn: string;
  readonly bodyMarkdownZh: string;
  readonly ctaLabelEn: string | null;
  readonly ctaLabelZh: string | null;
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
