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

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="font-heading text-xs uppercase tracking-wider text-text-muted">
            {label}
          </label>
        )}
        <select
          ref={ref}
          className={`
            neon-input rounded-lg px-4 py-2.5 font-body text-text-primary
            appearance-none cursor-pointer
            bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%2300f0ff%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')]
            bg-[position:right_12px_center] bg-no-repeat
            ${error ? "border-b-neon-red!" : ""}
            ${className}
          `}
          {...props}
        >
          {placeholder && (
            <option value="" className="bg-bg-deep">
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-bg-deep">
              {opt.label}
            </option>
          ))}
        </select>
        {error && <span className="text-xs text-neon-red">{error}</span>}
      </div>
    );
  }
);

Select.displayName = "Select";
