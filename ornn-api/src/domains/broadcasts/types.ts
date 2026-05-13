/**
 * Broadcast (admin-authored, all-user inbox) domain types — #500.
 *
 * Broadcasts are messages an admin authors that land in every user's
 * notification inbox (the same `NotificationBell` that surfaces
 * per-user notifications today). Admin can edit (users see latest) and
 * delete (users no longer see it). No scheduling; visible from create
 * time until delete. Hard delete cascades read receipts.
 *
 * **Bilingual content (en + zh, both required).** Unlike announcements
 * — where ZH is optional and the frontend falls back to EN — broadcasts
 * require both locales at create time. The wire format groups them as
 * nested objects (`titleI18n: { en, zh }`) instead of flattened columns
 * because each broadcast carries exactly one title pair + one body
 * pair; the nested shape keeps the field count low and makes patching a
 * single locale unambiguous.
 *
 * Per-user read state lives in a separate `broadcast_read_receipts`
 * collection rather than embedded in the broadcast doc — it scales with
 * (users × broadcasts) rather than mutating a hot doc on every read.
 *
 * @module domains/broadcasts/types
 */

/**
 * Bilingual string pair used for `titleI18n` / `bodyMarkdownI18n` on the
 * broadcast doc. Both locales required at create time; PATCH allows
 * either locale's slot to be omitted but a provided locale string must
 * be non-empty.
 */
export interface BroadcastI18nString {
  readonly en: string;
  readonly zh: string;
}

export interface BroadcastDocument {
  readonly _id: string;
  readonly titleI18n: BroadcastI18nString;
  readonly bodyMarkdownI18n: BroadcastI18nString;
  /** NyxID user_id of the admin who authored this broadcast. */
  readonly createdBy: string;
  /** NyxID user_id of the admin who last edited; equals `createdBy` on create. */
  readonly updatedBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Per-user read receipt. `(userId, broadcastId)` is unique — repeat
 * markReads collapse onto the existing row rather than inserting.
 */
export interface BroadcastReadReceiptDocument {
  readonly _id: string;
  readonly userId: string;
  readonly broadcastId: string;
  readonly readAt: Date;
}

/**
 * Admin-side response shape. Includes audit fields + `readCount`
 * (number of distinct users who have read this broadcast). The admin
 * list view doubles as broadcast history, so timestamps + read count
 * are first-class.
 */
export interface AdminBroadcastResponse {
  readonly id: string;
  readonly titleI18n: BroadcastI18nString;
  readonly bodyMarkdownI18n: BroadcastI18nString;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readCount: number;
}

/**
 * User-facing projection embedded into the merged `/notifications`
 * feed. Broadcasts surface alongside per-user notifications; the
 * `source: "broadcast"` discriminator lets the UI render them with
 * markdown + bilingual title/body, whereas `source: "user"` items keep
 * the existing single-string title/body shape.
 *
 * `readAt` is left-joined from `broadcast_read_receipts` — `null`
 * when this user has not read the broadcast yet. The `createdAt`
 * ordering key is preserved so the bell can sort the merged feed by
 * recency.
 */
export interface UserBroadcastFeedItem {
  readonly id: string;
  readonly source: "broadcast";
  readonly titleI18n: BroadcastI18nString;
  readonly bodyMarkdownI18n: BroadcastI18nString;
  readonly createdAt: string;
  readonly readAt: string | null;
}
