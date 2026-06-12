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

import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import {
  isUndecided,
  setConsent,
  onConsentChange,
} from "@/lib/cookieConsent";

export function CookieConsentBanner() {
  const { t } = useTranslation();
  // Subscribe to the consent store directly via useSyncExternalStore —
  // the banner is visible exactly while the choice is undecided. This
  // replaces a mount effect that set visibility + wired a listener,
  // removing the setState-in-effect cascade (#888). The subscribe
  // callback ignores its `granted` arg; the snapshot is recomputed by
  // re-reading the store.
  const visible = useSyncExternalStore(onConsentChange, isUndecided, isUndecided);

  if (!visible) return null;

  const accept = () => setConsent("granted");
  const decline = () => setConsent("denied");

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-labelledby="cookie-consent-title"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:justify-end sm:px-6 sm:pb-6"
    >
      <div
        className="card-impression pointer-events-auto w-full max-w-md rounded-md border border-subtle bg-card px-5 py-4 sm:px-6 sm:py-5"
        data-testid="cookie-consent-banner"
      >
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-meta">
              {t("cookieConsent.stamp")}
            </p>
            <h2
              id="cookie-consent-title"
              className="mb-1 font-display text-base font-semibold tracking-tight text-strong"
            >
              {t("cookieConsent.title")}
            </h2>
            <p className="font-text text-sm leading-relaxed text-body">
              <Trans
                i18nKey="cookieConsent.body"
                components={{
                  privacyLink: (
                    <Link
                      to="/legal/privacy"
                      className="text-accent underline-offset-2 hover:underline"
                    />
                  ),
                }}
              />
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={decline}
              className="min-w-[96px]"
            >
              {t("cookieConsent.decline")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={accept}
              className="min-w-[96px]"
            >
              {t("cookieConsent.accept")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
