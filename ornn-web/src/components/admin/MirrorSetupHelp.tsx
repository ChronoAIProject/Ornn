/**
 * Hover-popover that documents the GitHub Mirror first-run setup
 * (create App → install on org → fill credentials → enable + reconcile).
 * Sits next to the page title so a first-time admin doesn't have to
 * leave the page to figure out where the App ID / Installation ID /
 * private key come from.
 *
 * @module components/admin/MirrorSetupHelp
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

export interface MirrorSetupHelpProps {
  className?: string;
}

export function MirrorSetupHelp({ className = "" }: MirrorSetupHelpProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onClick={() => setIsOpen((prev) => !prev)}
        className="p-1 text-meta hover:text-accent transition-colors cursor-pointer"
        aria-label={t("aria.mirrorSetupInstructions")}
      >
        <InfoIcon className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-6 top-0 z-50 w-[28rem] max-w-[calc(100vw-3rem)] rounded-md border border-strong-edge bg-card p-4 card-impression"
            // Hover over the popover itself (not just the trigger) keeps it open.
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta mb-2">
              First-time setup
            </p>
            <p className="font-text text-xs leading-relaxed text-body mb-3">
              The mirror service writes to a GitHub repo via a GitHub App
              (better than a PAT — fine-grained, revocable, no human user
              attached). Three pieces of credentials are needed:
            </p>

            <ol className="space-y-2.5 font-text text-xs leading-relaxed text-body">
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                  1. Create a GitHub App (not OAuth App)
                </span>
                <p className="mt-0.5">
                  At{" "}
                  <a
                    href="https://github.com/settings/apps/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    github.com/settings/apps/new
                  </a>
                  . <strong>GitHub App</strong>, NOT OAuth App — App authenticates
                  as itself with an RSA-signed JWT and mints short-lived
                  installation tokens; OAuth would tie auth to a human user.
                </p>
                <p className="mt-1.5">
                  Form fields the mirror service actually uses:
                </p>
                <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
                  <li>
                    <strong>Repository permissions → Contents:</strong>{" "}
                    <code className="font-mono text-[11px] text-strong">Read &amp; write</code>{" "}
                    (commits / refs / blobs / tags). Leave every other
                    repository permission on <em>No access</em>; leave the
                    Organization and Account permission groups untouched.
                    (Metadata auto-flips to Read-only — required by GitHub,
                    not by us.)
                  </li>
                  <li>
                    <strong>Where can this GitHub App be installed?</strong>{" "}
                    If the mirror repo is in an org{" "}
                    <em>different from the App owner</em> (e.g. App built under
                    a personal account, mirror lives in{" "}
                    <code className="font-mono text-[11px] text-strong">ChronoAIProject</code>{" "}
                    org), pick <strong>Any account</strong>. "Only on this
                    account" would block installing into the org. "Any account"
                    isn't risky — the App has no public discovery surface, only
                    whoever has the link can install it.
                  </li>
                </ul>
                <p className="mt-1.5">
                  Form fields the mirror service does NOT use — set as below to
                  avoid required-field traps:
                </p>
                <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
                  <li>
                    <strong>Identifying and authorizing users:</strong> delete
                    the Callback URL row; do NOT tick "Request user
                    authorization (OAuth) during installation" or "Enable
                    Device Flow".
                  </li>
                  <li>
                    <strong>Post installation:</strong> leave Setup URL blank.
                  </li>
                  <li>
                    <strong>Webhook:</strong> <em>uncheck the Active box</em> —
                    then Webhook URL stops being required. We don't subscribe
                    to events; mirror operations are initiated from ornn-api.
                  </li>
                </ul>
                <p className="mt-1.5">
                  After Create GitHub App, on the App settings page note the{" "}
                  <strong>App ID</strong> (top-right) and click{" "}
                  <strong>Generate a private key</strong> — saves a{" "}
                  <code className="font-mono text-[11px] text-strong">.pem</code> file to disk.
                </p>
              </li>
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                  2. Install on the mirror owner
                </span>
                <p className="mt-0.5">
                  From the App page → "Install App" → pick the org / user that
                  owns the mirror repo (typically{" "}
                  <code className="font-mono text-[11px] text-strong">ChronoAIProject</code>) →
                  scope it to{" "}
                  <em>only</em> the mirror repo. The post-install URL contains
                  the <strong>Installation ID</strong> (
                  <code className="font-mono text-[11px] text-strong">/installations/&lt;id&gt;</code>); also visible via{" "}
                  <code className="font-mono text-[11px] text-strong">gh api /user/installations</code>.
                </p>
              </li>
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                  3. Fill the credentials card
                </span>
                <p className="mt-0.5">
                  Paste App ID, Installation ID, and the entire PEM (including
                  the <code className="font-mono text-[11px] text-strong">BEGIN/END</code> lines) into the
                  GitHub App credentials section below. Save. The PEM is
                  encrypted with AES-256-GCM before hitting Mongo and mid-masked
                  on read; round-tripping the masked value preserves the stored
                  key.
                </p>
              </li>
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                  4. Set repo + flip Enable + reconcile
                </span>
                <p className="mt-0.5">
                  In the Mirror repository card, enter owner / repo / branch
                  (e.g. <code className="font-mono text-[11px] text-strong">ChronoAIProject / ornn-skills / main</code>),
                  flip the Enable toggle, Save. Then hit{" "}
                  <strong>Reconcile now</strong> — the first run pushes every
                  public + system skill to the repo. The hourly cron at{" "}
                  <code className="font-mono text-[11px] text-strong">:17</code> takes over from there.
                </p>
              </li>
            </ol>

            <p className="mt-3 border-t border-subtle pt-2 font-text text-[11px] leading-relaxed text-meta">
              Settings live in the{" "}
              <code className="font-mono text-[11px]">platform_settings</code>{" "}
              Mongo collection — no pod restart needed. Private skills are{" "}
              <strong>never</strong> mirrored regardless of config; that's the
              moat.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
