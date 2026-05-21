/**
 * BroadcastsPage — admin surface for system-wide broadcast notifications.
 *
 * Every broadcast lands in every authenticated user's NotificationBell.
 * Unlike announcements there is no schedule window and no enabled flag
 * — a broadcast is live the moment it's created and gone the moment
 * it's deleted. The list doubles as admin-side history so an admin can
 * see what's been sent, when, by whom, and how many users have read
 * each one (the `readCount` column drives that).
 *
 * @module pages/admin/BroadcastsPage
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToastStore } from "@/stores/toastStore";
import { BroadcastEditDrawer } from "@/components/admin/broadcasts/BroadcastEditDrawer";
import {
  useAdminBroadcasts,
  useDeleteBroadcast,
} from "@/hooks/useBroadcasts";
import type { AdminBroadcast } from "@/services/broadcastsApi";
import { fetchAdminUsers } from "@/services/adminUsersApi";
import { pickLocalized } from "@/lib/announcementLocale";
import { translateError } from "@/utils/translateError";

const ROW_DATE_FMT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

const BODY_PREVIEW_MAX = 80;

/**
 * Cheap markdown -> plain-text condenser for the list preview cell.
 * Strips fenced code, inline code, links, images, headings, emphasis,
 * blockquotes, and list markers, then collapses whitespace. Not a
 * full parser — enough for an 80-char teaser.
 */
function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

export function BroadcastsPage() {
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const broadcastsQuery = useAdminBroadcasts();
  const deleteMut = useDeleteBroadcast();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBroadcast | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminBroadcast | null>(
    null,
  );

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (b: AdminBroadcast) => {
    setEditing(b);
    setDrawerOpen(true);
  };

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    deleteMut.mutate(pendingDelete.id, {
      onSuccess: () => {
        addToast({
          type: "success",
          message: t("adminPages.broadcasts.toast.deleted"),
        });
        setPendingDelete(null);
      },
      onError: (err) => {
        addToast({
          type: "error",
          message: translateError(
            err,
            t("adminPages.broadcasts.toast.deleteFailed"),
          ),
        });
        setPendingDelete(null);
      },
    });
  };

  const items = useMemo(
    () => broadcastsQuery.data ?? [],
    [broadcastsQuery.data],
  );
  const lang = i18n.language;

  // Resolve targeted broadcast recipient_user_ids to display emails for
  // the Recipients-column tooltip. Pulled lazily — only when at least
  // one row is targeted. Admin user lists are small enough that one
  // page-of-200 is sufficient and cheaper than per-row lookups.
  const hasTargetedRows = useMemo(
    () => items.some((b) => b.recipientUserIds != null),
    [items],
  );
  const emailLookupQuery = useQuery({
    queryKey: ["admin", "users", "broadcasts-emails"],
    enabled: hasTargetedRows,
    staleTime: 60_000,
    queryFn: async () => {
      const page = await fetchAdminUsers({
        role: "normal",
        page: 1,
        pageSize: 200,
      });
      return page.items;
    },
  });
  const emailById = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const row of emailLookupQuery.data ?? []) {
      map.set(row.userId, row.email);
    }
    return map;
  }, [emailLookupQuery.data]);

  // #507 — the old `\n`-joined native `title` tooltip was unreadable in
  // Safari (collapses `\n` to a single space) and unusable for many
  // recipients on any browser. Resolve to emails once here; the popover
  // renders the list scrollably so long counts no longer truncate.
  const resolveEmails = (ids: string[]): string[] =>
    ids.map((id) => emailById.get(id) ?? id);

  const pendingDeleteTitle = pendingDelete
    ? pickLocalized(
        pendingDelete.titleI18n.en,
        pendingDelete.titleI18n.zh,
        lang,
      )
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-6 p-6 sm:p-8"
    >
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
            {t("adminPages.broadcasts.eyebrow")}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-strong">
            {t("adminPages.broadcasts.title")}
          </h1>
          <p className="mt-2 max-w-2xl font-text text-sm text-meta">
            {t("adminPages.broadcasts.description")}
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          {t("adminPages.broadcasts.action.new")}
        </Button>
      </header>

      <Card className="overflow-hidden">
        {broadcastsQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <p className="font-display text-lg text-strong">
              {t("adminPages.broadcasts.empty.title")}
            </p>
            <p className="max-w-md font-text text-sm text-meta">
              {t("adminPages.broadcasts.empty.hint")}
            </p>
            <Button variant="secondary" onClick={openCreate} className="mt-2">
              {t("adminPages.broadcasts.action.new")}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-elevated/40">
                <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                  <th className="px-4 py-3">
                    {t("adminPages.broadcasts.table.title")}
                  </th>
                  <th className="px-4 py-3">
                    {t("adminPages.broadcasts.table.preview")}
                  </th>
                  <th className="px-4 py-3">
                    {t("adminPages.broadcasts.table.recipients")}
                  </th>
                  <th className="px-4 py-3">
                    {t("adminPages.broadcasts.table.created")}
                  </th>
                  <th className="px-4 py-3">
                    {t("adminPages.broadcasts.table.updated")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("adminPages.broadcasts.table.readCount")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("adminPages.broadcasts.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const displayTitle = pickLocalized(
                    b.titleI18n.en,
                    b.titleI18n.zh,
                    lang,
                  );
                  const displayBody = pickLocalized(
                    b.bodyMarkdownI18n.en,
                    b.bodyMarkdownI18n.zh,
                    lang,
                  );
                  const preview = truncate(
                    stripMarkdown(displayBody),
                    BODY_PREVIEW_MAX,
                  );
                  return (
                    <tr key={b.id} className="border-t border-subtle">
                      <td className="px-4 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => openEdit(b)}
                          className="text-left font-display text-base font-semibold text-strong hover:text-accent"
                        >
                          {displayTitle}
                        </button>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-text text-sm text-meta">
                          {preview}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {b.recipientUserIds == null ? (
                          <span className="font-text text-sm text-meta">
                            {t("adminPages.broadcasts.recipients.summaryAll")}
                          </span>
                        ) : (
                          <RecipientsPopover
                            count={b.recipientUserIds.length}
                            emails={resolveEmails(b.recipientUserIds)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-[11px] text-meta">
                        {new Date(b.createdAt).toLocaleString(
                          undefined,
                          ROW_DATE_FMT,
                        )}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-[11px] text-meta">
                        {new Date(b.updatedAt).toLocaleString(
                          undefined,
                          ROW_DATE_FMT,
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-right font-mono text-[11px] text-strong">
                        {b.readCount}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openEdit(b)}
                          >
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setPendingDelete(b)}
                            disabled={deleteMut.isPending}
                          >
                            {t("common.delete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BroadcastEditDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        broadcast={editing}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={onConfirmDelete}
        title={t("adminPages.broadcasts.confirm.deleteTitle")}
        description={t("adminPages.broadcasts.confirm.delete", {
          title: pendingDeleteTitle,
        })}
        confirmLabel={t("common.delete")}
        variant="danger"
        isLoading={deleteMut.isPending}
      />
    </motion.div>
  );
}

/**
 * Click/hover popover that lists broadcast recipients (#507). Replaces
 * the prior native `title` tooltip whose `\n`-joined string rendered as
 * one run-on line in Safari and truncated off-screen for many
 * recipients on every browser.
 *
 * Behaviour mirrors `CategoryTooltip`:
 *   - hover OR click opens; click-outside / second-click closes
 *   - `aria-expanded` reflects state for screen readers
 *   - the list is `max-h-64 overflow-y-auto` so 20+ recipients stay
 *     readable instead of overflowing the viewport
 *
 * Kept inline because BroadcastsPage is the only consumer; promoting
 * it to `components/ui/` would be premature.
 */
function RecipientsPopover({ count, emails }: { count: number; emails: string[] }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        onMouseEnter={() => setIsOpen(true)}
        onFocus={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 rounded-sm border border-subtle bg-elevated/40 px-2 py-0.5 font-mono text-[11px] text-strong hover:border-accent/40 hover:text-accent transition-colors"
      >
        {t("adminPages.broadcasts.recipients.summaryCount", { count })}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            role="dialog"
            aria-label={t("adminPages.broadcasts.recipients.popoverAria", {
              defaultValue: "Recipient list",
            })}
            className="absolute left-0 top-7 z-50 w-72 rounded-md border border-strong-edge bg-card p-3 card-impression"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta mb-2">
              {t("adminPages.broadcasts.recipients.popoverHeader", {
                defaultValue: "Recipients ({{count}})",
                count,
              })}
            </p>
            <ul className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {emails.map((email, i) => (
                <li
                  key={`${email}-${i}`}
                  className="font-mono text-[11px] text-strong break-all"
                >
                  {email}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
