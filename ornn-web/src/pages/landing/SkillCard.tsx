import { Link } from "react-router-dom";
import type { FeaturedSkill } from "./skillsData";

export function SkillCard({ skill }: { skill: FeaturedSkill }) {
  return (
    <Link
      to={`/skills/${skill.slug}`}
      className="group/card flex min-h-[260px] flex-col border border-[color:var(--color-border-subtle)] bg-graphite px-6 pb-6 pt-7 no-underline text-inherit transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-ember hover:shadow-[0_12px_40px_-16px_rgb(255_106_26/0.3)]"
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
      <div className="mt-3 rounded-[2px] border border-[color:var(--color-border-subtle)] bg-obsidian px-2.5 py-2 font-mono text-[11px] text-parchment before:text-ember before:content-['$_']">
        {skill.install}
      </div>
      <div className="mt-4 flex justify-between border-t border-dashed border-[color:var(--color-border-strong)] pt-3.5 font-mono text-[11px] text-meta">
        <span>
          {skill.author} · {skill.version}
        </span>
        <span>{skill.date}</span>
      </div>
    </Link>
  );
}
