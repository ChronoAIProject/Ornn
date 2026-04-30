/**
 * Horizontal hairline with a centered ✦ glyph sitting on the page background —
 * the section divider used between "Featured" and "Also on the registry".
 */
export function HammeredDivider({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative h-px bg-[linear-gradient(90deg,transparent,var(--color-border-strong)_20%,var(--color-border-strong)_80%,transparent)] before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:bg-page before:px-3.5 before:text-[11px] before:text-ember before:content-['✦'] ${className}`}
    />
  );
}

/**
 * Section break with a callout number, mono label, welded-seam hairline
 * with rivet dots, and ember + arc accent bars.
 *
 * Forge Workshop pattern (DESIGN.md → Material & Print Vocabulary →
 * Welded-seam section dividers): a thin pure rule reads as generic
 * SaaS divider; the rivet dots at 25%/75% plus the bi-tonal accent
 * (56px ember at the start, 28px arc at the end) plant industrial-
 * publication identity.
 */
export function SectionRule({
  num,
  label,
  className = "",
}: {
  num: string;
  label: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`mx-auto flex max-w-[1280px] items-center gap-4 px-6 py-6 sm:px-8 ${className}`}
    >
      <span className="font-mono text-[10px] tabular-nums text-meta tracking-[0.18em]">
        {num}
      </span>
      {/* Welded-seam hairline with two rivet dots at 25% / 75% */}
      <span className="relative h-px flex-1 bg-[color:var(--color-border-subtle)]">
        <span className="pointer-events-none absolute left-1/4 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-stronger)]" />
        <span className="pointer-events-none absolute left-3/4 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-stronger)]" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-meta">
        {label}
      </span>
      {/* Bi-tonal accent: 56px ember + 28px arc — primary heat then secondary
          arc-blue, matches v3 standalone's welded-seam closing seam. */}
      <span className="h-px w-14 bg-ember" />
      <span className="h-px w-7 bg-[color:var(--color-arc)]" />
    </div>
  );
}
