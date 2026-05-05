/**
 * Cookie / analytics consent banner.
 *
 * GDPR-compliant: shown by default until the visitor explicitly accepts
 * or declines. Default state is "undecided" — analytics stay opted out
 * until Accept is clicked. The banner self-hides as soon as a choice
 * is recorded; the choice persists in localStorage so subsequent visits
 * are quiet.
 *
 * Visual language follows DESIGN.md (Industrial Forge):
 *   - Page-floor letterpress card (cool steel-paper / forged-metal).
 *   - Mono micro-label for the "[ § ANALYTICS — CONSENT ]" stamp.
 *   - Two CTAs — Accept (ember primary) + Decline (ghost secondary) —
 *     both press DOWN on hover via the existing Button primitive.
 *
 * @module components/analytics/CookieConsentBanner
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  isUndecided,
  setConsent,
  onConsentChange,
} from "@/lib/cookieConsent";

export function CookieConsentBanner() {
  // Hydrate from localStorage on mount so SSR-style snapshots don't
  // briefly flash the banner for users who already decided.
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    setVisible(isUndecided());
    const unsub = onConsentChange(() => {
      // Whether granted or revoked, the banner has done its job.
      if (!isUndecided()) setVisible(false);
    });
    return unsub;
  }, []);

  if (!visible) return null;

  const accept = () => setConsent("granted");
  const decline = () => setConsent("denied");

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-labelledby="cookie-consent-title"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div
        className="card-impression pointer-events-auto w-full max-w-3xl rounded-md border border-subtle bg-card px-5 py-4 sm:px-6 sm:py-5"
        data-testid="cookie-consent-banner"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-meta">
              [ § ANALYTICS — CONSENT ]
            </p>
            <h2
              id="cookie-consent-title"
              className="mb-1 font-display text-base font-semibold tracking-tight text-strong"
            >
              We use cookies for product analytics.
            </h2>
            <p className="font-text text-sm leading-relaxed text-body">
              Ornn uses{" "}
              <a
                href="https://posthog.com/eu"
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline-offset-2 hover:underline"
              >
                PostHog (EU)
              </a>{" "}
              to measure feature usage and improve the platform. Session
              replay is sampled with input fields masked. You can change
              your choice anytime in settings.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={decline}
              className="min-w-[96px]"
            >
              Decline
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={accept}
              className="min-w-[96px]"
            >
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
