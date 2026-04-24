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
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/useNotifications";
import type { Notification } from "@/types/notifications";

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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
    if (!n.readAt) {
      markRead.mutate(n._id);
    }
    setOpen(false);
    if (n.link) navigate(n.link);
    else navigate("/notifications");
  };

  const badgeLabel = unread > 99 ? "99+" : String(unread);

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("notifications.bellAria", "Notifications")}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-neon-cyan/20 bg-bg-surface/50 text-text-muted transition-all duration-200 hover:border-neon-cyan/60 hover:text-text-primary cursor-pointer"
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full border-2 border-bg-surface bg-neon-red px-1 font-heading text-[10px] font-bold leading-4 text-white">
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
            className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-lg glass border border-neon-cyan/20 shadow-lg shadow-neon-cyan/10"
          >
            <div className="flex items-center justify-between border-b border-neon-cyan/10 px-4 py-3">
              <span className="font-heading text-sm uppercase tracking-wider text-text-primary">
                {t("notifications.title", "Notifications")}
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="font-body text-xs text-text-muted transition-colors hover:text-neon-cyan cursor-pointer disabled:opacity-50"
                >
                  {t("notifications.markAllRead", "Mark all read")}
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="px-4 py-6 text-center font-body text-sm text-text-muted">
                  {t("notifications.loading", "Loading…")}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="px-4 py-6 text-center font-body text-sm text-text-muted">
                  {t("notifications.empty", "You're all caught up.")}
                </div>
              ) : (
                visibleItems.map((n) => (
                  <button
                    key={n._id}
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`flex w-full flex-col gap-1 border-b border-neon-cyan/5 px-4 py-3 text-left transition-colors last:border-b-0 cursor-pointer ${
                      n.readAt
                        ? "hover:bg-neon-cyan/5"
                        : "bg-neon-cyan/[0.04] hover:bg-neon-cyan/10"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neon-cyan" />
                      )}
                      <span
                        className={`font-body text-sm leading-snug ${
                          n.readAt ? "text-text-muted" : "text-text-primary"
                        }`}
                      >
                        {n.title}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-text-muted pl-4">
                      {formatRelative(n.createdAt)}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-neon-cyan/10">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/notifications");
                }}
                className="flex w-full items-center justify-center px-4 py-2.5 font-body text-sm text-neon-cyan transition-colors hover:bg-neon-cyan/5 cursor-pointer"
              >
                {t("notifications.viewAll", "View all")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
