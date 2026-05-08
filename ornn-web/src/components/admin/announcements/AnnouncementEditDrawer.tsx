/**
 * AnnouncementEditDrawer — create or edit a single landing-popup
 * announcement. Right-edge slide-in following the QuotaUserDetailDrawer
 * pattern. Fields: title, markdown body (with live preview), CTA
 * label/URL, enabled toggle, optional [startsAt, endsAt] window
 * (datetime-local inputs, persisted as ISO).
 *
 * @module components/admin/announcements/AnnouncementEditDrawer
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ReadmeViewer } from "@/components/skill/ReadmeViewer";
import { useToastStore } from "@/stores/toastStore";
import {
  useCreateAnnouncement,
  useUpdateAnnouncement,
} from "@/hooks/useAnnouncements";
import type {
  AdminAnnouncement,
  CreateAnnouncementInput,
} from "@/services/announcementsApi";

interface DrawerForm {
  title: string;
  bodyMarkdown: string;
  ctaLabel: string;
  ctaUrl: string;
  enabled: boolean;
  /** Empty string ⇒ unset. `<input type="datetime-local">` value, naive local. */
  startsAtLocal: string;
  endsAtLocal: string;
}

const SCHEMA = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    bodyMarkdown: z.string().trim().min(1, "Body is required").max(20_000),
    ctaLabel: z.string().trim().max(80),
    ctaUrl: z.string().trim(),
    enabled: z.boolean(),
    startsAtLocal: z.string(),
    endsAtLocal: z.string(),
  })
  .superRefine((v, ctx) => {
    // CTA pair must be both-or-neither.
    const hasLabel = v.ctaLabel.length > 0;
    const hasUrl = v.ctaUrl.length > 0;
    if (hasLabel !== hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasUrl ? "ctaLabel" : "ctaUrl"],
        message: "CTA label and URL must both be set, or both be empty",
      });
    }
    if (hasUrl) {
      try {
        const u = new URL(v.ctaUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          throw new Error("non-http");
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ctaUrl"],
          message: "CTA URL must be a valid http(s) URL",
        });
      }
    }
    // Window order: only validate when both are set.
    if (v.startsAtLocal && v.endsAtLocal) {
      const start = Date.parse(v.startsAtLocal);
      const end = Date.parse(v.endsAtLocal);
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endsAtLocal"],
          message: "End must be strictly after start",
        });
      }
    }
  });

function emptyForm(): DrawerForm {
  return {
    title: "",
    bodyMarkdown: "",
    ctaLabel: "",
    ctaUrl: "",
    enabled: true,
    startsAtLocal: "",
    endsAtLocal: "",
  };
}

function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  // Strip the seconds + tz suffix so the value matches `<input
  // type="datetime-local">`'s expected format ("YYYY-MM-DDTHH:mm").
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  const local = new Date(d.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

function localInputValueToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromAnnouncement(a: AdminAnnouncement): DrawerForm {
  return {
    title: a.title,
    bodyMarkdown: a.bodyMarkdown,
    ctaLabel: a.ctaLabel ?? "",
    ctaUrl: a.ctaUrl ?? "",
    enabled: a.enabled,
    startsAtLocal: isoToLocalInputValue(a.startsAt),
    endsAtLocal: isoToLocalInputValue(a.endsAt),
  };
}

function toInput(form: DrawerForm): CreateAnnouncementInput {
  const ctaLabel = form.ctaLabel.trim();
  const ctaUrl = form.ctaUrl.trim();
  return {
    title: form.title.trim(),
    bodyMarkdown: form.bodyMarkdown.trim(),
    ctaLabel: ctaLabel ? ctaLabel : null,
    ctaUrl: ctaUrl ? ctaUrl : null,
    enabled: form.enabled,
    startsAt: localInputValueToIso(form.startsAtLocal),
    endsAt: localInputValueToIso(form.endsAtLocal),
  };
}

export interface AnnouncementEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, drawer is in edit mode. */
  announcement: AdminAnnouncement | null;
}

export function AnnouncementEditDrawer({
  isOpen,
  onClose,
  announcement,
}: AnnouncementEditDrawerProps) {
  const isEdit = announcement !== null;
  const addToast = useToastStore((s) => s.addToast);
  const createMut = useCreateAnnouncement();
  const updateMut = useUpdateAnnouncement();
  const saving = createMut.isPending || updateMut.isPending;

  const [form, setForm] = useState<DrawerForm>(() => emptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(announcement ? fromAnnouncement(announcement) : emptyForm());
    setErrors({});
    setShowPreview(false);
  }, [isOpen, announcement]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = SCHEMA.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path.join(".");
        if (!next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const input = toInput(form);
    if (isEdit && announcement) {
      updateMut.mutate(
        { id: announcement.id, patch: input },
        {
          onSuccess: () => {
            addToast({ type: "success", message: "Announcement updated" });
            onClose();
          },
          onError: (err) =>
            addToast({
              type: "error",
              message: err instanceof Error ? err.message : "Save failed",
            }),
        },
      );
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          addToast({ type: "success", message: "Announcement created" });
          onClose();
        },
        onError: (err) =>
          addToast({
            type: "error",
            message: err instanceof Error ? err.message : "Save failed",
          }),
      });
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 240, damping: 28, mass: 0.9 }}
            role="dialog"
            aria-label={isEdit ? "Edit announcement" : "New announcement"}
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col gap-5 overflow-y-auto border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ {isEdit ? "EDIT" : "NEW"} — ANNOUNCEMENT]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  {isEdit ? announcement?.title : "New announcement"}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="h-5 w-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                label="Title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                error={errors.title}
                maxLength={200}
              />

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
                    Body (markdown)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta hover:text-accent"
                  >
                    {showPreview ? "Edit" : "Preview"}
                  </button>
                </div>
                {showPreview ? (
                  <div className="min-h-[180px] rounded-sm border border-subtle bg-elevated/40 px-3 py-2">
                    {form.bodyMarkdown.trim() ? (
                      <ReadmeViewer content={form.bodyMarkdown} />
                    ) : (
                      <p className="font-text text-sm text-meta">Nothing to preview.</p>
                    )}
                  </div>
                ) : (
                  <textarea
                    value={form.bodyMarkdown}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bodyMarkdown: e.target.value }))
                    }
                    rows={8}
                    maxLength={20_000}
                    className={`
                      w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2
                      font-mono text-sm text-strong placeholder:text-meta/70
                      transition-colors duration-150
                      focus:border-accent focus:outline-none focus:bg-card
                      ${errors.bodyMarkdown ? "border-danger! focus:border-danger!" : ""}
                    `}
                  />
                )}
                {errors.bodyMarkdown && (
                  <span className="font-mono text-[11px] text-danger">
                    {errors.bodyMarkdown}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="CTA label (optional)"
                  value={form.ctaLabel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ctaLabel: e.target.value }))
                  }
                  error={errors.ctaLabel}
                  placeholder="Read the changelog"
                  maxLength={80}
                />
                <Input
                  label="CTA URL (optional)"
                  value={form.ctaUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ctaUrl: e.target.value }))
                  }
                  error={errors.ctaUrl}
                  placeholder="https://ornn.dev/changelog"
                  inputMode="url"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
                    Starts at (optional, local time)
                  </label>
                  <input
                    type="datetime-local"
                    value={form.startsAtLocal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startsAtLocal: e.target.value }))
                    }
                    className="w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-text text-sm text-strong focus:border-accent focus:bg-card focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
                    Ends at (optional, local time)
                  </label>
                  <input
                    type="datetime-local"
                    value={form.endsAtLocal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endsAtLocal: e.target.value }))
                    }
                    className={`
                      w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2
                      font-text text-sm text-strong
                      focus:border-accent focus:bg-card focus:outline-none
                      ${errors.endsAtLocal ? "border-danger! focus:border-danger!" : ""}
                    `}
                  />
                  {errors.endsAtLocal && (
                    <span className="font-mono text-[11px] text-danger">
                      {errors.endsAtLocal}
                    </span>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, enabled: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 accent-accent"
                />
                Enabled
              </label>

              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={onClose} type="button">
                  Cancel
                </Button>
                <Button variant="primary" type="submit" loading={saving}>
                  {isEdit ? "Save changes" : "Create announcement"}
                </Button>
              </div>
            </form>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
