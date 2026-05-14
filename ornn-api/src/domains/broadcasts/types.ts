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
  /**
   * Targeting list (#502). `null` means broadcast to every user (the
   * #500 default). A non-empty `string[]` of NyxID user_ids means the
   * broadcast is only visible to those specific users — the merged
   * feed, unread count, and markAllRead are filtered accordingly.
   *
   * **Immutable after create.** PATCH never changes this field — we
   * can't yank a message back from a user who has already seen it, so
   * the targeting decision is frozen at create time. The repository's
   * `update` input type omits the field to enforce this at the
   * compile boundary.
   */
  readonly recipientUserIds: readonly string[] | null;
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
  /**
   * Targeting list (#502). Always present on the wire — `null` for an
   * everyone-broadcast, non-empty array for a targeted broadcast.
   * Absent in the persisted doc is normalised to `null` by the read
   * service so the wire shape is stable.
   */
  readonly recipientUserIds: readonly string[] | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readCount: number;
}
