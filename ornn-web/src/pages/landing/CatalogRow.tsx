import { Link } from "react-router-dom";
import type { CatalogSkill } from "./skillsData";

export function CatalogRow({
  skill,
  isLast = false,
}: {
  skill: CatalogSkill;
  isLast?: boolean;
}) {
  return (
    <Link
      to={`/skills/${skill.name}`}
      className={`focus-ring-ember group/row block py-5 no-underline text-parchment transition-colors duration-200 hover:bg-[rgb(255_106_26/0.04)] md:grid md:grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1fr)_120px] md:items-baseline md:gap-5 ${
        isLast ? "" : "border-b border-[color:var(--color-border-subtle)]"
      }`}
    >
      {/* Mobile-only header row (num + date), so the name has full width below */}
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] tabular-nums text-meta md:hidden">
        <span>{skill.num}</span>
        <span>{skill.date}</span>
      </div>
      <div className="hidden font-mono text-[11px] tabular-nums text-meta md:block">
        {skill.num}
      </div>
      <div className="min-w-0">
        <span className="block break-words font-display text-[22px] font-light leading-tight tracking-[-0.015em] transition-colors duration-200 group-hover/row:text-ember sm:text-[26px]">
          {skill.name}
        </span>
        <div className="mt-1 font-mono text-xs text-meta">{skill.tags}</div>
      </div>
      <div className="mt-2 text-[13px] leading-snug text-bone md:mt-0">
        {skill.purpose}
      </div>
      <div className="hidden text-right font-mono text-[11px] text-meta md:block">
        {skill.date}
      </div>
    </Link>
  );
}
