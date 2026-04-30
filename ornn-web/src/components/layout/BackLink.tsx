/**
 * Shared back-link widget for the top-left of sub-pages. Defaults to
 * history.back() (so "from where you came, back you go"), with an
 * explicit `to` escape hatch for pages that want a fixed parent.
 *
 * @module components/layout/BackLink
 */

import { useNavigate } from "react-router-dom";

interface BackLinkProps {
  /** Text after the arrow. Already-translated. */
  label: string;
  /**
   * Fixed fallback path. When omitted, clicking triggers `history.back()`.
   * When provided, the link hard-navigates to that path regardless of
   * history (useful when the parent context must be deterministic).
   */
  to?: string;
  className?: string;
}

export function BackLink({ label, to, className = "" }: BackLinkProps) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      className={`inline-flex items-center gap-1 font-text text-xs text-meta transition-colors hover:text-accent cursor-pointer ${className}`}
    >
      <span aria-hidden>←</span>
      <span>{label}</span>
    </button>
  );
}
