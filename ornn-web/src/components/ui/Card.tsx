/**
 * Card — Editorial Forge primitive.
 *
 * Paper / forged-metal surface, hairline border, 4px radius. Default
 * padding `p-6`. Hover state strengthens edge and lifts 1px.
 *
 * @module components/ui/Card
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = "", hoverable = false, onClick }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      whileHover={hoverable ? { y: -1 } : undefined}
      onClick={onClick}
      className={`
        rounded-md border border-subtle bg-card p-6
        shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)]
        dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]
        transition-colors duration-150
        ${hoverable ? "cursor-pointer hover:border-strong-edge" : ""}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
