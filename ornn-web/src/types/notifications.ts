/**
 * In-product notification types. Shape mirrors the backend's
 * `NotificationDocument` from `ornn-api/src/domains/notifications/types.ts`
 * with Date fields serialized as ISO strings over the wire.
 *
 * @module types/notifications
 */

export type NotificationCategory =
  | "audit.completed"
  | "audit.risky_for_consumer";

export interface Notification {
  _id: string;
  userId: string;
  category: NotificationCategory;
  /** One-line summary for list / popover. */
  title: string;
  /** Optional longer body rendered on the detail view. Plain text. */
  body?: string;
  /** Deep-link path within the web UI, e.g. `/skills/abc/audits?version=1.0.0`. */
  link?: string;
  /** Arbitrary structured payload the UI can lean on (e.g. `{ skillGuid, version, verdict }`). */
  data: Record<string, unknown>;
  /** ISO timestamp set when the recipient read this notification; `null`/`undefined` = unread. */
  readAt?: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
}
