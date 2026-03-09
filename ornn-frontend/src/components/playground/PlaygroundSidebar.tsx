/**
 * Playground Sidebar Component.
 * Container for Credential panel.
 * LLM config removed - users manage credentials in NyxID.
 * Responsive: side panel on desktop, overlay drawer on mobile.
 * @module components/playground/PlaygroundSidebar
 */

import { motion, AnimatePresence } from "framer-motion";
import { CredentialPanel } from "./CredentialPanel";

export interface PlaygroundSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function PlaygroundSidebar({ open, onClose }: PlaygroundSidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-16 bottom-0 z-30 w-80 overflow-y-auto border-l border-neon-cyan/10 glass lg:static lg:z-auto lg:block"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neon-cyan/10 px-4 py-3">
              <h2 className="font-heading text-sm uppercase tracking-wider text-text-primary">
                Credentials
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:text-text-primary lg:hidden"
                aria-label="Close sidebar"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              <CredentialPanel />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
