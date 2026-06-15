/**
 * SkillsetClosureViewer — renders a resolved skillset closure as a FLAT,
 * depth-indented list.
 *
 * The server PRE-FLATTENS the dependency graph (deps-first topo-sorted) and
 * stamps each node with a BFS-style `depth` (0 = direct member, deeper =
 * transitive dependency). We render that flat list and indent by depth — no
 * client-side tree reconstruction. A depth-0 row reads as a direct member; a
 * depth-1+ row reads as a pulled-in dependency.
 *
 * @module components/skillset/SkillsetClosureViewer
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { SkillsetClosureItem } from "@/types/skillset";

export interface SkillsetClosureViewerProps {
  items: SkillsetClosureItem[];
  className?: string | undefined;
}

/** px of indent per depth level. */
const INDENT_PER_DEPTH = 20;

export function SkillsetClosureViewer({ items, className = "" }: SkillsetClosureViewerProps) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return (
      <p className={`font-text text-sm text-meta italic ${className}`}>
        {t("skillsetClosure.empty", "No resolved members yet.")}
      </p>
    );
  }

  return (
    <ul className={`space-y-1 ${className}`} data-testid="closure-list">
      {items.map((item) => (
        <li
          key={`${item.ref}:${item.depth}`}
          data-depth={item.depth}
          className="flex items-center gap-2 rounded-sm border border-subtle bg-elevated/40 px-3 py-2"
          style={{ marginLeft: `${item.depth * INDENT_PER_DEPTH}px` }}
        >
          {/* Depth marker — direct member vs. pulled-in dependency. */}
          <span
            className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
              item.depth === 0
                ? "border border-accent/40 bg-accent/10 text-accent"
                : "border border-subtle bg-elevated text-meta"
            }`}
          >
            {item.depth === 0
              ? t("skillsetClosure.member", "member")
              : t("skillsetClosure.dependency", "dep")}
          </span>
          <Link
            to={`/skills/${encodeURIComponent(item.name)}?version=${item.version}`}
            className="min-w-0 truncate font-mono text-xs text-strong hover:underline hover:text-accent"
          >
            {item.name}
          </Link>
          <span className="shrink-0 font-mono text-xs text-meta">v{item.version}</span>
        </li>
      ))}
    </ul>
  );
}
