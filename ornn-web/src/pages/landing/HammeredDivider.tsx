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
 * Section break with a callout number, mono label, and architectural rules.
 * Use between major sections to add workshop-document feel.
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
      <span className="h-px flex-1 bg-[color:var(--color-border-subtle)]" />
      <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-meta">
        {label}
      </span>
      <span className="h-px w-12 bg-ember" />
    </div>
  );
}
