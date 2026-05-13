/**
 * BroadcastEditDrawer — create or edit a single admin-authored
 * broadcast. Right-edge slide-in following the AnnouncementEditDrawer
 * pattern.
 *
 * Fields are strictly bilingual: titles and markdown bodies are
 * required in BOTH English and Chinese. Broadcasts do not auto-fall
 * back across locales (unlike announcements), because every
 * authenticated user sees every broadcast — the admin must explicitly
 * decide what each audience reads.
 *
 * Markdown body uses the shared `MarkdownEditor` from `components/form/`
 * — toolbar, preview toggle, sanitized rendering. One editor instance
 * per locale.
 *
 * @module components/admin/broadcasts/BroadcastEditDrawer
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MarkdownEditor } from "@/components/form/MarkdownEditor";
import { useToastStore } from "@/stores/toastStore";
import {
  useCreateBroadcast,
  useUpdateBroadcast,
} from "@/hooks/useBroadcasts";
import type {
  AdminBroadcast,
  CreateBroadcastInput,
} from "@/services/broadcastsApi";
import { translateError } from "@/utils/translateError";

const TITLE_MAX = 200;
const BODY_MAX = 20_000;

interface DrawerForm {
  titleEn: string;
  titleZh: string;
  bodyEn: string;
  bodyZh: string;
}

interface FieldErrors {
  titleEn?: string;
  titleZh?: string;
  bodyEn?: string;
  bodyZh?: string;
}

function emptyForm(): DrawerForm {
  return { titleEn: "", titleZh: "", bodyEn: "", bodyZh: "" };
}

function fromBroadcast(b: AdminBroadcast): DrawerForm {
  return {
    titleEn: b.titleI18n.en,
    titleZh: b.titleI18n.zh,
    bodyEn: b.bodyMarkdownI18n.en,
    bodyZh: b.bodyMarkdownI18n.zh,
  };
}

function toInput(form: DrawerForm): CreateBroadcastInput {
  return {
    titleI18n: { en: form.titleEn.trim(), zh: form.titleZh.trim() },
    bodyMarkdownI18n: { en: form.bodyEn.trim(), zh: form.bodyZh.trim() },
  };
}

function validate(
  form: DrawerForm,
  t: (k: string) => string,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.titleEn.trim()) {
    errors.titleEn = t("adminPages.broadcasts.errors.titleEnRequired");
  } else if (form.titleEn.trim().length > TITLE_MAX) {
    errors.titleEn = t("adminPages.broadcasts.errors.titleTooLong");
  }
  if (!form.titleZh.trim()) {
    errors.titleZh = t("adminPages.broadcasts.errors.titleZhRequired");
  } else if (form.titleZh.trim().length > TITLE_MAX) {
    errors.titleZh = t("adminPages.broadcasts.errors.titleTooLong");
  }
  if (!form.bodyEn.trim()) {
    errors.bodyEn = t("adminPages.broadcasts.errors.bodyEnRequired");
  } else if (form.bodyEn.trim().length > BODY_MAX) {
    errors.bodyEn = t("adminPages.broadcasts.errors.bodyTooLong");
  }
  if (!form.bodyZh.trim()) {
    errors.bodyZh = t("adminPages.broadcasts.errors.bodyZhRequired");
  } else if (form.bodyZh.trim().length > BODY_MAX) {
    errors.bodyZh = t("adminPages.broadcasts.errors.bodyTooLong");
  }
  return errors;
}

export interface BroadcastEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, drawer is in edit mode. */
  broadcast: AdminBroadcast | null;
}

export function BroadcastEditDrawer({
  isOpen,
  onClose,
  broadcast,
}: BroadcastEditDrawerProps) {
  const { t } = useTranslation();
  const isEdit = broadcast !== null;
  const addToast = useToastStore((s) => s.addToast);
  const createMut = useCreateBroadcast();
  const updateMut = useUpdateBroadcast();
  const saving = createMut.isPending || updateMut.isPending;

  const [form, setForm] = useState<DrawerForm>(() => emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!isOpen) return;
    setForm(broadcast ? fromBroadcast(broadcast) : emptyForm());
    setErrors({});
  }, [isOpen, broadcast]);

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
    const next = validate(form, t);
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    const input = toInput(form);
    if (isEdit && broadcast) {
      updateMut.mutate(
        { id: broadcast._id, patch: input },
        {
          onSuccess: () => {
            addToast({
              type: "success",
              message: t("adminPages.broadcasts.toast.updated"),
            });
            onClose();
          },
          onError: (err) =>
            addToast({
              type: "error",
              message: translateError(
                err,
                t("adminPages.broadcasts.toast.updateFailed"),
              ),
            }),
        },
      );
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          addToast({
            type: "success",
            message: t("adminPages.broadcasts.toast.created"),
          });
          onClose();
        },
        onError: (err) =>
          addToast({
            type: "error",
            message: translateError(
              err,
              t("adminPages.broadcasts.toast.createFailed"),
            ),
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
            aria-label={
              isEdit
                ? t("adminPages.broadcasts.drawer.editAria")
                : t("adminPages.broadcasts.drawer.newAria")
            }
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col gap-5 overflow-y-auto border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  {isEdit
                    ? t("adminPages.broadcasts.drawer.eyebrowEdit")
                    : t("adminPages.broadcasts.drawer.eyebrowNew")}
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  {isEdit
                    ? broadcast?.titleI18n.en
                    : t("adminPages.broadcasts.drawer.newTitle")}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="-mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

            <form onSubmit={onSubmit} className="flex flex-col gap-6">
              {/* English block — required */}
              <section className="flex flex-col gap-4">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                  {t("adminPages.broadcasts.drawer.englishHeading")}
                </h3>
                <Input
                  label={t("adminPages.broadcasts.drawer.titleEnLabel")}
                  value={form.titleEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, titleEn: e.target.value }))
                  }
                  error={errors.titleEn}
                  maxLength={TITLE_MAX}
                  placeholder={t("adminPages.broadcasts.drawer.titleEnPlaceholder")}
                />
                <MarkdownEditor
                  label={t("adminPages.broadcasts.drawer.bodyEnLabel")}
                  value={form.bodyEn}
                  onChange={(v) => setForm((f) => ({ ...f, bodyEn: v }))}
                  error={errors.bodyEn}
                  placeholder={t("adminPages.broadcasts.drawer.bodyEnPlaceholder")}
                  minRows={8}
                  maxRows={20}
                />
              </section>

              {/* Chinese block — required */}
              <section className="flex flex-col gap-4 border-t border-subtle pt-5">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                  {t("adminPages.broadcasts.drawer.chineseHeading")}
                </h3>
                <Input
                  label={t("adminPages.broadcasts.drawer.titleZhLabel")}
                  value={form.titleZh}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, titleZh: e.target.value }))
                  }
                  error={errors.titleZh}
                  maxLength={TITLE_MAX}
                  placeholder={t("adminPages.broadcasts.drawer.titleZhPlaceholder")}
                />
                <MarkdownEditor
                  label={t("adminPages.broadcasts.drawer.bodyZhLabel")}
                  value={form.bodyZh}
                  onChange={(v) => setForm((f) => ({ ...f, bodyZh: v }))}
                  error={errors.bodyZh}
                  placeholder={t("adminPages.broadcasts.drawer.bodyZhPlaceholder")}
                  minRows={8}
                  maxRows={20}
                />
              </section>

              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={onClose} type="button">
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" type="submit" loading={saving}>
                  {isEdit
                    ? t("adminPages.broadcasts.drawer.saveBtn")
                    : t("adminPages.broadcasts.drawer.createBtn")}
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
