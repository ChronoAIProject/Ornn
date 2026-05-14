/**
 * ModelPicker — surface-scoped model dropdown, Forge-styled.
 *
 * Reads the admin-curated picker list for the surface, renders a custom
 * popover dropdown (no native `<select>` so the open menu can match the
 * rest of the Forge Workshop language — letterpress card-impression
 * shadow, hairline border, ember accents, JetBrains Mono), and writes
 * the choice through `usePreferredModel` so the next visit lands on
 * the same model. When the admin has nothing enabled for the surface,
 * the picker degrades into an inline empty-state stamp instead.
 *
 * @module components/models/ModelPicker
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePreferredModel } from "@/hooks/useModels";
import type { Surface } from "@/services/quotaApi";

interface ModelPickerProps {
  surface: Surface;
  /** Fired whenever the effective modelId changes (initial load + user pick). */
  onChange?: (modelId: string | null) => void;
  className?: string;
  /** Override the localized "Model" trigger label. */
  label?: string;
}

export function ModelPicker({
  surface,
  onChange,
  className = "",
  label,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t("modelPicker.label", "Model");
  const surfaceAriaLabel =
    surface === "playground"
      ? t("modelPicker.ariaPlayground", "Playground")
      : t("modelPicker.ariaSkillGen", "Skill Generation");
  const {
    options,
    effectiveModelId,
    setPreferred,
    isLoading,
    isEmpty,
  } = usePreferredModel(surface);

  const [open, setOpen] = useState(false);
  // "down" = menu opens below the trigger (default), "up" = above. Computed
  // once per open, before the menu renders, based on remaining viewport
  // space — keeps long lists fully visible when the trigger sits near the
  // bottom of the screen (playground composer bar).
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Match the menu's `max-h-[20rem]` (320px) so the placement decision lines
  // up with the rendered ceiling. If you change one, change the other.
  const MENU_MAX_HEIGHT_PX = 320;
  const handleToggleOpen = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // Flip up only when below is genuinely tight AND above has more room —
      // avoids surprising flips in normal page contexts.
      setPlacement(
        spaceBelow < MENU_MAX_HEIGHT_PX && spaceAbove > spaceBelow ? "up" : "down",
      );
    }
    setOpen(true);
  }, [open]);

  // Keep parent in sync with the resolved model — initial load and any
  // upstream change (e.g. admin disables the user's pick) flow back here.
  useEffect(() => {
    onChange?.(effectiveModelId);
  }, [effectiveModelId, onChange]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Keyboard support: ESC closes, ↑/↓/Enter navigate options.
  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    // Seed activeIndex to the currently-selected option for smooth nav.
    const selectedIdx = options.findIndex((o) => o.modelId === effectiveModelId);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt) {
          setPreferred(opt.modelId);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, options, effectiveModelId, activeIndex, setPreferred]);

  const handlePick = useCallback(
    (modelId: string) => {
      setPreferred(modelId);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [setPreferred],
  );

  if (isLoading) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-sm border border-subtle bg-elevated/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-meta ${className}`}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        {t("modelPicker.loading", "Loading models…")}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        role="status"
        className={`inline-flex items-center gap-2 rounded-sm border border-warning/40 bg-warning-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning ${className}`}
      >
        {t(
          "modelPicker.unavailable",
          "{{surface}} — temporarily unavailable. Contact admin.",
          { surface: surfaceAriaLabel },
        )}
      </div>
    );
  }

  const selected =
    options.find((o) => o.modelId === effectiveModelId) ?? options[0];

  return (
    <div className={`relative inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {resolvedLabel}
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("modelPicker.ariaTrigger", "{{label}}: {{selected}}", {
          label: resolvedLabel,
          selected: selected?.displayName ?? "—",
        })}
        className="
          inline-flex min-w-[12rem] items-center justify-between gap-2 rounded-sm
          border border-subtle bg-elevated/40 px-2.5 py-1.5
          font-mono text-[11px] text-strong
          transition-colors duration-150 cursor-pointer
          hover:border-accent/60 hover:bg-card
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
          data-[open=true]:border-accent data-[open=true]:bg-card
        "
        data-open={open}
      >
        <span className="truncate text-left">
          {selected?.displayName ?? "—"}
          {selected?.isDefault && (
            <span className="text-meta">
              {t("modelPicker.defaultSuffix", " — default")}
            </span>
          )}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 text-accent transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={t("modelPicker.ariaOptions", "{{label}} options", {
            label: resolvedLabel,
          })}
          className={`
            card-impression absolute right-0 z-30
            min-w-[16rem] max-h-[20rem] overflow-y-auto
            rounded-sm border border-subtle bg-card p-1
            ${placement === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}
          `}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.modelId === effectiveModelId;
            const isActive = idx === activeIndex;
            return (
              <button
                key={opt.modelId}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handlePick(opt.modelId)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`
                  flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5
                  text-left font-mono text-[11px] tracking-wide
                  transition-colors duration-100 cursor-pointer
                  ${isActive ? "bg-elevated text-strong" : "text-body hover:bg-elevated/70"}
                  ${isSelected ? "text-accent" : ""}
                `}
              >
                {/* Selection indicator — ember check at left */}
                <span className="inline-flex w-3 shrink-0 items-center justify-center">
                  {isSelected ? (
                    <svg
                      className="h-3 w-3 text-accent"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </span>
                <span className="flex-1 truncate">{opt.displayName}</span>
                {opt.isDefault && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-meta">
                    {t("modelPicker.defaultBadge", "default")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
