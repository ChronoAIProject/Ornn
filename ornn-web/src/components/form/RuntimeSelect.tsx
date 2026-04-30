/**
 * Runtime Select Component.
 * Multi-select for runtime environments with checkbox list and chip display.
 * @module components/form/RuntimeSelect
 */

import { useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { AVAILABLE_RUNTIMES, RUNTIME_INFO } from "@/utils/constants";

export interface RuntimeSelectProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  error?: string;
  className?: string;
}

export function RuntimeSelect({
  selected,
  onChange,
  error,
  className = "",
}: RuntimeSelectProps) {
  const toggleRuntime = useCallback(
    (runtime: string) => {
      if (selected.includes(runtime)) {
        onChange(selected.filter((r) => r !== runtime));
      } else {
        onChange([...selected, runtime]);
      }
    },
    [selected, onChange],
  );

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="font-display text-xs uppercase tracking-wider text-meta">
        Runtime Environments
      </label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((runtime) => (
            <Badge key={runtime} color="yellow">
              {RUNTIME_INFO[runtime as keyof typeof RUNTIME_INFO]?.label ?? runtime}
              <button
                type="button"
                onClick={() => toggleRuntime(runtime)}
                className="ml-1 text-inherit opacity-60 hover:opacity-100"
              >
                x
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Checkbox list */}
      <div className="neon-input rounded-lg p-3 space-y-2">
        {AVAILABLE_RUNTIMES.map((runtime) => {
          const isChecked = selected.includes(runtime);
          const info = RUNTIME_INFO[runtime];
          return (
            <label
              key={runtime}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggleRuntime(runtime)}
                className="h-4 w-4 rounded border-text-muted/30 bg-page text-accent accent-accent cursor-pointer"
              />
              <span
                className={`font-text text-sm transition-colors ${
                  isChecked
                    ? "text-warning"
                    : "text-meta group-hover:text-strong"
                }`}
              >
                {info.label}
              </span>
            </label>
          );
        })}
      </div>

      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
