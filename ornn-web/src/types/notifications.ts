/**
 * In-product notification types. Shape mirrors the backend's
 * `NotificationDocument` from `ornn-api/src/domains/notifications/types.ts`
 * with Date fields serialized as ISO strings over the wire.
 *
 * @module types/notifications
 */

export type NotificationCategory =
  | "audit.completed"
  | "audit.risky_for_consumer"
  | "quota.credits_granted";

/**
 * Discriminator marking whether this row was lifted out of the
 * per-user `notifications` collection (`"user"`) or merged in from
 * the global `broadcasts` collection (`"broadcast"`). Broadcast items
 * carry bilingual `titleI18n` + `bodyMarkdownI18n` fields the renderer
 * resolves against the active locale; user items carry the legacy
 * plain-text `title` + optional `body` fields.
 */
export type NotificationSource = "user" | "broadcast";

/** Bilingual text pair, mirrors the backend's broadcast schema. */
export interface NotificationBilingualText {
  en: string;
  zh: string;
}

export interface Notification {
  _id: string;
  /**
   * Absent on broadcast items (broadcasts have no per-user `userId` —
   * they're global). Always present on user items.
   */
  userId?: string;
  /**
   * Present on user-source items, absent on broadcast-source items.
   * Renderers must guard via `source` before keying off `category`.
   */
  category?: NotificationCategory;
  /**
   * Optional on broadcast items (locale-resolved at render time from
   * `titleI18n`). Always present on user items.
   */
  title?: string;
  /** Optional longer body for user items. Plain text. */
  body?: string;
  /** Deep-link path within the web UI, e.g. `/skills/abc/audits?version=1.0.0`. */
  link?: string;
  /** Arbitrary structured payload the UI can lean on (e.g. `{ skillGuid, version, verdict }`). */
  data?: Record<string, unknown>;
  /** ISO timestamp set when the recipient read this notification; `null`/`undefined` = unread. */
  readAt?: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /**
   * Merge-feed discriminator. Backend sets this on every row so the
   * client can render broadcasts (bilingual + markdown body) differently
   * from per-user notifications (plain text). Defaults to `"user"` for
   * backwards compatibility with rows that pre-date the merge.
   */
  source?: NotificationSource;
  /** Bilingual title — present iff `source === "broadcast"`. */
  titleI18n?: NotificationBilingualText;
  /** Bilingual markdown body — present iff `source === "broadcast"`. */
  bodyMarkdownI18n?: NotificationBilingualText;
}
