/**
 * AnnouncementsPage — admin surface for landing-page popup announcements.
 *
 * Single-active model: at most one announcement renders to visitors at
 * a time (most recent enabled record currently within its
 * [startsAt, endsAt] window). The list shows everything so an admin
 * can see history, supersede live records by creating a new one, or
 * disable / delete stale ones.
 *
 * @module pages/admin/AnnouncementsPage
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToastStore } from "@/stores/toastStore";
import { AnnouncementEditDrawer } from "@/components/admin/announcements/AnnouncementEditDrawer";
import {
  useAdminAnnouncements,
  useDeleteAnnouncement,
  useUpdateAnnouncement,
} from "@/hooks/useAnnouncements";
import type { AdminAnnouncement } from "@/services/announcementsApi";
import { translateError } from "@/utils/translateError";

const ROW_DATE_FMT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

function formatRange(
  a: AdminAnnouncement,
  alwaysLabel: string,
): string {
  const fmt = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleString(undefined, ROW_DATE_FMT) : "—";
  if (!a.startsAt && !a.endsAt) return alwaysLabel;
  return `${fmt(a.startsAt)}  →  ${fmt(a.endsAt)}`;
}

function statusLabel(
  a: AdminAnnouncement,
  now: Date,
  labels: { disabled: string; scheduled: string; expired: string; live: string },
): {
  label: string;
  tone: "live" | "scheduled" | "expired" | "disabled";
} {
  if (!a.enabled) return { label: labels.disabled, tone: "disabled" };
  if (a.startsAt && new Date(a.startsAt).getTime() > now.getTime()) {
    return { label: labels.scheduled, tone: "scheduled" };
  }
  if (a.endsAt && new Date(a.endsAt).getTime() <= now.getTime()) {
    return { label: labels.expired, tone: "expired" };
  }
  return { label: labels.live, tone: "live" };
}

const TONE_STYLE: Record<
  ReturnType<typeof statusLabel>["tone"],
  string
> = {
  live: "border-accent/40 text-accent bg-accent/10",
  scheduled: "border-subtle text-meta bg-elevated/50",
  expired: "border-subtle text-meta bg-elevated/30",
  disabled: "border-subtle text-meta bg-elevated/30",
};

export function AnnouncementsPage() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const announcementsQuery = useAdminAnnouncements();
  const deleteMut = useDeleteAnnouncement();
  const updateMut = useUpdateAnnouncement();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminAnnouncement | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (a: AdminAnnouncement) => {
    setEditing(a);
    setDrawerOpen(true);
  };

  const onToggleEnabled = (a: AdminAnnouncement) => {
    updateMut.mutate(
      { id: a.id, patch: { enabled: !a.enabled } },
      {
        onSuccess: () =>
          addToast({
            type: "success",
            message: a.enabled
              ? t("adminPages.announcements.toast.disabled")
              : t("adminPages.announcements.toast.enabled"),
          }),
        onError: (err) =>
          addToast({
            type: "error",
            message: translateError(
              err,
              t("adminPages.announcements.toast.updateFailed"),
            ),
          }),
      },
    );
  };

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    deleteMut.mutate(pendingDelete.id, {
      onSuccess: () => {
        addToast({ type: "success", message: t("adminPages.announcements.toast.deleted") });
        setPendingDelete(null);
      },
      onError: (err) => {
        addToast({
          type: "error",
          message: translateError(
            err,
            t("adminPages.announcements.toast.deleteFailed"),
          ),
        });
        setPendingDelete(null);
      },
    });
  };

  const now = new Date();
  const items = announcementsQuery.data ?? [];

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
            {t("adminPages.announcements.eyebrow")}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-strong">
            {t("adminPages.announcements.title")}
          </h1>
          <p className="mt-2 max-w-2xl font-text text-sm text-meta">
            {t("adminPages.announcements.description")}
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          {t("adminPages.announcements.action.new")}
        </Button>
      </header>

      <Card className="overflow-hidden">
        {announcementsQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <p className="font-display text-lg text-strong">{t("announcementsAdmin.noAnnouncements")}</p>
            <p className="max-w-md font-text text-sm text-meta">
              {t("announcementsAdmin.emptyHint")}
            </p>
            <Button variant="secondary" onClick={openCreate} className="mt-2">
              {t("announcementsAdmin.createBtn")}
            </Button>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-elevated/40">
              <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                <th className="px-4 py-3">{t("adminPages.announcements.table.title")}</th>
                <th className="px-4 py-3">{t("adminPages.announcements.table.status")}</th>
                <th className="px-4 py-3">{t("adminPages.announcements.table.window")}</th>
                <th className="px-4 py-3">{t("adminPages.announcements.table.created")}</th>
                <th className="px-4 py-3 text-right">{t("adminPages.announcements.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const status = statusLabel(a, now, {
                  disabled: t("adminPages.announcements.status.disabled"),
                  scheduled: t("adminPages.announcements.status.scheduled"),
                  expired: t("adminPages.announcements.status.expired"),
                  live: t("adminPages.announcements.status.live"),
                });
                return (
                  <tr key={a.id} className="border-t border-subtle">
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => openEdit(a)}
                        className="text-left font-display text-base font-semibold text-strong hover:text-accent"
                      >
                        {a.title}
                      </button>
                      {a.ctaUrl && (
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                          CTA → {a.ctaLabel || a.ctaUrl}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${TONE_STYLE[status.tone]}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-[11px] text-meta">
                      {formatRange(a, t("adminPages.announcements.window.always"))}
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-[11px] text-meta">
                      {new Date(a.createdAt).toLocaleString(undefined, ROW_DATE_FMT)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onToggleEnabled(a)}
                          disabled={updateMut.isPending}
                        >
                          {a.enabled
                            ? t("adminPages.announcements.action.disable")
                            : t("adminPages.announcements.action.enable")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEdit(a)}
                        >
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setPendingDelete(a)}
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
        )}
      </Card>

      <AnnouncementEditDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        announcement={editing}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={onConfirmDelete}
        title={t("adminPages.announcements.confirm.deleteTitle")}
        description={t("adminPages.announcements.confirm.delete", {
          title: pendingDelete?.title ?? "",
        })}
        confirmLabel={t("common.delete")}
        variant="danger"
        isLoading={deleteMut.isPending}
      />
    </motion.div>
  );
}
