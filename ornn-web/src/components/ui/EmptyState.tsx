import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-sm border border-strong-edge bg-warning-soft text-accent/60">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <path
            d="M16 2L4 8v16l12 6 12-6V8L16 2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M16 14v8M12 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="mb-2 font-display text-xl font-semibold tracking-tight text-strong">{title}</h3>
      {description && <p className="mb-6 max-w-md font-text text-sm text-body">{description}</p>}
      {action}
    </div>
  );
}
