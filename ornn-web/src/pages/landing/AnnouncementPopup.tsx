/**
 * AnnouncementPopup — landing-page modal that surfaces the currently
 * active announcement to every visitor (anonymous + signed-in).
 *
 * Industry-standard "what's new" pattern (Linear / Vercel / GitHub),
 * dressed in Forge Workshop vocabulary per DESIGN.md:
 *   - Ember surface (the brand action color, here promoted to a
 *     full-card stamp). Obsidian ink throughout. The card reads as a
 *     hot-pressed ember plate against the page.
 *   - Space Grotesk Bold UPPERCASE title — the landing display voice.
 *   - JetBrains Mono bracketed micro-label (`[§ NEWS — ORNN]`) for
 *     editorial / industrial-publication signal.
 *   - Hard-offset letterpress shadow in ember-deep, no soft drop shadow.
 *   - Press-down hover on CTA + dismiss buttons (translate INTO the
 *     impression). No hover-lift.
 *
 * Dismissal stays as before: localStorage-keyed (`ornn:announcement:
 * dismissed:<id>`), one-shot per id, no server write — anonymous-safe.
 *
 * @module pages/landing/AnnouncementPopup
 */

import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useActiveAnnouncement } from "@/hooks/useAnnouncements";
import {
  pickLocalized,
  pickLocalizedCtaLabel,
} from "@/lib/announcementLocale";

const DISMISS_KEY_PREFIX = "ornn:announcement:dismissed:";

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

function markDismissed(id: string): void {
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + id, "1");
  } catch {
    // No-op: private mode / disabled storage. Better to nag than to break.
  }
}

/**
 * Scope overrides for the markdown body. ReadmeViewer's `.markdown-body`
 * class binds to `--color-body` / `--color-strong` / `--color-accent`
 * for prose, headings, and links. On an ember surface those default
 * tokens read as muted bone — illegible. Re-pin the same token names
 * to dark ink within the popup subtree so the existing markdown styles
 * stay reusable instead of duplicated. Links shift to ember-deep so they
 * still feel like an action, just keyed to the surface they sit on.
 */
const INK_OVERRIDES = {
  "--color-body": "var(--color-obsidian)",
  "--color-strong": "var(--color-obsidian)",
  "--color-meta": "var(--color-ember-deep)",
  "--color-accent": "var(--color-ember-deep)",
  "--color-accent-muted": "var(--color-obsidian)",
  "--color-subtle": "rgba(11, 9, 7, 0.18)",
  "--color-elevated": "rgba(11, 9, 7, 0.08)",
} as CSSProperties;

export function AnnouncementPopup() {
  const { t, i18n } = useTranslation();
  const { data: announcement } = useActiveAnnouncement();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!announcement) {
      setOpen(false);
      return;
    }
    if (!isDismissed(announcement.id)) {
      setOpen(true);
    }
  }, [announcement]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    if (announcement) markDismissed(announcement.id);
    setOpen(false);
  };

  if (!announcement) return null;

  // Resolve bilingual fields against the active i18n language. EN is the
  // canonical / required content; ZH falls back to EN when empty so the
  // popup still renders cleanly for ZH users on a half-translated record.
  const lang = i18n.language;
  const displayTitle = pickLocalized(
    announcement.titleEn,
    announcement.titleZh,
    lang,
  );
  const displayBody = pickLocalized(
    announcement.bodyMarkdownEn,
    announcement.bodyMarkdownZh,
    lang,
  );
  const ctaHref = announcement.ctaUrl ?? null;
  const ctaLabel = pickLocalizedCtaLabel(
    announcement.ctaLabelEn,
    announcement.ctaLabelZh,
    lang,
  );
  const isExternalCta = ctaHref ? /^https?:\/\//i.test(ctaHref) : false;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.9 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-title"
            style={INK_OVERRIDES}
            className="
              relative z-10 mx-4 w-full max-w-lg max-h-[80vh] overflow-y-auto
              rounded-[3px] border border-[var(--color-ember-deep)] bg-accent
              p-7 sm:p-8
            "
            // Letterpress impression in ember-deep — DESIGN.md Material &
            // Print Vocabulary. Inline because the popup uses a one-off
            // surface color (full ember card); no shared component token
            // covers "card on ember surface".
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 translate-x-[6px] translate-y-[6px] rounded-[3px] bg-[var(--color-ember-deep)]"
            />

            {/* Bracketed mono micro-label — Forge Workshop section signature. */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-obsidian)]/85">
                [§ NEWS — ORNN]
              </p>
              <button
                type="button"
                onClick={close}
                aria-label={t("aria.dismissAnnouncement")}
                className="
                  -mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[2px]
                  text-[var(--color-obsidian)]/85
                  transition-colors duration-150
                  hover:bg-[rgba(11,9,7,0.12)] hover:text-[var(--color-obsidian)]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-obsidian)]
                "
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  className="h-5 w-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Display title — Space Grotesk Bold UPPERCASE, the landing
                display voice. Tight letter-spacing per DESIGN.md type rules. */}
            <h2
              id="announcement-title"
              className="
                font-display font-bold uppercase
                text-[var(--color-obsidian)]
                text-[28px] sm:text-[32px] leading-[1.02] tracking-[-0.025em]
              "
            >
              {displayTitle}
            </h2>

            {/* Welded-seam divider — hairline + rivet pair pattern in
                ember-deep. Matches the landing's section-divider language. */}
            <div className="relative mt-5 mb-5 h-px w-full bg-[rgba(11,9,7,0.35)]">
              <span
                aria-hidden
                className="absolute -top-[2.5px] left-[25%] h-[5px] w-[5px] rounded-full bg-[var(--color-ember-deep)]"
              />
              <span
                aria-hidden
                className="absolute -top-[2.5px] left-[75%] h-[5px] w-[5px] rounded-full bg-[var(--color-ember-deep)]"
              />
            </div>

            {/* Body — markdown over the ember surface. The INK_OVERRIDES
                style above re-pins markdown-body tokens to dark ink so
                paragraphs / headings / links read against ember. */}
            <div className="markdown-body text-[15px] leading-[1.65]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
              >
                {displayBody}
              </ReactMarkdown>
            </div>

            {/* Footer — CTA + dismiss. Both press DOWN on hover per
                DESIGN.md hover behavior rule (no lift). The CTA carries
                a hard-offset shadow at rest that shrinks on hover. */}
            <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="
                  group inline-flex items-center justify-center
                  rounded-[2px] border border-[var(--color-obsidian)]/55
                  bg-transparent
                  px-4 py-2
                  font-mono text-[11px] font-semibold uppercase tracking-[0.18em]
                  text-[var(--color-obsidian)]
                  transition-[transform,background-color,border-color] duration-150
                  hover:bg-[rgba(11,9,7,0.1)] hover:border-[var(--color-obsidian)]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-obsidian)]
                  motion-reduce:transition-none
                "
              >
                Dismiss
              </button>
              {ctaHref && ctaLabel && (
                <a
                  href={ctaHref}
                  target={isExternalCta ? "_blank" : undefined}
                  rel={isExternalCta ? "noopener noreferrer" : undefined}
                  onClick={() => {
                    // Mark dismissed on CTA click so a returning user who
                    // followed the link isn't asked again on next visit.
                    if (announcement) markDismissed(announcement.id);
                  }}
                  style={{
                    boxShadow: "4px 4px 0 0 var(--color-ember-deep)",
                  }}
                  className="
                    relative inline-flex items-center justify-center gap-2
                    rounded-[2px] border border-[var(--color-obsidian)]
                    bg-[var(--color-obsidian)]
                    px-5 py-2
                    font-mono text-[11px] font-semibold uppercase tracking-[0.16em]
                    text-[var(--color-accent)]
                    transition-[transform,box-shadow,background-color] duration-150
                    hover:translate-x-[2px] hover:translate-y-[2px]
                    hover:shadow-[2px_2px_0_0_var(--color-ember-deep)]
                    active:translate-x-[4px] active:translate-y-[4px]
                    active:shadow-none
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-obsidian)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-accent)]
                    motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0
                    motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0
                  "
                >
                  {ctaLabel}
                  {isExternalCta && (
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="h-3.5 w-3.5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5L9 15M5 11v8h8" />
                    </svg>
                  )}
                </a>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
