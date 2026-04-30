/**
 * Sidebar Component.
 * Collapsible sidebar navigation with neon cyberpunk styling.
 * Responsive: drawer on mobile, fixed sidebar on desktop.
 * @module components/layout/Sidebar
 */

import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useIsAuthenticated, useCurrentUser, isAdmin } from "@/stores/authStore";

export interface SidebarItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  authRequired?: boolean;
  adminOnly?: boolean;
  badge?: string | number;
}

export interface SidebarProps {
  items: SidebarItem[];
  /** Whether sidebar is collapsed (icons only) */
  collapsed?: boolean;
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Whether to show on mobile (as drawer) */
  mobileOpen?: boolean;
  /** Callback to close mobile drawer */
  onMobileClose?: () => void;
  className?: string;
}

/** Chevron left/right icon */
function ChevronIcon({ className, direction }: { className?: string; direction: "left" | "right" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d={direction === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"}
      />
    </svg>
  );
}

/** Close icon */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

const sidebarVariants = {
  expanded: { width: 240 },
  collapsed: { width: 72 },
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 },
};

const labelVariants = {
  visible: { opacity: 1, width: "auto" },
  hidden: { opacity: 0, width: 0 },
};

export function Sidebar({
  items,
  collapsed = false,
  onCollapsedChange,
  mobileOpen = false,
  onMobileClose,
  className = "",
}: SidebarProps) {
  const location = useLocation();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  // Filter items based on auth and admin status
  const visibleItems = items.filter((item) => {
    if (item.authRequired && !isAuthenticated) return false;
    if (item.adminOnly && !isAdmin(user)) return false;
    return true;
  });

  const isActive = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  const toggleCollapsed = () => {
    onCollapsedChange?.(!collapsed);
  };

  // Desktop Sidebar
  const SidebarContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className="flex h-full flex-col">
      {/* Header with collapse toggle */}
      {!isMobile && (
        <div className="flex h-14 items-center justify-end border-b border-accent/10 px-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-meta transition-colors hover:bg-accent/10 hover:text-accent cursor-pointer"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronIcon
              className="h-4 w-4"
              direction={collapsed ? "right" : "left"}
            />
          </button>
        </div>
      )}

      {/* Mobile header */}
      {isMobile && (
        <div className="flex h-14 items-center justify-between border-b border-accent/10 px-4">
          <span className="font-display text-sm uppercase tracking-wider text-accent">
            Navigation
          </span>
          <button
            type="button"
            onClick={onMobileClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-meta transition-colors hover:bg-accent/10 hover:text-accent cursor-pointer"
            aria-label="Close sidebar"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {visibleItems.map((item, index) => {
            const Icon = item.icon;
            const active = isActive(item.to);

            return (
              <motion.li
                key={item.to}
                variants={itemVariants}
                initial="hidden"
                animate="visible"
                transition={{ delay: index * 0.03 }}
              >
                <Link
                  to={item.to}
                  onClick={isMobile ? onMobileClose : undefined}
                  className={`
                    group relative flex items-center gap-3 rounded-lg px-3 py-2.5
                    font-text text-sm transition-all duration-200
                    ${collapsed && !isMobile ? "justify-center" : ""}
                    ${
                      active
                        ? "bg-accent/10 text-accent"
                        : "text-meta hover:bg-elevated hover:text-strong"
                    }
                  `}
                >
                  {/* Icon */}
                  <div className="relative shrink-0">
                    <Icon className="h-5 w-5" />
                    {active && (
                      <motion.div
                        layoutId={isMobile ? "sidebar-mobile-active" : "sidebar-active"}
                        className="absolute -left-3 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r bg-accent shadow-[0_0_8px_#FF6B00]"
                      />
                    )}
                  </div>

                  {/* Label (hidden when collapsed on desktop) */}
                  <AnimatePresence mode="wait">
                    {(!collapsed || isMobile) && (
                      <motion.span
                        variants={labelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        transition={{ duration: 0.15 }}
                        className="truncate whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>

                  {/* Badge */}
                  {item.badge && (!collapsed || isMobile) && (
                    <span className="ml-auto rounded-full bg-accent-support/20 px-2 py-0.5 text-xs font-semibold text-accent-support">
                      {item.badge}
                    </span>
                  )}

                  {/* Tooltip for collapsed state */}
                  {collapsed && !isMobile && (
                    <div className="absolute left-full ml-2 hidden rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-strong shadow-lg group-hover:block z-50 whitespace-nowrap">
                      {item.label}
                      {item.badge && (
                        <span className="ml-2 text-accent-support">({item.badge})</span>
                      )}
                    </div>
                  )}
                </Link>
              </motion.li>
            );
          })}
        </ul>
      </nav>

      {/* Footer / User info when collapsed */}
      {user && collapsed && !isMobile && (
        <div className="border-t border-accent/10 p-3">
          <div className="group relative flex justify-center">
            <div className="h-8 w-8 overflow-hidden rounded-full bg-elevated ring-2 ring-accent/20">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-display text-xs text-accent">
                    {user.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            {/* Tooltip */}
            <div className="absolute left-full ml-2 hidden rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-strong shadow-lg group-hover:block z-50 whitespace-nowrap">
              {user.displayName}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <motion.aside
        variants={sidebarVariants}
        initial={false}
        animate={collapsed ? "collapsed" : "expanded"}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`
          hidden lg:block fixed top-16 left-0 bottom-0 z-20
          border-r border-accent/10 bg-page/95 backdrop-blur-md
          ${className}
        `}
      >
        <SidebarContent />
      </motion.aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={onMobileClose}
            />

            {/* Drawer */}
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed top-0 left-0 bottom-0 z-40 w-72 glass border-r border-accent/10 lg:hidden"
            >
              <SidebarContent isMobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

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
