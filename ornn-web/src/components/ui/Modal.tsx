/**
 * Modal — Forge Workshop primitive.
 *
 * Backdrop fades in, dialog springs in. Surface is paper / forged metal
 * with a hairline border. Title uses Space Grotesk (display).
 *
 * @module components/ui/Modal
 */

import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, children, className = "" }: ModalProps) {
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.9 }}
            className={`
              relative z-10 mx-4 w-full max-w-lg max-h-[80vh] overflow-y-auto
              rounded-md border border-strong-edge bg-card p-6
              shadow-[0_24px_48px_-16px_rgba(0,0,0,0.35)]
              ${className}
            `}
          >
            {title && (
              <h2 className="mb-4 font-display text-xl font-semibold tracking-tight text-strong">
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
