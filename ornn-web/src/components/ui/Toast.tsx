/**
 * Toast — Editorial Forge notification primitive.
 *
 * Card surface with a left accent bar (mineral state colors), Inter
 * body, mono dismiss icon. Slide-in from the right, auto-dismiss
 * progress bar at the bottom.
 *
 * @module components/ui/Toast
 */

import { motion, AnimatePresence } from "framer-motion";
import { useToastStore, type Toast as ToastType } from "@/stores/toastStore";

const ACCENT_STYLES = {
  success: { bar: "bg-success", icon: "text-success" },
  error: { bar: "bg-danger", icon: "text-danger" },
  warning: { bar: "bg-warning", icon: "text-warning" },
  info: { bar: "bg-accent", icon: "text-accent" },
} as const;

function SuccessIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

const ICONS = {
  success: SuccessIcon,
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
} as const;

export interface ToastItemProps {
  toast: ToastType;
}

function ToastItem({ toast }: ToastItemProps) {
  const removeToast = useToastStore((s) => s.removeToast);
  const styles = ACCENT_STYLES[toast.type];
  const Icon = ICONS[toast.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="card-impression overflow-hidden rounded border border-strong-edge bg-card"
    >
      <div className="flex">
        <div className={`w-1 shrink-0 ${styles.bar}`} />
        <div className="flex flex-1 items-start gap-3 px-4 py-3">
          <div className={`shrink-0 mt-0.5 ${styles.icon}`}>
            <Icon className="h-5 w-5" />
          </div>
          <p className="flex-1 font-text text-sm leading-relaxed text-strong">
            {toast.message}
          </p>
          <button
            onClick={() => removeToast(toast.id)}
            className="-mt-1 -mr-1 shrink-0 cursor-pointer rounded-sm p-1 text-meta transition-colors hover:bg-elevated hover:text-strong"
            aria-label="Dismiss notification"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {toast.duration && toast.duration > 0 && (
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: toast.duration / 1000, ease: "linear" }}
          className={`h-0.5 origin-left ${styles.bar} opacity-50`}
        />
      )}
    </motion.div>
  );
}

export interface ToastContainerProps {
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  maxToasts?: number;
  className?: string;
}

const POSITION_STYLES = {
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "top-center": "top-4 left-1/2 -translate-x-1/2",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
} as const;

export function ToastContainer({
  position = "bottom-right",
  maxToasts = 5,
  className = "",
}: ToastContainerProps) {
  const toasts = useToastStore((s) => s.toasts);
  const visibleToasts = toasts.slice(-maxToasts);

  return (
    <div
      className={`pointer-events-none fixed z-50 flex flex-col gap-3 ${POSITION_STYLES[position]} ${className}`}
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence mode="popLayout">
        {visibleToasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-80 sm:w-96">
            <ToastItem toast={toast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  return {
    success: (message: string, duration?: number) =>
      addToast({ type: "success", message, duration }),
    error: (message: string, duration?: number) =>
      addToast({ type: "error", message, duration }),
    warning: (message: string, duration?: number) =>
      addToast({ type: "warning", message, duration }),
    info: (message: string, duration?: number) =>
      addToast({ type: "info", message, duration }),
    custom: (type: ToastType["type"], message: string, duration?: number) =>
      addToast({ type, message, duration }),
  };
}
