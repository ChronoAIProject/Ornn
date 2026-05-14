/**
 * LaunchCelebrationPopup — hardcoded launch-day modal on the landing
 * page (`/`). Independent of the dynamic announcements collection: the
 * content is baked into the frontend bundle so the public-launch notice
 * cannot be edited away, expire from the admin panel, or depend on
 * `/announcements/active` uptime during launch traffic.
 *
 * Behavior:
 *   - Opens on every mount of LandingPage (anonymous + signed-in).
 *   - Closing only sets local state — no localStorage write. Navigating
 *     away and back to `/` reopens the popup. Intentional for the
 *     launch window; remove the component from LandingPage when the
 *     offer ends.
 *
 * Visual structure:
 *   1. Bracketed mono eyebrow + ISO date (publication-cite signal).
 *   2. Space Grotesk display title (the celebration sentence).
 *   3. Welded-seam divider with rivet dots in ember.
 *   4. Two-up offer tiles — "200" numerals as the visual anchor, mono
 *      uppercase labels, model-name meta caption.
 *   5. Numbered redemption steps (01 / 02) with ember-mono numerals.
 *   6. Click-to-copy NyxID invite code chip in molten gold mono.
 *   7. Limited-slots warning row.
 *   8. Right-aligned CTAs — ghost Dismiss + primary STAR ON GITHUB,
 *      both letterpress press-down via `.cta-letterpress`.
 *
 * Surface uses semantic theme-aware tokens throughout (`bg-card`,
 * `text-strong`, `border-accent`, etc.) so dark + light themes both
 * read with full contrast. The card sits on a hard-offset letterpress
 * plate in `ember-deep` (DESIGN.md card-shadow color). All press-down
 * behavior is centralized via the `.cta-letterpress` utility so the
 * popup carries the same hover semantics as the rest of the landing.
 *
 * @module pages/landing/LaunchCelebrationPopup
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const GITHUB_URL = "https://github.com/ChronoAIProject/Ornn";
const GITHUB_LINK_LABEL = "github.com/ChronoAIProject/Ornn";
const INVITE_CODE = "NYX-2XXJI08A";
const COPY_FEEDBACK_MS = 1800;

export function LaunchCelebrationPopup() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(INVITE_CODE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // Older Safari / non-secure context — silently no-op. Code is
      // already visible inline; copy is a convenience, not the contract.
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.9 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="launch-popup-title"
            className="
              relative z-10 mx-4 w-full max-w-2xl max-h-[88vh] overflow-y-auto
              rounded-[3px] border-2 border-accent bg-card
              p-6 sm:p-9
            "
          >
            {/* Hard-offset letterpress plate in ember-deep (DESIGN.md
                Material & Print vocabulary — card-shadow impression
                color, theme-aware). Solid color, not a soft shadow. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 translate-x-[6px] translate-y-[6px] rounded-[3px] bg-ember-deep"
            />

            {/* Header row — bracketed mono section-cite + date stacked
                top-left, close affordance top-right. */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
                  {t("landing.launchPopup.eyebrow")}
                </p>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta">
                  {t("landing.launchPopup.date")}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={t("landing.launchPopup.dismissAria")}
                className="
                  -mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[2px]
                  text-meta transition-colors duration-150
                  hover:bg-elevated hover:text-strong
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
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

            {/* Title — the celebration sentence. Space Grotesk Bold,
                anchored to text-strong so it reads near-maximum contrast
                in both themes. */}
            <h2
              id="launch-popup-title"
              className="
                mt-5 font-display font-bold text-strong
                text-[22px] sm:text-[26px] leading-[1.22] tracking-[-0.015em]
              "
            >
              {t("landing.launchPopup.title")}
            </h2>

            {/* Welded-seam divider — hairline in strong-edge tone +
                rivet pair in ember accent. */}
            <div className="relative mt-6 mb-6 h-px w-full bg-strong-edge">
              <span
                aria-hidden
                className="absolute -top-[2.5px] left-[25%] h-[5px] w-[5px] rounded-full bg-accent"
              />
              <span
                aria-hidden
                className="absolute -top-[2.5px] left-[75%] h-[5px] w-[5px] rounded-full bg-accent"
              />
            </div>

            {/* Offer lineup: small mono header followed by two-up tiles.
                Each tile leads with a big "200" numeral in accent for
                immediate parsing, then the brand label and the model
                caption. */}
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-meta">
              {t("landing.launchPopup.creditsLead")}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <OfferTile
                count={t("landing.launchPopup.credit1Number")}
                label={t("landing.launchPopup.credit1Title")}
                caption={t("landing.launchPopup.credit1Caption")}
              />
              <OfferTile
                count={t("landing.launchPopup.credit2Number")}
                label={t("landing.launchPopup.credit2Title")}
                caption={t("landing.launchPopup.credit2Caption")}
              />
            </div>

            {/* Redemption block — section heading + numbered steps. */}
            <h3 className="mt-7 font-display text-[16px] font-bold uppercase tracking-[-0.005em] text-strong">
              {t("landing.launchPopup.conditionsHeading")}
            </h3>
            <ol className="mt-4 space-y-3">
              <li className="grid grid-cols-[auto_1fr] items-start gap-x-4">
                <span className="font-mono text-[13px] font-semibold tabular-nums text-accent pt-[1px]">
                  01
                </span>
                <p className="text-[14px] leading-[1.55] text-body">
                  {t("landing.launchPopup.step1Before")}{" "}
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="
                      font-mono font-semibold text-accent
                      underline decoration-2 underline-offset-[3px] decoration-accent-muted
                      transition-colors duration-150
                      hover:text-accent-support hover:decoration-accent-support
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                    "
                  >
                    {GITHUB_LINK_LABEL}
                  </a>{" "}
                  {t("landing.launchPopup.step1After")}
                </p>
              </li>
              <li className="grid grid-cols-[auto_1fr] items-start gap-x-4">
                <span className="font-mono text-[13px] font-semibold tabular-nums text-accent pt-[1px]">
                  02
                </span>
                <p className="text-[14px] leading-[1.55] text-body">
                  {t("landing.launchPopup.step2")}
                </p>
              </li>
            </ol>

            {/* Invite-code chip — click-to-copy with mono molten-gold
                code. Treated as a button (not a div) for keyboard
                affordance + screen-reader semantics. */}
            <div className="mt-6">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-meta">
                {t("landing.launchPopup.inviteLabel")}
              </p>
              <button
                type="button"
                onClick={copyInvite}
                aria-label={t("landing.launchPopup.inviteAria")}
                className="
                  mt-2 group flex w-full items-center justify-between gap-3
                  rounded-[2px] border border-accent-support/55 bg-elevated
                  px-4 py-3
                  transition-[border-color,background-color] duration-150
                  hover:border-accent-support hover:bg-accent-support/10
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-support
                "
              >
                <code className="font-mono text-[17px] font-semibold tracking-[0.06em] text-accent-support">
                  {INVITE_CODE}
                </code>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta group-hover:text-accent-support">
                  {copied
                    ? `${t("landing.launchPopup.copied")} ✓`
                    : `${t("landing.launchPopup.copy")} ⧉`}
                </span>
              </button>
            </div>

            {/* Limited-slots warning — mono caption, italic, ember
                triangle as a visual cue without saturating the row. */}
            <p className="mt-5 flex items-start gap-2 font-mono text-[11px] italic uppercase tracking-[0.14em] text-meta">
              <span aria-hidden className="text-accent not-italic">
                ▲
              </span>
              <span>{t("landing.launchPopup.limitedSlots")}</span>
            </p>

            {/* CTAs — ghost Dismiss + primary STAR ON GITHUB. Both
                ride `.cta-letterpress` for the canonical press-down +
                shadow behavior, reduced-motion safe. */}
            <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="
                  cta-letterpress cta-letterpress--ghost
                  inline-flex items-center justify-center
                  rounded-sm border border-strong-edge bg-card
                  px-4 py-2
                  font-mono text-[11px] font-semibold uppercase tracking-[0.18em]
                  text-body
                  hover:border-accent hover:text-strong
                "
              >
                {t("landing.launchPopup.dismiss")}
              </button>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className="
                  cta-letterpress
                  inline-flex items-center justify-center gap-2
                  rounded-sm border border-accent-muted bg-accent
                  px-5 py-2
                  font-mono text-[11px] font-semibold uppercase tracking-[0.16em]
                  text-page
                  hover:bg-accent-muted
                "
              >
                <span aria-hidden>★</span>
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

function OfferTile({
  count,
  label,
  caption,
}: {
  count: string;
  label: string;
  caption: string;
}) {
  return (
    <div className="rounded-[2px] border border-subtle bg-elevated p-4 sm:p-5">
      <p className="font-display text-[42px] sm:text-[48px] font-bold leading-none tracking-[-0.02em] text-accent">
        {count}
      </p>
      <div className="mt-3 h-px w-8 bg-accent-muted" aria-hidden />
      <p className="mt-3 font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-strong">
        {label}
      </p>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-meta">
        {caption}
      </p>
    </div>
  );
}
