/**
 * GenerationModeToggle — SIMPLE | ADVANCED segmented control for the
 * generative composer row (#1242).
 *
 * Shares the composer-chip vocabulary of ModelPicker / QuotaInline so
 * the three read as one instrument strip: JetBrains Mono micro-label,
 * `rounded-sm` hairline frame on `bg-elevated/40`, ember for the
 * selected segment only, explicit `focus-visible` ring. A
 * `role="radiogroup"` with two `role="radio"` buttons; Left / Right
 * arrows move the selection so it is keyboard-operable without a
 * pointer.
 *
 * Stateless — the parent owns the mode (persisted by
 * `usePreferredGenerationMode`) and locks the control while a
 * generation is streaming. Copy comes from `useGenerationModeCopy` so
 * the composer hint row renders the same strings.
 *
 * @module components/skill/generative/GenerationModeToggle
 */

import { useTranslation } from "react-i18next";
import { GENERATION_MODES, type GenerationMode } from "@/types/skillPackage";
import { useGenerationModeCopy } from "@/hooks/useGenerationMode";

export interface GenerationModeToggleProps {
  value: GenerationMode;
  onChange: (mode: GenerationMode) => void;
  /** Locks the control (e.g. while a generation is streaming). */
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function GenerationModeToggle({
  value,
  onChange,
  disabled = false,
  className = "",
}: GenerationModeToggleProps) {
  const { t } = useTranslation();
  const { labels, hints } = useGenerationModeCopy();

  const move = (delta: 1 | -1) => {
    const idx = GENERATION_MODES.indexOf(value);
    const next = GENERATION_MODES[(idx + delta + GENERATION_MODES.length) % GENERATION_MODES.length]!;
    if (next !== value) onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {t("generative.modeLabel", "Mode")}
      </span>
      <div
        role="radiogroup"
        aria-label={t("generative.modeAria", "Generation mode")}
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center gap-0.5 rounded-sm border border-subtle bg-elevated/40 p-0.5 ${
          disabled ? "cursor-not-allowed opacity-40" : ""
        }`}
      >
        {GENERATION_MODES.map((mode) => {
          const selected = mode === value;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${labels[mode]} — ${hints[mode]}`}
              title={hints[mode]}
              disabled={disabled}
              // Roving tabindex: only the selected segment is in the tab
              // order; arrows move within the group.
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (!selected) onChange(mode);
              }}
              className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed ${
                selected
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-transparent text-meta hover:text-strong"
              }`}
            >
              {labels[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
