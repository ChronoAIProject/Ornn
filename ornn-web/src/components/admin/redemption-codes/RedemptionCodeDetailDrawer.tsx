/**
 * RedemptionCodeDetailDrawer — read-only side panel for a single code.
 *
 * Shows the full code, grant breakdown, note, and the create / redeem /
 * invalidate audit metadata when present. Mirrors the spring slide-in
 * pattern from QuotaUserDetailDrawer.
 *
 * @module components/admin/redemption-codes/RedemptionCodeDetailDrawer
 */

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import type {
  ActorMeta,
  RedemptionCode,
  RedemptionCodeStatus,
  Surface,
} from "@/services/redemptionCodesApi";

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill generation",
};

const STATUS_BADGE: Record<
  RedemptionCodeStatus,
  { color: "cyan" | "green" | "muted"; label: string }
> = {
  active: { color: "cyan", label: "Active" },
  redeemed: { color: "green", label: "Redeemed" },
  invalidated: { color: "muted", label: "Invalidated" },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ActorLine({ actor }: { actor: ActorMeta }) {
  return (
    <div>
      <p className="font-text text-sm text-strong">
        {actor.displayName || actor.email}
      </p>
      <p className="font-mono text-[11px] text-meta">{actor.email}</p>
    </div>
  );
}

export interface RedemptionCodeDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  code: RedemptionCode | null;
}

export function RedemptionCodeDetailDrawer({
  isOpen,
  onClose,
  code,
}: RedemptionCodeDetailDrawerProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const onCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent — user can select-and-copy manually
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && code && (
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
            aria-label={t("aria.redemptionCodeDetail")}
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col gap-5 overflow-y-auto border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ REDEMPTION CODE]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  Code detail
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
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="rounded border border-accent/30 bg-accent/5 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                Code
              </p>
              <p className="mt-1 break-all font-mono text-base font-semibold text-accent">
                {code.code}
              </p>
              <button
                type="button"
                onClick={onCopy}
                className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-meta hover:text-accent"
              >
                {copied ? "Copied" : "Copy code"}
              </button>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                Status
              </p>
              <div className="mt-1">
                <Badge color={STATUS_BADGE[code.status].color}>
                  {STATUS_BADGE[code.status].label}
                </Badge>
              </div>
            </div>

            <section>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                Grants
              </h3>
              <ul className="space-y-1.5">
                {code.grants.map((g) => (
                  <li
                    key={g.surface}
                    className="flex items-baseline justify-between rounded-sm border border-subtle bg-elevated/40 px-3 py-1.5 font-mono text-[11px]"
                  >
                    <span className="text-body">{SURFACE_LABEL[g.surface]}</span>
                    <span className="text-strong">
                      +{g.amount.toLocaleString("en-US")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {code.note && (
              <section>
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  Note
                </h3>
                <p className="rounded border border-subtle bg-elevated/40 p-3 font-text text-sm text-body">
                  {code.note}
                </p>
              </section>
            )}

            <section className="space-y-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  Created
                </p>
                <p className="mt-1 font-mono text-[11px] text-body">
                  {formatDateTime(code.createdAt)}
                </p>
                <div className="mt-1">
                  <ActorLine actor={code.createdBy} />
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  Expires
                </p>
                <p className="mt-1 font-mono text-[11px] text-body">
                  {formatDateTime(code.expiresAt)}
                </p>
              </div>
              {code.redeemedAt && code.redeemedBy && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                    Redeemed
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-body">
                    {formatDateTime(code.redeemedAt)}
                  </p>
                  <div className="mt-1">
                    <ActorLine actor={code.redeemedBy} />
                  </div>
                </div>
              )}
              {code.invalidatedAt && code.invalidatedBy && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                    Invalidated
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-body">
                    {formatDateTime(code.invalidatedAt)}
                  </p>
                  <div className="mt-1">
                    <ActorLine actor={code.invalidatedBy} />
                  </div>
                </div>
              )}
            </section>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
