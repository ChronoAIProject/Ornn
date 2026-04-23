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
      {/* Simple geometric icon */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-neon-cyan/20 bg-neon-cyan/5">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-neon-cyan/40">
          <path
            d="M16 2L4 8v16l12 6 12-6V8L16 2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M16 14v8M12 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="mb-2 font-heading text-lg text-text-primary">{title}</h3>
      {description && <p className="mb-6 max-w-md font-body text-sm text-text-muted">{description}</p>}
      {action}
    </div>
  );
}
