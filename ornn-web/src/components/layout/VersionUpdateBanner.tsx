/**
 * VersionUpdateBanner — surfaces "a new ornn-web is out, reload to get
 * it" when the runtime version-check loop detects the deployed
 * `version.json` differs from the baked `__APP_VERSION__`.
 *
 * Mounted once at app root; kicks off the monitor on mount, shows a
 * small ember-stamp banner across the top when triggered, lets the
 * user reload (or dismiss until next mismatch). Idempotent: monitor
 * fires once per session.
 *
 * @module components/layout/VersionUpdateBanner
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { startVersionMonitor } from "@/lib/versionCheck";

export function VersionUpdateBanner() {
  const { t } = useTranslation();
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const handle = startVersionMonitor({
      onOutdated: () => setOutdated(true),
    });
    return () => handle.stop();
  }, []);

  if (!outdated) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="
        fixed inset-x-0 top-0 z-[100]
        flex items-center justify-center gap-3
        border-b border-accent/40 bg-accent/10 px-4 py-2
        font-mono text-[11px] uppercase tracking-[0.14em] text-accent
        backdrop-blur-sm
      "
    >
      <span>
        {t(
          "versionUpdate.message",
          "A new version of Ornn is available. Reload to apply.",
        )}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="
          rounded-sm border border-accent px-2.5 py-1
          font-mono text-[10px] uppercase tracking-[0.14em] text-accent
          transition-colors hover:bg-accent hover:text-page
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        "
      >
        {t("versionUpdate.reload", "Reload")}
      </button>
      <button
        type="button"
        onClick={() => setOutdated(false)}
        aria-label={t("versionUpdate.dismiss", "Dismiss")}
        className="
          ml-1 rounded-sm border border-transparent px-2 py-1
          font-mono text-[12px] text-accent/80
          transition-colors hover:text-accent
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        "
      >
        ×
      </button>
    </div>
  );
}
