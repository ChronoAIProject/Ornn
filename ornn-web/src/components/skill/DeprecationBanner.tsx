import { useTranslation } from "react-i18next";

export interface DeprecationBannerProps {
  version: string;
  note: string | null | undefined;
  /** True when the currently-viewed version is an older one, not the latest. */
  hasNewerVersion: boolean;
  /** Label of the latest version, shown when offering to jump to it. */
  latestVersion?: string;
  onViewLatest?: () => void;
  className?: string;
}

/**
 * Warning banner rendered above the content area when the resolved version
 * is marked deprecated by the author. Uses forge-gold to read as a warning
 * without shouting "error".
 */
export function DeprecationBanner({
  version,
  note,
  hasNewerVersion,
  latestVersion,
  onViewLatest,
  className = "",
}: DeprecationBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={`
        glass flex flex-col gap-2 rounded border border-warning/40
        bg-warning/5 p-4
        ${className}
      `}
    >
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z"
          />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="font-display text-sm text-warning">
            {t("skillDetail.deprecationBannerTitle", { version })}
          </p>
          {note ? (
            <p className="mt-1 font-text text-sm text-strong/90">
              {t("skillDetail.deprecationBannerBody", { note })}
            </p>
          ) : (
            <p className="mt-1 font-text text-sm text-meta">
              {t("skillDetail.deprecationWarning")}
            </p>
          )}
        </div>
      </div>
      {hasNewerVersion && latestVersion && onViewLatest && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onViewLatest}
            className="
              font-text text-sm text-warning hover:text-warning/80
              underline underline-offset-2 transition-colors cursor-pointer
            "
          >
            {t("skillDetail.viewLatest", { version: latestVersion })}
          </button>
        </div>
      )}
    </div>
  );
}
