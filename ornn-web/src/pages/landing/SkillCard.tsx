import { Link } from "react-router-dom";
import type { FeaturedSkill } from "./skillsData";

export function SkillCard({ skill }: { skill: FeaturedSkill }) {
  return (
    <Link
      to={`/skills/${skill.slug}`}
      className="card-letterpress group/card flex min-h-[260px] flex-col border border-[color:var(--color-border-subtle)] bg-graphite px-6 pb-6 pt-7 no-underline text-inherit hover:border-ember"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
        ⟶ {skill.tag}
      </div>
      <div className="my-3 font-display text-[28px] font-light leading-[1.05] tracking-[-0.018em] text-parchment">
        {skill.name}
      </div>
      <div className="flex-grow text-[13px] leading-[1.55] text-bone">
        {skill.desc}
      </div>
      {skill.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {skill.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-[2px] border border-[color:var(--color-border-subtle)] bg-obsidian px-2 py-1 font-mono text-[10px] tracking-[0.04em] text-bone"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-between border-t border-dashed border-[color:var(--color-border-strong)] pt-3.5 font-mono text-[11px] text-meta">
        <span>
          {skill.author} · {skill.version}
        </span>
        <span>{skill.date}</span>
      </div>
    </Link>
  );
}
