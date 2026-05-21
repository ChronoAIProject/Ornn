/**
 * Left collapsible sidebar for DocsPage (#453).
 *
 * Renders the doc tree (sections → children), auto-expands the
 * section containing the active doc, and re-collapses on user click.
 * Pure presentation — the parent owns the active doc + emits the
 * select callback.
 *
 * @module components/docs/DocsSidebar
 */

import { useEffect, useState } from "react";
import type { DocSection } from "@/lib/docsContent";

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className ?? "h-4 w-4"} transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export interface DocsSidebarProps {
  sections: DocSection[];
  activeId: string;
  onSelect: (id: string, label: string) => void;
}

export function DocsSidebar({ sections, activeId, onSelect }: DocsSidebarProps) {
  // Initialize: expand the section that contains the active doc
  const activeSectionId = sections.find((s) =>
    s.children.some((c) => c.id === activeId),
  )?.id;

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (activeSectionId) initial.add(activeSectionId);
    return initial;
  });

  // When active doc changes, ensure its section is expanded
  useEffect(() => {
    if (activeSectionId && !expanded.has(activeSectionId)) {
      setExpanded((prev) => new Set(prev).add(activeSectionId));
    }
  }, [activeSectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (sectionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  return (
    <nav className="w-64 shrink-0 border-r border-accent/10 overflow-y-auto py-4 pr-2">
      {sections.map((section) => {
        const isExpanded = expanded.has(section.id);
        return (
          <div key={section.id} className="mb-2">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer group text-left"
            >
              <ChevronIcon
                open={isExpanded}
                className="h-4 w-4 shrink-0 text-meta group-hover:text-strong transition-colors"
              />
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta group-hover:text-strong transition-colors">
                {section.label}
              </span>
            </button>
            {isExpanded && (
              <div className="ml-2">
                {section.children.map((child) => {
                  const isActive = child.id === activeId;
                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => onSelect(child.id, child.label)}
                      className={`
                        w-full text-left px-3 py-2 rounded-md font-text text-base transition-all duration-150 cursor-pointer
                        ${isActive
                          ? "text-accent bg-accent/10 border-l-2 border-accent"
                          : "text-meta hover:text-strong hover:bg-elevated border-l-2 border-transparent"
                        }
                      `}
                    >
                      {child.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
