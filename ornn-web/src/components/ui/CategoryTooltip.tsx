/**
 * Category Tooltip Component.
 * Info icon that shows a popover listing all four skill categories with descriptions.
 * @module components/ui/CategoryTooltip
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SKILL_CATEGORY_INFO, type SkillCategory } from "@/utils/constants";

export interface CategoryTooltipProps {
  className?: string;
}

/** Info circle icon */
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  plain: "text-accent",
  "tool-based": "text-accent-support",
  "runtime-based": "text-warning",
  mixed: "text-success",
};

export function CategoryTooltip({ className = "" }: CategoryTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onClick={() => setIsOpen((prev) => !prev)}
        className="p-1 text-meta hover:text-accent transition-colors cursor-pointer"
        aria-label="Category descriptions"
      >
        <InfoIcon className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-6 top-0 z-50 w-72 rounded-md border border-strong-edge bg-card p-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)]"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta mb-3">
              Skill Categories
            </p>
            <div className="space-y-3">
              {(Object.entries(SKILL_CATEGORY_INFO) as [SkillCategory, { label: string; description: string }][]).map(
                ([key, info]) => (
                  <div key={key}>
                    <p className={`font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${CATEGORY_COLORS[key]}`}>
                      {info.label}
                    </p>
                    <p className="font-reading text-xs leading-relaxed text-body mt-0.5">
                      {info.description}
                    </p>
                  </div>
                ),
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
