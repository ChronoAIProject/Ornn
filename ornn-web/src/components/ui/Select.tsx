/**
 * Select — Editorial Forge form primitive.
 *
 * Mirrors Input styling. Custom chevron icon in ember, no native arrow.
 *
 * @module components/ui/Select
 */

import { forwardRef } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

// Inline ember chevron — strokes the var(--color-accent) at runtime.
const CHEVRON_BG =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%2712%27%20height%3D%2712%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27%23C94A0E%27%20stroke-width%3D%272.5%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpolyline%20points%3D%276%209%2012%2015%2018%209%27%2F%3E%3C%2Fsvg%3E\")";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
            {label}
          </label>
        )}
        <select
          ref={ref}
          style={{ backgroundImage: CHEVRON_BG }}
          className={`
            w-full appearance-none cursor-pointer rounded-sm
            border border-subtle bg-elevated/40 px-3 py-2 pr-9
            font-text text-sm text-strong
            transition-colors duration-150
            focus:border-accent focus:outline-none focus:bg-card
            bg-no-repeat
            [background-position:right_10px_center]
            ${error ? "border-danger! focus:border-danger!" : ""}
            ${className}
          `}
          {...props}
        >
          {placeholder && (
            <option value="" className="bg-card text-strong">
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-card text-strong">
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <span className="font-mono text-[11px] text-danger">{error}</span>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
