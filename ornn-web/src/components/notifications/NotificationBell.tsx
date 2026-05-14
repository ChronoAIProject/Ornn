/**
 * Navbar notification bell.
 * Shows an unread-count badge and a popover with the most-recent items.
 * Click an item to navigate + auto-mark-read; "View all" goes to /notifications.
 *
 * Mounted inside Navbar only when the caller is authenticated (the parent
 * gates rendering). Hooks themselves also gate on auth, so a stray mount
 * won't fire a stream of 401s.
 *
 * @module components/notifications/NotificationBell
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/useNotifications";
import type { Notification } from "@/types/notifications";
import { pickLocalized } from "@/lib/announcementLocale";
import { NotificationDetailModal } from "./NotificationDetailModal";

/** Size used in navbar + empty-state. */
const POPOVER_ITEM_CAP = 10;

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [detailNotification, setDetailNotification] =
    useState<Notification | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unread = 0 } = useUnreadNotificationCount();
  // Keep the popover list small — we don't want to pay for 200 items on every
  // navbar render. The full /notifications page has its own list.
  const { data: items = [], isLoading } = useNotifications({ limit: POPOVER_ITEM_CAP });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const visibleItems = useMemo(
    () => items.slice(0, POPOVER_ITEM_CAP),
    [items],
  );

  const lang = i18n.language;

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleItemClick = (n: Notification) => {
    // Broadcasts open a full markdown viewer modal so a user can read
    // long-form content without leaving the page. Mark-read fires from
    // the modal's open effect so the bell badge updates immediately.
    if (n.source === "broadcast") {
      setOpen(false);
      setDetailNotification(n);
      return;
    }
    // User notifications: link wins (audit deep-links go to the audit
    // page). If there's no link but the row carries body text, open
    // the detail modal in place — quota notes are emitted without a
    // link but the body is what the user wants to see (#532). Bare
    // notifications with neither still hand off to the full list page
    // so the click isn't lost.
    if (n.link) {
      if (!n.readAt) markRead.mutate(n._id);
      setOpen(false);
      navigate(n.link);
      return;
    }
    if (n.body) {
      setOpen(false);
      setDetailNotification(n);
      return;
    }
    if (!n.readAt) markRead.mutate(n._id);
    setOpen(false);
    navigate("/notifications");
  };

  /** Resolve the display title for either source. */
  const resolveTitle = (n: Notification): string => {
    if (n.source === "broadcast" && n.titleI18n) {
      return pickLocalized(n.titleI18n.en, n.titleI18n.zh, lang);
    }
    return n.title ?? "";
  };

  /** Resolve the locale-correct markdown body for a broadcast item. */
  const resolveBroadcastBody = (n: Notification): string | null => {
    if (n.source !== "broadcast" || !n.bodyMarkdownI18n) return null;
    return pickLocalized(
      n.bodyMarkdownI18n.en,
      n.bodyMarkdownI18n.zh,
      lang,
    );
  };

  const badgeLabel = unread > 99 ? "99+" : String(unread);

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("notifications.bellAria", "Notifications")}
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm border border-strong-edge bg-transparent text-strong transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full border border-page bg-danger px-1 font-mono text-[10px] font-semibold leading-[14px] text-page">
            {badgeLabel}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded bg-card border border-accent/20 card-impression"
          >
            <div className="flex items-center justify-between border-b border-accent/10 px-4 py-3">
              <span className="font-display text-sm uppercase tracking-wider text-strong">
                {t("notifications.title", "Notifications")}
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="font-text text-xs text-meta transition-colors hover:text-accent cursor-pointer disabled:opacity-50"
                >
                  {t("notifications.markAllRead", "Mark all read")}
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="px-4 py-6 text-center font-text text-sm text-meta">
                  {t("notifications.loading", "Loading…")}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="px-4 py-6 text-center font-text text-sm text-meta">
                  {t("notifications.empty", "You're all caught up.")}
                </div>
              ) : (
                visibleItems.map((n) => {
                  const isBroadcast = n.source === "broadcast";
                  const title = resolveTitle(n);
                  const broadcastBody = resolveBroadcastBody(n);
                  return (
                    <button
                      key={n._id}
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={`flex w-full flex-col gap-1 border-b border-accent/5 px-4 py-3 text-left transition-colors last:border-b-0 cursor-pointer ${
                        n.readAt
                          ? "hover:bg-accent/5"
                          : "bg-accent/[0.04] hover:bg-accent/10"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.readAt && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                        )}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            {isBroadcast && (
                              <span className="rounded-sm border border-accent/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
                                {t("notifications.broadcast.tag")}
                              </span>
                            )}
                            <span
                              className={`font-text text-sm font-medium leading-snug ${
                                n.readAt ? "text-meta" : "text-strong"
                              }`}
                            >
                              {title}
                            </span>
                          </div>
                          {broadcastBody && (
                            <div
                              className={`markdown-body font-text text-xs leading-snug ${
                                n.readAt ? "text-meta/80" : "text-meta"
                              }`}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeSanitize]}
                              >
                                {broadcastBody}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-xs text-meta pl-4">
                        {formatRelative(n.createdAt)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-accent/10">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/notifications");
                }}
                className="flex w-full items-center justify-center px-4 py-2.5 font-text text-sm text-accent transition-colors hover:bg-accent/5 cursor-pointer"
              >
                {t("notifications.viewAll", "View all")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <NotificationDetailModal
        notification={detailNotification}
        onClose={() => setDetailNotification(null)}
        onMarkRead={(id) => markRead.mutate(id)}
      />
    </div>
  );
}
