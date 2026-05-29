/**
 * Right-rail "Versions" card extracted from SkillDetailPage (#453).
 *
 * Shows the current version (with a "latest" eyebrow when the user is
 * viewing the head), publish date, total version count, and a CTA that
 * opens the all-versions browser modal owned by the parent page. Pure
 * presentation — every interactive bit calls back to the parent.
 *
 * @module components/skill/SkillVersionsCard
 */

import { useTranslation } from "react-i18next";

export interface SkillVersionsCardProps {
  currentVersion: string;
  publishedOnSGT: string;
  totalVersions: number;
  viewingLatest: boolean;
  onBrowseAll: () => void;
}

export function SkillVersionsCard({
  currentVersion,
  publishedOnSGT,
  totalVersions,
  viewingLatest,
  onBrowseAll,
}: SkillVersionsCardProps) {
  const { t } = useTranslation();
  return (
    <section className="rounded-md border border-subtle bg-card p-5 card-impression">
      <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        {t("skillDetail.cardVersions", "Versions")}
      </h3>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tracking-tight text-strong">
          {currentVersion}
        </span>
        {viewingLatest && (
          <span className="rounded-sm border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
            {t("skillDetail.latest", "latest")}
          </span>
        )}
      </div>
      <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
        {t("skillDetail.heroPublishedOn", "Published {{date}}", { date: publishedOnSGT })}
        {totalVersions > 1 && (
          <>
            {" · "}
            {t("skillDetail.versionsTotal", "{{n}} versions total", { n: totalVersions })}
          </>
        )}
      </p>
      <div className="mt-3.5 flex flex-col gap-2">
        <button
          type="button"
          onClick={onBrowseAll}
          className="inline-flex items-center gap-1 self-start py-1 font-mono text-[10px] uppercase tracking-widest text-accent transition-all hover:text-accent-muted hover:gap-2"
        >
          {t("skillDetail.browseVersions", "Browse all versions")} →
        </button>
      </div>
    </section>
  );
}
