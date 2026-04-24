/**
 * /notifications — full list, filter by unread, mark-all-read.
 *
 * @module pages/NotificationsPage
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/useNotifications";
import type { Notification, NotificationCategory } from "@/types/notifications";
import { PageTransition } from "@/components/layout/PageTransition";

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  "audit.completed": "Audit",
  "share.needs_justification": "Share",
  "share.review_requested": "Share",
  "share.accepted": "Share",
  "share.rejected": "Share",
  "share.cancelled": "Share",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data: items = [], isLoading, isError } = useNotifications({
    unread: unreadOnly,
    limit: 200,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const hasUnread = useMemo(() => items.some((n) => !n.readAt), [items]);

  const handleOpen = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n._id);
    if (n.link) navigate(n.link);
  };

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold text-text-primary">
              {t("notifications.title", "Notifications")}
            </h1>
            <p className="mt-1 font-body text-sm text-text-muted">
              {t(
                "notifications.subtitle",
                "Share reviews, audit verdicts, and admin actions on your skills.",
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 font-body text-sm transition-colors cursor-pointer ${
                unreadOnly
                  ? "border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan"
                  : "border-neon-cyan/20 bg-bg-surface/50 text-text-muted hover:text-text-primary"
              }`}
            >
              {unreadOnly
                ? t("notifications.showAll", "Show all")
                : t("notifications.showUnreadOnly", "Unread only")}
            </button>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={!hasUnread || markAll.isPending}
              className="rounded-lg border border-neon-cyan/20 bg-bg-surface/50 px-3 py-1.5 font-body text-sm text-text-muted transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {t("notifications.markAllRead", "Mark all read")}
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="py-16 text-center font-body text-sm text-text-muted">
            {t("notifications.loading", "Loading…")}
          </div>
        ) : isError ? (
          <div className="py-16 text-center font-body text-sm text-neon-red">
            {t("notifications.loadFailed", "Could not load notifications.")}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-neon-cyan/10 bg-bg-surface/30 py-16 text-center font-body text-sm text-text-muted">
            {unreadOnly
              ? t("notifications.noUnread", "No unread notifications.")
              : t("notifications.empty", "You're all caught up.")}
          </div>
        ) : (
          <ul className="divide-y divide-neon-cyan/10 overflow-hidden rounded-lg border border-neon-cyan/10 bg-bg-surface/30">
            {items.map((n) => (
              <li key={n._id}>
                <button
                  type="button"
                  onClick={() => handleOpen(n)}
                  className={`flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors cursor-pointer ${
                    n.readAt ? "hover:bg-neon-cyan/5" : "bg-neon-cyan/[0.04] hover:bg-neon-cyan/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {!n.readAt && (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-neon-cyan" />
                      )}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-neon-cyan/20 px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider text-text-muted">
                            {CATEGORY_LABEL[n.category] ?? n.category}
                          </span>
                          <span
                            className={`font-body text-sm font-medium leading-snug ${
                              n.readAt ? "text-text-muted" : "text-text-primary"
                            }`}
                          >
                            {n.title}
                          </span>
                        </div>
                        {n.body && (
                          <p className="font-body text-sm leading-snug text-text-muted">
                            {n.body}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-text-muted">
                      {formatTimestamp(n.createdAt)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageTransition>
  );
}
