/**
 * ModelPicker — surface-scoped model dropdown.
 *
 * Reads the admin-curated picker list for the surface, renders a native
 * `<select>` styled per the Forge Workshop input vocabulary, and writes
 * the choice through `usePreferredModel` so the next visit lands on the
 * same model. When the admin has nothing enabled for the surface, the
 * picker degrades into an inline empty-state stamp instead.
 *
 * @module components/models/ModelPicker
 */

import { useEffect } from "react";
import { usePreferredModel } from "@/hooks/useModels";
import type { Surface } from "@/services/quotaApi";

interface ModelPickerProps {
  surface: Surface;
  /** Fired whenever the effective modelId changes (initial load + user pick). */
  onChange?: (modelId: string | null) => void;
  className?: string;
  label?: string;
}

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill Generation",
};

export function ModelPicker({
  surface,
  onChange,
  className = "",
  label = "Model",
}: ModelPickerProps) {
  const {
    options,
    effectiveModelId,
    setPreferred,
    isLoading,
    isEmpty,
  } = usePreferredModel(surface);

  // Keep parent in sync with the resolved model — initial load and any
  // upstream change (e.g. admin disables the user's pick) flow back here.
  useEffect(() => {
    onChange?.(effectiveModelId);
  }, [effectiveModelId, onChange]);

  if (isLoading) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-sm border border-subtle bg-elevated/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-meta ${className}`}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Loading models…
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        role="status"
        className={`inline-flex items-center gap-2 rounded-sm border border-warning/40 bg-warning-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning ${className}`}
      >
        {SURFACE_LABEL[surface]} — temporarily unavailable. Contact admin.
      </div>
    );
  }

  return (
    <label className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {label}
      </span>
      <select
        value={effectiveModelId ?? ""}
        onChange={(e) => {
          const next = e.target.value;
          if (next) setPreferred(next);
        }}
        className="appearance-none rounded-sm border border-subtle bg-elevated/40 px-2.5 py-1.5 pr-7 font-mono text-[11px] text-strong transition-colors duration-150 focus:border-accent focus:outline-none focus:bg-card cursor-pointer"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23C94A0E' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        {options.map((m) => (
          <option key={m.modelId} value={m.modelId} className="bg-card text-strong">
            {m.displayName}
            {m.isDefault ? " — default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
