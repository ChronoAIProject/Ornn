/**
 * Input — Editorial Forge form primitive.
 *
 * Drafted, instrument-like. Hairline edge, focus tightens to ember.
 *
 * @module components/ui/Input
 */

import { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2
            font-reading text-sm text-strong
            placeholder:text-meta/70
            transition-colors duration-150
            focus:border-accent focus:outline-none focus:bg-card
            ${error ? "border-danger! focus:border-danger!" : ""}
            ${className}
          `}
          {...props}
        />
        {error && (
          <span className="font-mono text-[11px] text-danger">{error}</span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
