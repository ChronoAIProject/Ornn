/**
 * NotificationDetailModal — click-to-popup viewer for a broadcast-source
 * notification.
 *
 * Renders the bilingual broadcast in full: locale-resolved title as the
 * modal heading, locale-resolved markdown body sanitized through the
 * same safe stack used by AnnouncementPopup (`remark-gfm` +
 * `rehype-sanitize`).
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

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Notification } from "@/types/notifications";
import { pickLocalized } from "@/lib/announcementLocale";

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

  // Fire mark-read once per open transition for unread items. Guarding
  // on `id + readAt` makes this idempotent if the parent rerenders.
  useEffect(() => {
    if (!isOpen || !id || readAt || !onMarkRead) return;
    onMarkRead(id);
  }, [isOpen, id, readAt, onMarkRead]);

  if (!notification) return null;

  const lang = i18n.language;
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
            aria-label={t("notifications.broadcast.modal.aria")}
            className="card-impression relative z-10 mx-4 flex w-full max-w-2xl max-h-[80vh] flex-col gap-4 overflow-hidden rounded border border-strong-edge bg-card p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="self-start rounded-sm border border-accent/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
                  {t("notifications.broadcast.tag")}
                </span>
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
              >
                {bodyMarkdown}
              </ReactMarkdown>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
