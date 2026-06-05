/**
 * `useToast` hook, split out of Toast.tsx so the component file only
 * exports components — required for react-refresh / Fast Refresh (#888).
 *
 * @module components/ui/Toast.helpers
 */

import { useToastStore, type Toast as ToastType } from "@/stores/toastStore";

export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  // exactOptionalPropertyTypes (#657): conditional spread on duration
  // so we don't pass `{ duration: undefined }` to a contract that wants
  // `duration?: number`.
  return {
    success: (message: string, duration?: number) =>
      addToast({ type: "success", message, ...(duration !== undefined ? { duration } : {}) }),
    error: (message: string, duration?: number) =>
      addToast({ type: "error", message, ...(duration !== undefined ? { duration } : {}) }),
    warning: (message: string, duration?: number) =>
      addToast({ type: "warning", message, ...(duration !== undefined ? { duration } : {}) }),
    info: (message: string, duration?: number) =>
      addToast({ type: "info", message, ...(duration !== undefined ? { duration } : {}) }),
    custom: (type: ToastType["type"], message: string, duration?: number) =>
      addToast({ type, message, ...(duration !== undefined ? { duration } : {}) }),
  };
}
