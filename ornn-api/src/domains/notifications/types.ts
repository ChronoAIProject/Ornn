/**
 * In-product notification types.
 *
 * Notifications are per-user, durable, and deep-linked to the resource
 * that caused them (currently always a skill audit record). v1 is
 * in-product only — email / push live outside this module.
 *
 * @module domains/notifications/types
 */

export type NotificationCategory =
  | "audit.completed"
  | "audit.risky_for_consumer";

export interface NotificationDocument {
  readonly _id: string;
  /** Recipient user id (NyxID user_id). */
  readonly userId: string;
  readonly category: NotificationCategory;
  /** One-line summary for list view. */
  readonly title: string;
  /** Optional longer body rendered on the detail view. Plain text. */
  readonly body?: string;
  /** Deep-link path in the web UI, e.g. `/skills/abc/audits?version=1.0.0`. */
  readonly link?: string;
  /** Arbitrary structured payload the UI can use (e.g. `{ skillGuid, version, verdict }`). */
  readonly data: Record<string, unknown>;
  readonly readAt?: Date | null;
  readonly createdAt: Date;
}
