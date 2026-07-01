/**
 * /notifications — full list, filter by unread, mark-all-read.
 *
 * @module pages/NotificationsPage
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/useNotifications";
import type { Notification, NotificationCategory } from "@/types/notifications";
import { PageTransition } from "@/components/layout/PageTransition";
import { NotificationDetailModal } from "@/components/notifications/NotificationDetailModal";
import { pickLocalized } from "@/lib/announcementLocale";

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  "audit.completed": "Audit",
  "audit.risky_for_consumer": "Audit",
  "quota.credits_granted": "Quota",
  "launchPromo.codeDelivered": "Promo",
  "skillset.member_unreadable": "Skillset",
  "skill.source_broken": "Source",
  "skill.auto_synced": "Auto-sync",
  "skill.auto_sync_failed": "Auto-sync",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [detailNotification, setDetailNotification] =
    useState<Notification | null>(null);

  const { data: items = [], isLoading, isError } = useNotifications({
    unread: unreadOnly,
    limit: 200,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const hasUnread = useMemo(() => items.some((n) => !n.readAt), [items]);
  const lang = i18n.language;

  const handleOpen = (n: Notification) => {
    // Broadcasts pop a markdown detail modal so the full bilingual body
    // is readable in place. The modal owns mark-read on open.
    if (n.source === "broadcast") {
      setDetailNotification(n);
      return;
    }
    // User notifications: prefer the deep-link target when present
    // (audit items carry one) — navigating is more useful than a
    // modal. Otherwise, if there's body text, open the modal so the
    // row isn't a dead click (#532 — quota notes are emitted without
    // a link by design but still carry the full note in `body`).
    if (n.link) {
      if (!n.readAt) markRead.mutate(n._id);
      navigate(n.link);
      return;
    }
    if (n.body) {
      setDetailNotification(n);
      return;
    }
    if (!n.readAt) markRead.mutate(n._id);
  };

  const resolveTitle = (n: Notification): string => {
    if (n.source === "broadcast" && n.titleI18n) {
      return pickLocalized(n.titleI18n.en, n.titleI18n.zh, lang);
    }
    return n.title ?? "";
  };

  const resolveBroadcastBody = (n: Notification): string | null => {
    if (n.source !== "broadcast" || !n.bodyMarkdownI18n) return null;
    return pickLocalized(
      n.bodyMarkdownI18n.en,
      n.bodyMarkdownI18n.zh,
      lang,
    );
  };

  return (
    <PageTransition>
      {/*
        Outer wrapper provides the vertical scroll surface (#723).
        `RootLayout`'s `<main>` is `overflow-hidden`, so without this
        the notification list is clipped once it exceeds the viewport
        and older entries can never be reached by wheel/touch scroll.
        Same pattern as `UploadSkillPage`.
      */}
      <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-strong">
              {t("notifications.title", "Notifications")}
            </h1>
            <p className="mt-1 font-text text-sm text-meta">
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
              className={`rounded border px-3 py-1.5 font-text text-sm transition-colors cursor-pointer ${
                unreadOnly
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-accent/20 bg-card/50 text-meta hover:text-strong"
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
              className="rounded border border-accent/20 bg-card/50 px-3 py-1.5 font-text text-sm text-meta transition-colors hover:text-strong disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {t("notifications.markAllRead", "Mark all read")}
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="py-16 text-center font-text text-sm text-meta">
            {t("notifications.loading", "Loading…")}
          </div>
        ) : isError ? (
          <div className="py-16 text-center font-text text-sm text-danger">
            {t("notifications.loadFailed", "Could not load notifications.")}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded border border-accent/10 bg-card/30 py-16 text-center font-text text-sm text-meta">
            {unreadOnly
              ? t("notifications.noUnread", "No unread notifications.")
              : t("notifications.empty", "You're all caught up.")}
          </div>
        ) : (
          <ul className="divide-y divide-accent/10 overflow-hidden rounded border border-accent/10 bg-card/30">
            {items.map((n) => (
              <li key={n._id}>
                <button
                  type="button"
                  onClick={() => handleOpen(n)}
                  className={`flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors cursor-pointer ${
                    n.readAt ? "hover:bg-accent/5" : "bg-accent/[0.04] hover:bg-accent/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {!n.readAt && (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />
                      )}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-accent/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                            {n.source === "broadcast"
                              ? t("notifications.broadcast.tag")
                              : (n.category && CATEGORY_LABEL[n.category]) ??
                                n.category ??
                                ""}
                          </span>
                          <span
                            className={`font-text text-sm font-medium leading-snug ${
                              n.readAt ? "text-meta" : "text-strong"
                            }`}
                          >
                            {resolveTitle(n)}
                          </span>
                        </div>
                        {(() => {
                          const broadcastBody = resolveBroadcastBody(n);
                          if (broadcastBody) {
                            return (
                              <div className="markdown-body font-text text-sm leading-snug text-meta">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeSanitize]}
                                >
                                  {broadcastBody}
                                </ReactMarkdown>
                              </div>
                            );
                          }
                          if (n.body) {
                            return (
                              <p className="font-text text-sm leading-snug text-meta">
                                {n.body}
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-meta">
                      {formatTimestamp(n.createdAt)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>

      <NotificationDetailModal
        notification={detailNotification}
        onClose={() => setDetailNotification(null)}
        onMarkRead={(id) => markRead.mutate(id)}
      />
    </PageTransition>
  );
}
