/**
 * Multi-Value Input Component.
 * Tag-style input that collects multiple string values with validation.
 * Used for runtime dependencies, env vars, context paths, and allowed tools.
 * @module components/form/MultiValueInput
 */

import { useState, useCallback } from "react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";

export interface MultiValueInputProps {
  /** Label displayed above the input */
  label: string;
  /** Current array of values */
  values: string[];
  /** Callback when values change */
  onChange: (values: string[]) => void;
  /** Input placeholder text */
  placeholder?: string;
  /** Helper text shown below the input */
  helperText?: string;
  /** Badge color for value chips */
  badgeColor?: BadgeProps["color"];
  /** Per-value validation function. Return null if valid, or an error message string. */
  validate?: (value: string) => string | null;
  /** Error message from form validation */
  error?: string;
  /** Maximum number of values */
  max?: number;
  /** Additional CSS classes */
  className?: string;
}

export function MultiValueInput({
  label,
  values,
  onChange,
  placeholder = "Type + Enter",
  helperText,
  badgeColor = "cyan",
  validate,
  error,
  max = 50,
  className = "",
}: MultiValueInputProps) {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const addValue = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      if (values.includes(trimmed)) {
        setInputError("Already added");
        return;
      }

      if (values.length >= max) {
        setInputError(`Maximum ${max} values`);
        return;
      }

      if (validate) {
        const validationError = validate(trimmed);
        if (validationError) {
          setInputError(validationError);
          return;
        }
      }

      setInputError(null);
      onChange([...values, trimmed]);
      setInput("");
    },
    [values, onChange, validate, max],
  );

  const removeValue = useCallback(
    (value: string) => {
      setInputError(null);
      onChange(values.filter((v) => v !== value));
    },
    [values, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addValue(input);
    }
    if (e.key === "Backspace" && !input && values.length > 0) {
      removeValue(values[values.length - 1]);
    }
  };

  const displayError = inputError ?? error;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="font-display text-xs uppercase tracking-wider text-meta">
        {label}
        {max < 50 && (
          <span className="ml-2 font-mono">
            ({values.length}/{max})
          </span>
        )}
      </label>

      <div className="neon-input flex flex-wrap gap-1.5 rounded-lg px-3 py-2">
        {values.map((value) => (
          <Badge key={value} color={badgeColor}>
            {value}
            <button
              type="button"
              onClick={() => removeValue(value)}
              className="ml-1 text-inherit opacity-60 hover:opacity-100"
            >
              x
            </button>
          </Badge>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setInputError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={values.length < max ? placeholder : "Max reached"}
          disabled={values.length >= max}
          className="min-w-[100px] flex-1 border-none bg-transparent font-text text-sm text-strong outline-none placeholder:text-meta/50"
        />
      </div>

      {helperText && !displayError && (
        <p className="text-xs text-meta/60 font-text">{helperText}</p>
      )}

      {displayError && (
        <span className="text-xs text-danger">{displayError}</span>
      )}
    </div>
  );
}
