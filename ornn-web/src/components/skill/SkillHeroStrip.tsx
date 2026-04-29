/**
 * SkillHeroStrip — top-of-page identity strip on the Skill Detail Page.
 *
 * One card with everything a visitor needs to answer "what is this / can I
 * use it / should I trust it" in a single glance: icon, name, description,
 * category + tag row, status pill row (visibility / version / audit verdict
 * / pulls count), owner line, and a primary CTA + kebab menu for secondary
 * actions.
 *
 * Styled in the Editorial Forge language (DESIGN.md): Fraunces title, Inter
 * body, JetBrains Mono pills, ember accent, hairline borders, 2-4px radii.
 *
 * @module components/skill/SkillHeroStrip
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SkillDetail } from "@/types/domain";
import type { AuditRecord } from "@/types/audit";

interface SkillHeroStripProps {
  skill: SkillDetail;
  pullCount7d?: number;
  versionAudit?: AuditRecord;
  isAuthenticated: boolean;
  isOwner: boolean;
  ownerDisplayName: string;
  ownerAvatarUrl?: string | null;
  /** Click handler for the primary "Try in Playground" CTA. */
  onTryPlayground: () => void;
  /** Authenticated and skill is non-private OR caller is owner. */
  canTryWithCli: boolean;
  /** Click handler for the "Use Nyx CLI" secondary action. */
  onCopyCliPrompt: () => void;
  /** Click handler for "Download package" — only when raw ZIP is available. */
  onDownloadPackage?: () => void;
  /** Click handler for "Edit skill" — only when caller is owner/admin. */
  onEditSkill?: () => void;
}

/**
 * Format a date in the user's locale, abbreviated. Returns ISO on parse failure.
 */
function formatShortDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Render the audit-verdict pill with the right semantic colors. */
function AuditPill({ audit, t }: { audit?: AuditRecord; t: (key: string, fallback?: string, opts?: object) => string }) {
  if (!audit || audit.status !== "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong-edge bg-elevated/40 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-meta">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5" /><path d="M12 16h.01" /></svg>
        {t("skillDetail.heroAuditNone", "Not audited")}
      </span>
    );
  }
  const verdict = audit.verdict;
  const score = audit.overallScore.toFixed(1);
  const tone =
    verdict === "green"
      ? "text-success border-success/40 bg-success-soft"
      : verdict === "yellow"
        ? "text-warning border-warning/40 bg-warning-soft"
        : "text-danger border-danger/40 bg-danger-soft";
  const label =
    verdict === "green"
      ? t("skillDetail.heroAuditPass", "Pass")
      : verdict === "yellow"
        ? t("skillDetail.heroAuditWarn", "Caution")
        : t("skillDetail.heroAuditFail", "Risk");
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${tone}`}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
      {t("skillDetail.heroAuditPill", "Audit {{score}} · {{label}}", { score, label })}
    </span>
  );
}

export function SkillHeroStrip({
  skill,
  pullCount7d,
  versionAudit,
  isAuthenticated,
  isOwner,
  ownerDisplayName,
  ownerAvatarUrl,
  onTryPlayground,
  canTryWithCli,
  onCopyCliPrompt,
  onDownloadPackage,
  onEditSkill,
}: SkillHeroStripProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click + ESC.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const visibilityLabel = skill.isPrivate
    ? t("common.private", "Private")
    : t("common.public", "Public");
  const visibilityTone = skill.isPrivate
    ? "text-info border-info/40 bg-info-soft"
    : "text-info border-info/40 bg-info-soft";

  const tags = skill.tags ?? [];
  const tagsToShow = tags.slice(0, 4);
  const tagsExtra = tags.length > tagsToShow.length ? tags.length - tagsToShow.length : 0;

  return (
    <section
      className="rounded-md border border-subtle bg-card p-6 shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)] dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]"
      aria-labelledby="skill-hero-name"
    >
      <div className="grid gap-6 md:grid-cols-[auto_1fr_auto] md:items-start">
        {/* Icon */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-strong-edge bg-warning-soft text-accent"
          aria-hidden
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </div>

        {/* Body */}
        <div className="min-w-0">
          <h1
            id="skill-hero-name"
            className="font-display text-3xl font-semibold leading-tight text-strong tracking-tight"
          >
            {skill.name}
          </h1>
          {skill.description && (
            <p className="mt-2 max-w-[64ch] font-reading text-sm leading-relaxed text-body">
              {skill.description}
            </p>
          )}

          {/* Tag row */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] text-meta">
            {typeof skill.metadata?.category === "string" && skill.metadata.category && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong-edge bg-elevated px-2 py-0.5 text-strong tracking-widest uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {skill.metadata.category}
              </span>
            )}
            {tagsToShow.map((tag) => (
              <span key={tag} className="text-meta">
                #{tag}
              </span>
            ))}
            {tagsExtra > 0 && (
              <span className="text-meta">
                {t("skillDetail.heroTagsMore", "+{{n}} more", { n: tagsExtra })}
              </span>
            )}
          </div>

          {/* Status pill row */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${visibilityTone}`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {skill.isPrivate
                  ? <path d="M12 2a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V7a5 5 0 0 0-5-5z" />
                  : <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /></>}
              </svg>
              {visibilityLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong-edge px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-strong">
              v{skill.version}
            </span>
            <AuditPill audit={versionAudit} t={t as never} />
            {pullCount7d !== undefined && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong-edge px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-meta">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                {t("skillDetail.heroPulls7d", "{{n}} pulls · 7d", { n: pullCount7d })}
              </span>
            )}
          </div>

          {/* Owner row */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-meta">
            {ownerAvatarUrl ? (
              <img src={ownerAvatarUrl} alt="" className="h-[18px] w-[18px] rounded-full object-cover" />
            ) : (
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-page text-[10px] font-bold font-reading">
                {ownerDisplayName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-body">
              <strong className="font-medium">{ownerDisplayName}</strong>
            </span>
            <span className="opacity-50">·</span>
            <span>{t("skillDetail.heroPublishedOn", "Published {{date}}", { date: formatShortDate(skill.createdOn) })}</span>
            {skill.updatedOn && skill.updatedOn !== skill.createdOn && (
              <>
                <span className="opacity-50">·</span>
                <span>{t("skillDetail.heroUpdatedOn", "Updated {{date}}", { date: formatShortDate(skill.updatedOn) })}</span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        {(isAuthenticated || (skill.source && skill.source.type === "github")) && (
          <div className="flex shrink-0 items-center gap-2">
            {skill.source && skill.source.type === "github" && (
              <a
                href={buildGithubFolderUrl(skill.source)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={t("skillDetail.heroOpenOnGithub", "Open on GitHub") as string}
                title={t("skillDetail.heroOpenOnGithub", "Open on GitHub") as string}
                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-strong-edge text-body transition-colors hover:bg-elevated hover:text-strong hover:border-strong"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 .5a11.5 11.5 0 00-3.64 22.42c.58.11.79-.25.79-.56v-2.16c-3.21.7-3.89-1.37-3.89-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.76.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18.92-.26 1.92-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.85 1.19 3.11 0 4.45-2.7 5.42-5.28 5.71.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z" />
                </svg>
              </a>
            )}
            {isAuthenticated && (
              <>
            <button
              type="button"
              onClick={onTryPlayground}
              className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-page transition-all duration-150 hover:bg-accent-muted hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:shadow-[0_4px_16px_-8px_rgba(255,106,26,0.5)]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>
              {t("skillDetail.heroTryPlayground", "Try in Playground")}
            </button>

            <div className="relative">
              <button
                ref={triggerRef}
                type="button"
                aria-label={t("skillDetail.heroMoreActions", "More actions")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-strong-edge text-body transition-colors hover:bg-elevated hover:text-strong hover:border-strong"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="5" r="0.5" />
                  <circle cx="12" cy="12" r="0.5" />
                  <circle cx="12" cy="19" r="0.5" />
                </svg>
              </button>
              {menuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] z-20 min-w-[220px] rounded-sm border border-strong-edge bg-card p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]"
                >
                  {canTryWithCli && (
                    <DropdownItem onClick={() => { setMenuOpen(false); onCopyCliPrompt(); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                      {t("skillDetail.heroUseNyxCli", "Use Nyx CLI")}
                    </DropdownItem>
                  )}
                  {onDownloadPackage && (
                    <DropdownItem onClick={() => { setMenuOpen(false); onDownloadPackage(); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      {t("skillDetail.heroDownload", "Download package")}
                    </DropdownItem>
                  )}
                  {isOwner && onEditSkill && (
                    <DropdownItem onClick={() => { setMenuOpen(false); onEditSkill(); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      {t("skillDetail.heroEditSkill", "Edit skill")}
                    </DropdownItem>
                  )}
                </div>
              )}
            </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Build a deep link to the skill's source folder on GitHub. Prefers the
 * exact synced commit when available so the link is stable; falls back
 * to the originally-requested ref (or "HEAD") when the skill was linked
 * but never synced. Mirrors `GitHubOriginChip`'s logic.
 */
function buildGithubFolderUrl(source: NonNullable<SkillDetail["source"]>): string {
  const treeRef = source.lastSyncedCommit || source.ref || "HEAD";
  const pathSuffix = source.path ? `/${source.path.replace(/^\/+/, "")}` : "";
  return `https://github.com/${source.repo}/tree/${treeRef}${pathSuffix}`;
}

function DropdownItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left font-mono text-[11px] tracking-wider text-body transition-colors hover:bg-elevated hover:text-strong"
    >
      {children}
    </button>
  );
}
