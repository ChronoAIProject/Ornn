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

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
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
    deleteMut.mutate(pendingDelete._id, {
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

  const items = broadcastsQuery.data ?? [];
  const lang = i18n.language;

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
                    <tr key={b._id} className="border-t border-subtle">
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
