/**
 * AnnouncementBanner — global, top-right announcement surface (#949).
 *
 * Replaces the two centred landing modals (the hardcoded launch celebration
 * and the dynamic announcement popup) with a single collapsed "headline pill"
 * that lives on EVERY page (mounted in AnalyticsRoot, next to the router
 * Outlet). The pill shows the newest announcement headline + a `+N` counter;
 * hovering / focusing / tapping it expands a stacked list of all active
 * announcements. Every item is individually dismissable (persisted in
 * localStorage); when nothing is left the banner renders nothing.
 *
 * Sources, aggregated:
 *   - the hardcoded launch announcement (baked into the bundle so it can't be
 *     edited away during the launch window), pinned first;
 *   - all dynamic announcements from `usePublicAnnouncements()` (the public
 *     list endpoint), newest first.
 *
 * The cards carry solid surfaces, so the banner stays legible over the dark
 * landing hero video and on light/dark app pages alike — no per-context token
 * juggling needed.
 *
 * @module components/announcements/AnnouncementBanner
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { usePublicAnnouncements } from "@/hooks/useAnnouncements";
import { pickLocalized, pickLocalizedCtaLabel } from "@/lib/announcementLocale";

const DISMISS_PREFIX = "ornn:announcement:dismissed:";

// Hardcoded launch announcement — see landing.launchPopup.* for copy.
const LAUNCH_ID = "launch-2026-05-13";
const GITHUB_URL = "https://github.com/ChronoAIProject/Ornn";
const DISCUSSIONS_URL = "https://github.com/ChronoAIProject/Ornn/discussions/521";
const INVITE_CODE = "NYX-2XXJI08A";
const COPY_FEEDBACK_MS = 1800;
const CLOSE_DELAY_MS = 160;

type BannerItem =
  | { id: string; kind: "launch" }
  | {
      id: string;
      kind: "dynamic";
      title: string;
      bodyMarkdown: string;
      ctaLabel: string | null;
      ctaHref: string | null;
    };

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + id) === "1";
  } catch {
    return false;
  }
}
function persistDismiss(id: string): void {
  try {
    localStorage.setItem(DISMISS_PREFIX + id, "1");
  } catch {
    // private mode / disabled storage — dismissal just won't persist.
  }
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M14 8a4 4 0 0 1 0 8" />
      <path d="M10 18.5 11 21" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

export function AnnouncementBanner() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: dynamic } = usePublicAnnouncements();
  const reduced = useReducedMotion() ?? false;

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // localStorage is the source of truth for dismissal; this just forces a
  // re-filter after a dismiss without enumerating storage keys.
  const [, bumpDismissed] = useReducer((x: number) => x + 1, 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => () => cancelClose(), []);

  // Tap-outside dismiss for the open panel (touch + mouse).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const dismiss = (id: string) => {
    persistDismiss(id);
    bumpDismissed();
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(INVITE_CODE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // non-secure context — code is visible inline, copy is convenience only.
    }
  };

  // Aggregate: launch pinned first, then dynamic newest-first, minus dismissed.
  const items: BannerItem[] = [];
  if (!isDismissed(LAUNCH_ID)) items.push({ id: LAUNCH_ID, kind: "launch" });
  for (const a of dynamic ?? []) {
    if (isDismissed(a.id)) continue;
    items.push({
      id: a.id,
      kind: "dynamic",
      title: pickLocalized(a.titleEn, a.titleZh, lang),
      bodyMarkdown: pickLocalized(a.bodyMarkdownEn, a.bodyMarkdownZh, lang),
      ctaLabel: pickLocalizedCtaLabel(a.ctaLabelEn, a.ctaLabelZh, lang),
      ctaHref: a.ctaUrl,
    });
  }

  const first = items[0];
  if (!first) return null;

  const headline = first.kind === "launch" ? t("landing.launchPopup.bannerTitle") : first.title;
  const extra = items.length - 1;

  return createPortal(
    <div
      ref={rootRef}
      className="pointer-events-none fixed right-3 top-[72px] z-40 flex w-[min(92vw,360px)] flex-col items-end sm:right-4 sm:top-[76px]"
      aria-label={t("announcementBanner.ariaLabel")}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocusCapture={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlurCapture={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) scheduleClose();
      }}
    >
      {/* Collapsed headline pill */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="announcement-panel"
        // Open-only: hover/focus already open it; a toggle here would race the
        // emulated mouseenter on tap and slam the panel shut on touch. Closing
        // is handled by mouse-leave, blur, or tap-outside.
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-[color:var(--color-border-strong)] bg-[var(--color-card)] py-1.5 pl-3 pr-2.5 text-left shadow-[var(--card-shadow-rest)] backdrop-blur-[10px] transition-colors hover:border-accent focus-ring-ember"
      >
        <span className="grid h-5 w-5 shrink-0 place-items-center text-accent">
          <MegaphoneIcon className="h-4 w-4" />
        </span>
        <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-strong">
          {headline}
        </span>
        {extra > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-px font-mono text-[10px] font-bold text-[var(--color-page)]">
            {t("announcementBanner.moreCount", { count: extra })}
          </span>
        )}
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-meta transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Expanded stack */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="announcement-panel"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: reduced ? 0.12 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto mt-2 max-h-[min(72vh,560px)] w-full overflow-y-auto rounded-[6px] border border-[color:var(--color-border-strong)] bg-[var(--color-panel)] p-2.5 shadow-[var(--card-shadow-rest)] backdrop-blur-[14px]"
          >
            <p className="px-1 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-meta">
              {t("announcementBanner.eyebrow")}
            </p>
            <div className="flex flex-col gap-2">
              {items.map((item) =>
                item.kind === "launch" ? (
                  <LaunchCard
                    key={item.id}
                    onDismiss={() => dismiss(item.id)}
                    copied={copied}
                    onCopy={copyInvite}
                  />
                ) : (
                  <DynamicCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
                ),
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/** Shared card chrome: dismiss control top-right + accent rail. */
function CardShell({
  accent,
  onDismiss,
  children,
}: {
  accent: "ember" | "neutral";
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="relative rounded-[4px] border bg-[var(--color-card)] p-3 pr-8"
      style={{
        borderColor: accent === "ember" ? "var(--color-accent-muted)" : "var(--color-border-subtle)",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("announcementBanner.dismissAria")}
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-[2px] text-meta transition-colors hover:bg-elevated hover:text-strong focus-ring-ember"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

/** Condensed hardcoded launch card: title + credits + invite + star CTA. */
function LaunchCard({
  onDismiss,
  copied,
  onCopy,
}: {
  onDismiss: () => void;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CardShell accent="ember" onDismiss={onDismiss}>
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-accent">
        {t("landing.launchPopup.eyebrow")}
      </p>
      <h3 className="mt-1 font-display text-[14px] font-bold uppercase leading-[1.1] tracking-[-0.01em] text-strong">
        {t("landing.launchPopup.bannerTitle")}
      </h3>

      <p className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-meta">
        {t("landing.launchPopup.creditsLead")}
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {[
          { n: t("landing.launchPopup.credit1Number"), l: t("landing.launchPopup.credit1Title") },
          { n: t("landing.launchPopup.credit2Number"), l: t("landing.launchPopup.credit2Title") },
        ].map((c, idx) => (
          <div key={idx} className="rounded-[2px] border border-subtle bg-elevated px-2 py-1.5">
            <span className="font-display text-[20px] font-bold leading-none tracking-[-0.02em] text-accent">
              {c.n}
            </span>
            <span className="mt-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-strong">
              {c.l}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onCopy}
        aria-label={t("landing.launchPopup.inviteAria")}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-[2px] border border-accent-support/55 bg-elevated px-2.5 py-1.5 transition-colors hover:border-accent-support focus-ring-ember"
      >
        <code className="font-mono text-[13px] font-semibold tracking-[0.05em] text-accent-support">{INVITE_CODE}</code>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-meta">
          {copied ? `${t("landing.launchPopup.copied")} ✓` : `${t("landing.launchPopup.copy")} ⧉`}
        </span>
      </button>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-[2px] border border-accent-muted bg-accent px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-page)] transition-colors hover:bg-accent-muted focus-ring-ember"
        >
          <span aria-hidden>★</span>
          {t("landing.launchPopup.cta")}
        </a>
        <a
          href={DISCUSSIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-meta underline decoration-from-font underline-offset-2 transition-colors hover:text-accent focus-ring-ember"
        >
          {t("announcementBanner.redeemLink")} →
        </a>
      </div>
    </CardShell>
  );
}

/** Dynamic announcement card: title + markdown body + optional CTA. */
function DynamicCard({
  item,
  onDismiss,
}: {
  item: Extract<BannerItem, { kind: "dynamic" }>;
  onDismiss: () => void;
}) {
  const isExternal = item.ctaHref ? /^https?:\/\//i.test(item.ctaHref) : false;
  return (
    <CardShell accent="neutral" onDismiss={onDismiss}>
      <h3 className="font-display text-[14px] font-bold uppercase leading-[1.1] tracking-[-0.01em] text-strong">
        {item.title}
      </h3>
      <div className="markdown-body mt-1.5 text-[12px] leading-[1.55] text-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {item.bodyMarkdown}
        </ReactMarkdown>
      </div>
      {item.ctaHref && item.ctaLabel && (
        <a
          href={item.ctaHref}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-accent underline decoration-from-font underline-offset-2 transition-colors hover:text-accent-support focus-ring-ember"
        >
          {item.ctaLabel} →
        </a>
      )}
    </CardShell>
  );
}
