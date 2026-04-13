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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      whileHover={hoverable ? { scale: 1.02, transition: { duration: 0.2 } } : undefined}
      onClick={onClick}
      className={`
        glass rounded-xl p-6
        ${hoverable ? "cursor-pointer glass-hover" : ""}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
