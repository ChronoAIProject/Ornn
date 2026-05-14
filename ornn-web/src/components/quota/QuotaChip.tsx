/**
 * QuotaChip — ambient quota indicator that lives in the breadcrumb-row
 * right rail (`RootLayout`) on every authenticated page.
 *
 * Renders **both** surfaces as a paired pill group — playground and
 * skill-generation — so the user sees their full quota posture at a
 * glance without opening the drawer. Click any pill to expand the full
 * `QuotaSummary` breakdown.
 *
 * Each pill independently colors itself by its own surface state:
 *   - admin:   ember "∞ Unlimited" stamp
 *   - exhausted: danger tone
 *   - warning (≥80% used): warning tone
 *   - normal:  neutral tone
 *
 * Hidden entirely for anonymous callers.
 *
 * @module components/quota/QuotaChip
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { QuotaSnapshot, Surface, SurfaceSnapshot } from "@/services/quotaApi";
import { useMyQuota } from "@/hooks/useQuota";
import { QuotaSummary } from "./QuotaSummary";

function nfmt(n: number): string {
  return n.toLocaleString("en-US");
}

interface SurfacePillProps {
  surface: Surface;
  snapshot: SurfaceSnapshot;
  isAdmin: boolean;
  onOpen: () => void;
}

/** A single surface's pill — always part of the paired chip group. */
function SurfacePill({ surface, snapshot, isAdmin, onOpen }: SurfacePillProps) {
  const { t } = useTranslation();
  const surfaceLabel =
    surface === "playground"
      ? t("quota.surfacePlayground", "Playground")
      : t("quota.surfaceSkillGen", "Skill-gen");

  if (isAdmin) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("quota.chipAriaAdmin", "{{surface}} quota — admin unlimited", {
          surface: surfaceLabel,
        })}
        title={t("quota.chipTitleAdmin", "{{surface}} · Unlimited (admin bypass)", {
          surface: surfaceLabel,
        })}
        className="
          inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/5
          px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-accent
          transition-colors duration-150 hover:bg-accent/10 cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        "
      >
        <span className="opacity-70">{surfaceLabel}</span>
        <span aria-hidden className="text-meta opacity-60">·</span>
        <span aria-hidden className="text-base leading-none">∞</span>
      </button>
    );
  }

  const ceiling = snapshot.defaultAllotment + snapshot.adminGrant;
  const remaining = Math.max(0, snapshot.remaining);
  const tone =
    remaining <= 0 ? "danger" : snapshot.warning ? "warning" : "ok";

  const toneClass =
    tone === "danger"
      ? "border-danger/50 text-danger hover:border-danger hover:bg-danger/5"
      : tone === "warning"
      ? "border-warning/50 text-warning hover:border-warning hover:bg-warning/5"
      : "border-subtle text-strong hover:border-accent hover:bg-elevated/40";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t(
        "quota.chipAriaRemaining",
        "{{surface}} quota — {{remaining}} of {{ceiling}} remaining",
        { surface: surfaceLabel, remaining: nfmt(remaining), ceiling: nfmt(ceiling) },
      )}
      title={t(
        "quota.chipTitleRemaining",
        "{{surface}}: {{remaining}} / {{ceiling}} this month",
        { surface: surfaceLabel, remaining: nfmt(remaining), ceiling: nfmt(ceiling) },
      )}
      className={`
        inline-flex h-7 items-center gap-1.5 rounded-sm border bg-transparent
        px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]
        transition-colors duration-150 cursor-pointer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${toneClass}
      `}
    >
      <span className="opacity-70">{surfaceLabel}</span>
      <span aria-hidden className="opacity-50">·</span>
      <span>{nfmt(remaining)}</span>
      <span className="text-meta opacity-70">/{nfmt(ceiling)}</span>
    </button>
  );
}

interface QuotaChipProps {
  className?: string;
}

export function QuotaChip({ className = "" }: QuotaChipProps) {
  const { t } = useTranslation();
  const { data: quota } = useMyQuota();
  const [open, setOpen] = useState(false);

  if (!quota) return null;

  const isAdmin = quota.isAdmin;

  // For admin, the drawer's per-surface bars don't carry useful info —
  // but we still allow opening it so the visual "click → see detail"
  // affordance remains consistent across modes.
  return (
    <>
      <div
        role="group"
        aria-label={t("aria.quotaUsage")}
        className={`inline-flex items-center gap-1.5 ${className}`}
      >
        <SurfacePill
          surface="playground"
          snapshot={quota.playground}
          isAdmin={isAdmin}
          onOpen={() => setOpen(true)}
        />
        <SurfacePill
          surface="skillGen"
          snapshot={quota.skillGen}
          isAdmin={isAdmin}
          onOpen={() => setOpen(true)}
        />
      </div>

      <QuotaSummary isOpen={open} onClose={() => setOpen(false)} quota={quota as QuotaSnapshot} />
    </>
  );
}
