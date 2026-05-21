/**
 * Sticky right-rail "On this page" minimap for DocsPage (#453).
 *
 * Skips h1 (the doc title is already in the heading area above the
 * article) and renders h2-h4 as indented links. The parent owns the
 * `activeHeadingId` (scroll-spy lives in DocsPage); this component
 * just paints + fires `onSelect` for clicks.
 *
 * @module components/docs/DocsTableOfContents
 */

import { useTranslation } from "react-i18next";

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

export interface DocsTableOfContentsProps {
  items: TocItem[];
  activeHeadingId: string;
  onSelect: (id: string) => void;
}

export function DocsTableOfContents({
  items,
  activeHeadingId,
  onSelect,
}: DocsTableOfContentsProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  // Skip the h1 (doc title) — show only h2+ in TOC
  const tocItems = items.filter((item) => item.level >= 2);
  if (tocItems.length === 0) return null;

  return (
    <nav className="w-56 shrink-0 sticky top-0 self-start overflow-y-auto max-h-[calc(100vh-8rem)] py-4 pl-4">
      <h4 className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta px-2 py-1.5 mb-2">
        {t("docs.onThisPage")}
      </h4>
      <div className="space-y-0.5 border-l border-accent/10">
        {tocItems.map((item) => {
          const isActive = item.id === activeHeadingId;
          const indent = item.level === 2 ? "pl-3" : item.level === 3 ? "pl-6" : "pl-9";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`
                w-full text-left py-1.5 ${indent} font-text text-base leading-snug transition-colors duration-150 cursor-pointer truncate
                ${isActive
                  ? "text-accent border-l-2 border-accent -ml-px"
                  : "text-meta hover:text-strong"
                }
              `}
              title={item.text}
            >
              {item.text}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
