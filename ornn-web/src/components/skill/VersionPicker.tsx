import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import type { SkillVersionEntry } from "@/types/domain";
import { formatVersionLabel } from "@/lib/versionLabel";

export interface VersionPickerProps {
  /** All available versions, already sorted newest-first. */
  versions: SkillVersionEntry[];
  /** Version currently shown on the page (may be latest or a specific pick). */
  currentVersion: string;
  /**
   * Fire when the user picks a different version. Passed `null` when the user
   * explicitly picks the latest (so the caller can drop the `?version=` URL
   * param).
   */
  onChange: (versionOrLatest: string | null) => void;
  className?: string;
}

/**
 * Custom dropdown for picking a published version of a skill.
 * Native `<select>` inherits OS chrome that clashes with the industrial-forge
 * aesthetic, so this is a headless popover styled with the site's tokens.
 */
export function VersionPicker({
  versions,
  currentVersion,
  onChange,
  className = "",
}: VersionPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const latestVersion = versions[0]?.version;
  const current = versions.find((v) => v.version === currentVersion);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (version: string) => {
    setOpen(false);
    onChange(version === latestVersion ? null : version);
  };

  const buttonLabel = current
    ? formatVersionLabel(current.version, {
        isLatest: current.version === latestVersion,
        isDeprecated: current.isDeprecated,
        latestText: t("skillDetail.latest"),
        deprecatedText: t("skillDetail.deprecated"),
      })
    : currentVersion;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <span className="font-heading text-[11px] uppercase tracking-wider text-meta mr-2">
        {t("skillDetail.version")}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`
          glass inline-flex items-center gap-2 rounded-lg
          border border-accent/20 bg-elevated
          px-3 py-1.5 font-body text-sm text-strong
          cursor-pointer transition-colors
          hover:border-accent/50
          focus:outline-none focus:border-accent/70
          ${open ? "border-accent/70" : ""}
        `}
      >
        <span className="truncate max-w-[16rem]">{buttonLabel}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-meta transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="
              absolute left-0 top-full mt-1 z-20 min-w-[14rem]
              glass rounded-lg border border-accent/30
              bg-card/95 backdrop-blur-md
              shadow-[0_4px_24px_rgba(0,0,0,0.3)]
              py-1 overflow-hidden
            "
          >
            {versions.map((v) => {
              const isCurrent = v.version === currentVersion;
              const label = formatVersionLabel(v.version, {
                isLatest: v.version === latestVersion,
                isDeprecated: v.isDeprecated,
                latestText: t("skillDetail.latest"),
                deprecatedText: t("skillDetail.deprecated"),
              });
              return (
                <li key={v.version} role="option" aria-selected={isCurrent}>
                  <button
                    type="button"
                    onClick={() => pick(v.version)}
                    className={`
                      flex w-full items-center gap-2 px-3 py-2
                      font-body text-sm text-left cursor-pointer transition-colors
                      ${
                        isCurrent
                          ? "bg-accent/10 text-accent"
                          : "text-strong hover:bg-elevated"
                      }
                    `}
                  >
                    <span className="w-4 text-center">
                      {isCurrent ? (
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="flex-1 truncate">{label}</span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
