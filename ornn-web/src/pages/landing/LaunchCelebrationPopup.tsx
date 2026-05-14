/**
 * LaunchCelebrationPopup — hardcoded launch-day modal on the landing
 * page (`/`). Independent of the dynamic announcements collection: the
 * content is baked into the frontend bundle so the public-launch notice
 * cannot be edited away or expire from the admin panel.
 *
 * Behavior:
 *   - Opens on every mount of LandingPage (anonymous + signed-in).
 *   - Closing only sets local state — no localStorage write. If the
 *     user navigates away and returns to `/`, the popup shows again.
 *     This is intentional for the launch window; remove the component
 *     from LandingPage when the offer ends.
 *
 * Design language mirrors AnnouncementPopup (ember card on obsidian
 * letterpress, Space Grotesk display title, JetBrains Mono bracketed
 * micro-label) but sized one step larger ("大一点的 popup") because the
 * launch notice carries more body content than a routine announcement.
 *
 * @module pages/landing/LaunchCelebrationPopup
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const GITHUB_URL = "https://github.com/ChronoAIProject/Ornn";
const INVITE_CODE = "NYX-2XXJI08A";

export function LaunchCelebrationPopup() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

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
            aria-labelledby="launch-popup-title"
            className="
              relative z-10 mx-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto
              rounded-[3px] border border-[var(--color-ember-deep)] bg-accent
              p-7 sm:p-9
            "
          >
            {/* Letterpress shadow plate in ember-deep. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 translate-x-[6px] translate-y-[6px] rounded-[3px] bg-[var(--color-ember-deep)]"
            />

            {/* Eyebrow row: bracketed mono micro-label + date + close. */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-obsidian)]/85">
                  {t("landing.launchPopup.eyebrow")}
                </p>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-obsidian)]/70">
                  {t("landing.launchPopup.date")}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={t("landing.launchPopup.dismissAria")}
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

            <h2
              id="launch-popup-title"
              className="
                font-display font-bold
                text-[var(--color-obsidian)]
                text-[24px] sm:text-[28px] leading-[1.18] tracking-[-0.015em]
              "
            >
              {t("landing.launchPopup.title")}
            </h2>

            {/* Welded-seam divider. */}
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

            <p className="text-[15px] leading-[1.65] text-[var(--color-obsidian)]/90">
              {t("landing.launchPopup.intro")}
            </p>

            <p className="mt-5 text-[15px] leading-[1.65] text-[var(--color-obsidian)]">
              {t("landing.launchPopup.creditsLead")}
            </p>
            <ul className="mt-3 ml-4 space-y-2">
              <li className="text-[15px] font-semibold text-[var(--color-obsidian)]">
                {t("landing.launchPopup.creditItem1")}
              </li>
              <li className="text-[15px] font-semibold text-[var(--color-obsidian)]">
                {t("landing.launchPopup.creditItem2")}
              </li>
            </ul>

            <h3 className="mt-7 font-display font-bold uppercase text-[var(--color-obsidian)] text-[18px] tracking-[-0.01em]">
              {t("landing.launchPopup.conditionsHeading")}
            </h3>
            <p className="mt-2 text-[15px] leading-[1.65] text-[var(--color-obsidian)]/90">
              {t("landing.launchPopup.conditionsBodyStart")}{" "}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono font-semibold underline decoration-[var(--color-ember-deep)] decoration-2 underline-offset-2 text-[var(--color-ember-deep)] hover:text-[var(--color-obsidian)]"
              >
                github.com/ChronoAIProject/Ornn
              </a>{" "}
              {t("landing.launchPopup.conditionsBodyEnd")}
            </p>

            {/* Highlighted footer note — left border in ember-deep,
                muted obsidian text, mono-emphasis on the invite code. */}
            <div className="mt-6 border-l-[3px] border-[var(--color-ember-deep)] bg-[rgba(11,9,7,0.06)] px-4 py-3">
              <p className="text-[13px] italic leading-[1.6] text-[var(--color-obsidian)]/85">
                {t("landing.launchPopup.callout")}{" "}
                <span className="font-mono not-italic font-semibold text-[var(--color-obsidian)]">
                  {INVITE_CODE}
                </span>
              </p>
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="
                  inline-flex items-center justify-center
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
                {t("landing.launchPopup.dismiss")}
              </button>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                style={{ boxShadow: "4px 4px 0 0 var(--color-ember-deep)" }}
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
                {t("landing.launchPopup.cta")}
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
              </a>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
