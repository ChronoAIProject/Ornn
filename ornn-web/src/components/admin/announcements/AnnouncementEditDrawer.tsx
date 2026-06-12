/**
 * AnnouncementEditDrawer — create or edit a single landing-popup
 * announcement. Right-edge slide-in following the QuotaUserDetailDrawer
 * pattern.
 *
 * Fields (bilingual where applicable):
 *   - Title (EN required, ZH optional)
 *   - Body markdown (EN required, ZH optional) — live preview per locale
 *   - CTA label (EN optional, ZH optional) + CTA URL (single, locale-independent)
 *   - Enabled toggle
 *   - Optional [startsAt, endsAt] window (datetime-local inputs, persisted as ISO)
 *
 * Bilingual rules: EN slots are the canonical content. ZH slots are
 * optional — when empty, the user-facing surfaces (popup + News page)
 * fall back to the EN slot regardless of the visitor's locale. The
 * existing "CTA label + URL are both-or-neither" rule applies to the
 * EN side; ZH label is independent (falls back to EN at render time).
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
import { translateError } from "@/utils/translateError";

interface DrawerForm {
  titleEn: string;
  titleZh: string;
  bodyMarkdownEn: string;
  bodyMarkdownZh: string;
  ctaLabelEn: string;
  ctaLabelZh: string;
  ctaUrl: string;
  enabled: boolean;
  /** Empty string ⇒ unset. `<input type="datetime-local">` value, naive local. */
  startsAtLocal: string;
  endsAtLocal: string;
}

const SCHEMA = z
  .object({
    titleEn: z.string().trim().min(1, "Title (EN) is required").max(200),
    titleZh: z.string().trim().max(200),
    bodyMarkdownEn: z.string().trim().min(1, "Body (EN) is required").max(20_000),
    bodyMarkdownZh: z.string().trim().max(20_000),
    ctaLabelEn: z.string().trim().max(80),
    ctaLabelZh: z.string().trim().max(80),
    ctaUrl: z.string().trim(),
    enabled: z.boolean(),
    startsAtLocal: z.string(),
    endsAtLocal: z.string(),
  })
  .superRefine((v, ctx) => {
    // EN CTA pair must be both-or-neither.
    const hasEnLabel = v.ctaLabelEn.length > 0;
    const hasUrl = v.ctaUrl.length > 0;
    if (hasEnLabel !== hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasUrl ? "ctaLabelEn" : "ctaUrl"],
        message: "CTA label (EN) and URL must both be set, or both be empty",
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
    // ZH CTA label without an EN label OR URL doesn't render — warn.
    if (v.ctaLabelZh.length > 0 && !hasEnLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ctaLabelZh"],
        message:
          "CTA label (ZH) is set but EN label is empty — set the EN label too, ZH falls back to EN when empty",
      });
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
    titleEn: "",
    titleZh: "",
    bodyMarkdownEn: "",
    bodyMarkdownZh: "",
    ctaLabelEn: "",
    ctaLabelZh: "",
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
    titleEn: a.titleEn,
    titleZh: a.titleZh,
    bodyMarkdownEn: a.bodyMarkdownEn,
    bodyMarkdownZh: a.bodyMarkdownZh,
    ctaLabelEn: a.ctaLabelEn ?? "",
    ctaLabelZh: a.ctaLabelZh ?? "",
    ctaUrl: a.ctaUrl ?? "",
    enabled: a.enabled,
    startsAtLocal: isoToLocalInputValue(a.startsAt),
    endsAtLocal: isoToLocalInputValue(a.endsAt),
  };
}

function toInput(form: DrawerForm): CreateAnnouncementInput {
  const ctaLabelEn = form.ctaLabelEn.trim();
  const ctaLabelZh = form.ctaLabelZh.trim();
  const ctaUrl = form.ctaUrl.trim();
  return {
    titleEn: form.titleEn.trim(),
    titleZh: form.titleZh.trim(),
    bodyMarkdownEn: form.bodyMarkdownEn.trim(),
    bodyMarkdownZh: form.bodyMarkdownZh.trim(),
    ctaLabelEn: ctaLabelEn ? ctaLabelEn : null,
    ctaLabelZh: ctaLabelZh ? ctaLabelZh : null,
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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

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
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[640px] flex-col gap-5 overflow-y-auto border-l border-subtle bg-page p-6 sm:p-8"
          >
            {/* Keyed on the open announcement (or "new") so the form's
                state resets by construction on reopen / entity-switch —
                no reset effect, no cascading render (#888). The outer
                AnimatePresence stays mounted for the slide animation. */}
            <AnnouncementEditForm
              key={announcement?.id ?? "new"}
              announcement={announcement}
              isEdit={isEdit}
              onClose={onClose}
            />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface AnnouncementEditFormProps {
  announcement: AdminAnnouncement | null;
  isEdit: boolean;
  onClose: () => void;
}

function AnnouncementEditForm({
  announcement,
  isEdit,
  onClose,
}: AnnouncementEditFormProps) {
  const addToast = useToastStore((s) => s.addToast);
  const createMut = useCreateAnnouncement();
  const updateMut = useUpdateAnnouncement();
  const saving = createMut.isPending || updateMut.isPending;

  // Lazy init from the prop so the first render is already prefilled in
  // edit mode (no post-mount setState). Re-open / entity-switch resets
  // via the `key` at the call site.
  const [form, setForm] = useState<DrawerForm>(() =>
    announcement ? fromAnnouncement(announcement) : emptyForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Which locale's body markdown is in preview mode (null = both in edit). */
  const [previewLocale, setPreviewLocale] = useState<"en" | "zh" | null>(null);

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
              message: translateError(err, "Save failed"),
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
            message: translateError(err, "Save failed"),
          }),
      });
    }
  };

  return (
    <>
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ {isEdit ? "EDIT" : "NEW"} — ANNOUNCEMENT]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  {isEdit ? announcement?.titleEn : "New announcement"}
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

            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              {/* ── English block (canonical / required) ────────────────── */}
              <section className="flex flex-col gap-4">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                  English (required)
                </h3>

                <Input
                  label="Title (EN)"
                  value={form.titleEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, titleEn: e.target.value }))
                  }
                  error={errors.titleEn}
                  maxLength={200}
                />

                <BodyMarkdownField
                  label="Body — EN (markdown)"
                  value={form.bodyMarkdownEn}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, bodyMarkdownEn: v }))
                  }
                  error={errors.bodyMarkdownEn}
                  preview={previewLocale === "en"}
                  onTogglePreview={() =>
                    setPreviewLocale((p) => (p === "en" ? null : "en"))
                  }
                />

                <Input
                  label="CTA label EN (optional)"
                  value={form.ctaLabelEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ctaLabelEn: e.target.value }))
                  }
                  error={errors.ctaLabelEn}
                  placeholder="Read the changelog"
                  maxLength={80}
                />
              </section>

              {/* ── Chinese block (optional, falls back to EN) ─────────── */}
              <section className="flex flex-col gap-4 border-t border-subtle pt-5">
                <div>
                  <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-meta">
                    中文 (optional)
                  </h3>
                  <p className="mt-1 font-text text-[11px] text-meta">
                    Each empty Chinese field falls back to the English value
                    above when shown to ZH users. Translate at your own pace.
                  </p>
                </div>

                <Input
                  label="Title (ZH)"
                  value={form.titleZh}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, titleZh: e.target.value }))
                  }
                  error={errors.titleZh}
                  maxLength={200}
                />

                <BodyMarkdownField
                  label="Body — ZH (markdown)"
                  value={form.bodyMarkdownZh}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, bodyMarkdownZh: v }))
                  }
                  error={errors.bodyMarkdownZh}
                  preview={previewLocale === "zh"}
                  onTogglePreview={() =>
                    setPreviewLocale((p) => (p === "zh" ? null : "zh"))
                  }
                />

                <Input
                  label="CTA label ZH (optional)"
                  value={form.ctaLabelZh}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ctaLabelZh: e.target.value }))
                  }
                  error={errors.ctaLabelZh}
                  placeholder="阅读更新日志"
                  maxLength={80}
                />
              </section>

              {/* ── Locale-independent CTA URL ─────────────────────────── */}
              <Input
                label="CTA URL (optional, shared by both locales)"
                value={form.ctaUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ctaUrl: e.target.value }))
                }
                error={errors.ctaUrl}
                placeholder="https://ornn.dev/changelog"
                inputMode="url"
              />

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
    </>
  );
}

/**
 * One markdown body field with toggleable preview. Lifted out so the
 * EN and ZH blocks share the same widget without prop drilling
 * preview state into the parent component for both locales.
 */
function BodyMarkdownField({
  label,
  value,
  onChange,
  error,
  preview,
  onTogglePreview,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  preview: boolean;
  onTogglePreview: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
          {label}
        </label>
        <button
          type="button"
          onClick={onTogglePreview}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta hover:text-accent"
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[180px] rounded-sm border border-subtle bg-elevated/40 px-3 py-2">
          {value.trim() ? (
            <ReadmeViewer content={value} />
          ) : (
            <p className="font-text text-sm text-meta">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          maxLength={20_000}
          className={`
            w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2
            font-mono text-sm text-strong placeholder:text-meta/70
            transition-colors duration-150
            focus:border-accent focus:outline-none focus:bg-card
            ${error ? "border-danger! focus:border-danger!" : ""}
          `}
        />
      )}
      {error && (
        <span className="font-mono text-[11px] text-danger">{error}</span>
      )}
    </div>
  );
}
