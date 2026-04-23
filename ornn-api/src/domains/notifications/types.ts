/**
 * In-product notification types.
 *
 * Notifications are per-user, durable, and deep-linked to the resource
 * that caused them (typically a share request, a skill, or an audit
 * record). v1 is in-product only — email / push live outside this
 * module.
 *
 * @module domains/notifications/types
 */

export type NotificationCategory =
  | "audit.completed"
  | "share.needs_justification"
  | "share.review_requested"
  | "share.accepted"
  | "share.rejected"
  | "share.cancelled";

export interface NotificationDocument {
  readonly _id: string;
  /** Recipient user id (NyxID user_id). */
  readonly userId: string;
  readonly category: NotificationCategory;
  /** One-line summary for list view. */
  readonly title: string;
  /** Optional longer body rendered on the detail view. Plain text. */
  readonly body?: string;
  /** Deep-link path in the web UI, e.g. `/shares/abc`. */
  readonly link?: string;
  /** Arbitrary structured payload the UI can use (e.g. `{ shareRequestId, verdict }`). */
  readonly data: Record<string, unknown>;
  readonly readAt?: Date | null;
  readonly createdAt: Date;
}
