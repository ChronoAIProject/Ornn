/**
 * Sidebar state hook, split out of Sidebar.tsx so the component file
 * only exports components — required for react-refresh / Fast Refresh
 * to preserve component state across edits (#888).
 *
 * @module components/layout/Sidebar.helpers
 */

import { useState, useEffect } from "react";

/**
 * Hook to manage sidebar state.
 * Persists collapsed state in localStorage.
 */
export function useSidebarState(defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const stored = localStorage.getItem("sidebar-collapsed");
    return stored ? JSON.parse(stored) : defaultCollapsed;
  });

  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  return {
    collapsed,
    setCollapsed,
    mobileOpen,
    setMobileOpen,
    openMobile: () => setMobileOpen(true),
    closeMobile: () => setMobileOpen(false),
    toggleMobile: () => setMobileOpen((prev) => !prev),
  };
}
