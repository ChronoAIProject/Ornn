/**
 * Card — Forge Workshop primitive.
 *
 * Paper / forged-metal surface with a hairline border and a hard-offset
 * letterpress impression at rest. Hoverable cards press DOWN on hover
 * (translate +2px / +2px, shadow shrinks) per DESIGN.md — never lift.
 * Static cards carry the rest impression only.
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
  const impressionClass = hoverable
    ? "card-letterpress cursor-pointer hover:border-strong-edge"
    : "card-impression";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={`
        ${impressionClass}
        rounded border border-subtle bg-card p-6
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
