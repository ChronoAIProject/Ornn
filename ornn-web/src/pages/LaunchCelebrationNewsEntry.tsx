/**
 * LaunchCelebrationNewsEntry — hardcoded sibling of LaunchCelebrationPopup,
 * stamped permanently at the top of the News archive (`/news`).
 *
 * Same content contract as the landing-page launch popup: free-credit
 * launch promo (2 × 200 credits), GitHub-star redemption flow, NyxID
 * invite code, fulfillment + limited-slots notes, "Star on GitHub" CTA.
 * Independent of the dynamic announcements collection so the launch
 * notice cannot be edited away from the admin panel or depend on
 * `/announcements/active` uptime.
 *
 * Bilingual via the shared `landing.launchPopup.*` i18n keys — EN + ZH
 * are inherited verbatim from the popup, no duplicated strings.
 *
 * Differences from the popup:
 *   - No modal / portal / framer-motion wrappers — renders as a regular
 *     `<article>` styled to match NewsPage's `card-impression` vocabulary.
 *   - No dismiss button (this is a persistent archive entry).
 *   - Keeps the click-to-copy invite chip and "Star on GitHub" CTA.
 *
 * @module pages/LaunchCelebrationNewsEntry
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

const GITHUB_URL = "https://github.com/ChronoAIProject/Ornn";
const GITHUB_LINK_LABEL = "github.com/ChronoAIProject/Ornn";
const DISCUSSIONS_URL = "https://github.com/ChronoAIProject/Ornn/discussions/521";
const INVITE_CODE = "NYX-2XXJI08A";
const PUBLISHED_AT_ISO = "2026-05-13";
const COPY_FEEDBACK_MS = 1800;

export function LaunchCelebrationNewsEntry() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

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

  return (
    <article
      id="announcement-launch-celebration"
      aria-labelledby="news-entry-launch-celebration-title"
      className="card-impression flex flex-col gap-4 rounded-sm border border-accent bg-card p-6 sm:p-8"
    >
      {/* Header — bracketed mono eyebrow stacked over the publication
          date, matching the popup's editorial signature. */}
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
          {t("landing.launchPopup.eyebrow")}
        </p>
        <time
          dateTime={PUBLISHED_AT_ISO}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta"
        >
          {t("landing.launchPopup.date")}
        </time>
        <h2
          id="news-entry-launch-celebration-title"
          className="
            mt-2 font-display font-bold text-strong
            text-[22px] sm:text-[26px] leading-[1.22] tracking-[-0.015em]
          "
        >
          {t("landing.launchPopup.title")}
        </h2>
      </header>

      {/* Welded-seam divider — hairline + rivet pair in accent, same
          language as the popup. */}
      <div className="relative h-px w-full bg-strong-edge">
        <span
          aria-hidden
          className="absolute -top-[2.5px] left-[25%] h-[5px] w-[5px] rounded-full bg-accent"
        />
        <span
          aria-hidden
          className="absolute -top-[2.5px] left-[75%] h-[5px] w-[5px] rounded-full bg-accent"
        />
      </div>

      {/* Offer lineup. */}
      <div>
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
      </div>

      {/* Redemption steps. */}
      <div>
        <h3 className="font-display text-[16px] font-bold uppercase tracking-[-0.005em] text-strong">
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
      </div>

      {/* Invite-code chip — click-to-copy. */}
      <div>
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
        <p className="mt-3 text-[12.5px] leading-[1.6] text-body">
          {t("landing.launchPopup.inviteHelp")}
        </p>
      </div>

      {/* Fulfillment note. */}
      <p className="text-[12.5px] leading-[1.6] text-body">
        {t("landing.launchPopup.fulfillmentBefore")}{" "}
        <a
          href={DISCUSSIONS_URL}
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
          {t("landing.launchPopup.fulfillmentLinkLabel")}
        </a>{" "}
        {t("landing.launchPopup.fulfillmentAfter")}
      </p>

      {/* Limited-slots warning. */}
      <p className="flex items-start gap-2 font-mono text-[11px] italic uppercase tracking-[0.14em] text-meta">
        <span aria-hidden className="text-accent not-italic">
          ▲
        </span>
        <span>{t("landing.launchPopup.limitedSlots")}</span>
      </p>

      {/* CTA — primary STAR ON GITHUB. No Dismiss (persistent entry). */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
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
    </article>
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
