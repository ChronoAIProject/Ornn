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
          <label className="font-heading text-xs uppercase tracking-wider text-text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            neon-input rounded-lg px-4 py-2.5 font-body text-text-primary
            placeholder:text-text-muted/50
            ${error ? "border-b-neon-red!" : ""}
            ${className}
          `}
          {...props}
        />
        {error && <span className="text-xs text-neon-red">{error}</span>}
      </div>
    );
  }
);

Input.displayName = "Input";
