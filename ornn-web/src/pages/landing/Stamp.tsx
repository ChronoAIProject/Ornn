import type { ReactNode } from "react";

/**
 * Mono micro-label with ember frame + tinted fill. Used for status stamps
 * like "NOW FORGING · v 0.9.3" on the landing hero.
 */
export function Stamp({
  children,
  dot = false,
  className = "",
}: {
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[2px] border border-[color:rgb(255_106_26/0.5)] bg-[color:rgb(255_106_26/0.06)] px-2.5 pt-[3px] pb-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ember ${className}`}
    >
      {dot ? (
        <span className="inline-block h-[5px] w-[5px] rounded-full bg-ember" />
      ) : null}
      {children}
    </span>
  );
}
