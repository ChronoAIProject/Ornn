/**
 * NotificationDetailModal — click-to-popup viewer for any notification
 * row that has body content the list view can't show in full.
 *
 * Two render shapes share the same chrome:
 *   - `source === "broadcast"` — bilingual `titleI18n` / `bodyMarkdownI18n`
 *     resolved against the active locale, body rendered as sanitized
 *     markdown (remark-gfm + rehype-sanitize).
 *   - `source !== "broadcast"` — plain `title` / `body` strings emitted
 *     by the per-user notification service. Body is rendered as
 *     pre-wrapped plain text so admin-supplied notes (#532) survive
 *     newlines and long redemption-code strings without HTML risk.
 *
 * Side effect on open: if `readAt == null`, fires the existing
 * mark-read mutation so the bell badge updates without an extra
 * click. The mutation is passed in by the parent rather than wired
 * here so the modal stays stateless wrt React Query.
 *
 * Motion vocabulary matches ConfirmDialog / Modal: backdrop fade +
 * dialog spring. Close vectors: ESC, backdrop click, explicit ×.
 *
 * @module components/notifications/NotificationDetailModal
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type {
  Notification,
  NotificationCategory,
} from "@/types/notifications";
import { pickLocalized } from "@/lib/announcementLocale";

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  "audit.completed": "Audit",
  "audit.risky_for_consumer": "Audit",
  "quota.credits_granted": "Quota",
  "launchPromo.codeDelivered": "Promo",
  "skillset.member_unreadable": "Skillset",
};

export interface NotificationDetailModalProps {
  /** Notification to display. The modal renders nothing when null. */
  notification: Notification | null;
  onClose: () => void;
  /**
   * Fires once when the modal opens for an unread notification. The
   * parent owns the mark-read mutation so the modal stays stateless.
   */
  onMarkRead?: (id: string) => void;
}

export function NotificationDetailModal({
  notification,
  onClose,
  onMarkRead,
}: NotificationDetailModalProps) {
  const { t, i18n } = useTranslation();
  const isOpen = notification != null;
  const id = notification?._id;
  const readAt = notification?.readAt;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Fire mark-read once per open transition for unread items.
  //
  // The naive form was `useEffect(() => ..., [isOpen, id, readAt, onMarkRead])`
  // with an `if (readAt) return` guard. That looked safe but produced a
  // React #185 update-depth loop in prod (#509):
  //
  //   1. Parents (NotificationBell, NotificationsPage) pass `onMarkRead`
  //      as an inline arrow → new reference every render.
  //   2. `readAt` here reads from the `notification` prop, which is a
  //      snapshot taken when the user clicked — it never updates from
  //      the live query cache after mark-read succeeds.
  //   3. Mutation kicks the parent into an `isPending` rerender →
  //      fresh arrow → effect deps shift → mark-read fires again →
  //      next render → next fire → loop.
  //
  // Two defenses, layered:
  //   (a) Stash `onMarkRead` in a "latest ref" so it can be invoked at
  //       the right time without entering the effect's dep array.
  //   (b) Track the last id we've already marked, so even if the
  //       effect did somehow rerun for the same opened item, we don't
  //       refire the mutation.
  const onMarkReadRef = useRef(onMarkRead);
  useEffect(() => {
    onMarkReadRef.current = onMarkRead;
  });
  const markedForIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      // Reset so reopening the modal (potentially for a different item)
      // is allowed to fire once.
      markedForIdRef.current = null;
      return;
    }
    if (!id || readAt) return;
    if (markedForIdRef.current === id) return;
    markedForIdRef.current = id;
    onMarkReadRef.current?.(id);
  }, [isOpen, id, readAt]);

  if (!notification) return null;

  const lang = i18n.language;
  const isBroadcast = notification.source === "broadcast";
  const titleText =
    notification.titleI18n
      ? pickLocalized(
          notification.titleI18n.en,
          notification.titleI18n.zh,
          lang,
        )
      : notification.title ?? "";
  const bodyMarkdown = notification.bodyMarkdownI18n
    ? pickLocalized(
        notification.bodyMarkdownI18n.en,
        notification.bodyMarkdownI18n.zh,
        lang,
      )
    : "";
  const tagLabel = isBroadcast
    ? t("notifications.broadcast.tag")
    : notification.category
      ? CATEGORY_LABEL[notification.category]
      : "";
  const ariaLabel = isBroadcast
    ? t("notifications.broadcast.modal.aria")
    : t("notifications.detail.modal.aria");
  const plainBody = !isBroadcast ? notification.body ?? "" : "";

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.9 }}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            className="card-impression relative z-10 mx-4 flex w-full max-w-2xl max-h-[80vh] flex-col gap-4 overflow-hidden rounded border border-strong-edge bg-card p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                {tagLabel && (
                  <span className="self-start rounded-sm border border-accent/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
                    {tagLabel}
                  </span>
                )}
                <h2 className="font-display text-xl font-semibold tracking-tight text-strong">
                  {titleText}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="-mr-2 -mt-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="h-5 w-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </header>

            <div className="markdown-body overflow-y-auto font-text text-[15px] leading-relaxed text-body">
              {isBroadcast ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                >
                  {bodyMarkdown}
                </ReactMarkdown>
              ) : (
                <p className="whitespace-pre-wrap break-words">{plainBody}</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
