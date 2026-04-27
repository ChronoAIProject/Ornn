/**
 * Compact "Audit history" entry point on `SkillDetailPage`. The whole
 * card is one button that navigates to the dedicated history page where
 * details live; the trigger button sits elsewhere (Start Auditing under
 * Manage permissions).
 *
 * @module components/skill/AuditHistoryCard
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSkillAuditHistory } from "@/hooks/useAudit";

interface AuditHistoryCardProps {
  idOrName: string | undefined;
  className?: string;
}

export function AuditHistoryCard({ idOrName, className }: AuditHistoryCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: items, isLoading, isError } = useSkillAuditHistory(idOrName);

  if (!idOrName) return null;

  const count = items?.length ?? 0;
  const runningCount = items?.filter((r) => r.status === "running").length ?? 0;
  const disabled = isLoading || isError || count === 0;

  const handleClick = () => {
    if (disabled) return;
    navigate(`/skills/${encodeURIComponent(idOrName)}/audits`);
  };

  const secondaryLine = isLoading
    ? t("audit.historyLoading", "Loading audit history…")
    : isError
      ? t("audit.historyError", "Could not load audit history.")
      : count === 0
        ? t("audit.historyEmpty", "No audits recorded yet.")
        : runningCount > 0
          ? t(
              "audit.historyCountWithRunning",
              "{{n}} record(s) — {{r}} running",
              { n: count, r: runningCount },
            )
          : count === 1
            ? t("audit.versionOne", "1 audited version")
            : t("audit.versionMany", "{{n}} audited versions", { n: count });

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`glass flex w-full items-center justify-between gap-3 rounded-xl border border-neon-cyan/15 p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70 enabled:hover:border-neon-cyan/40 enabled:hover:bg-neon-cyan/5 enabled:cursor-pointer ${className ?? ""}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="font-heading text-sm uppercase tracking-wider text-text-primary">
          {t("audit.historyHeading", "Audit history")}
        </h3>
        <p
          className={`font-body text-xs ${
            isError ? "text-neon-red" : "text-text-muted"
          }`}
        >
          {secondaryLine}
        </p>
      </div>
      {!disabled && (
        <span className="flex items-center gap-1 font-mono text-xs text-neon-cyan shrink-0">
          {t("audit.viewHistory", "View history")}
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>
      )}
    </button>
  );
}
