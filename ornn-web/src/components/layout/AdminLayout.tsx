/**
 * Admin Layout Component.
 * Layout wrapper for admin pages with sidebar navigation.
 * @module components/layout/AdminLayout
 */

import { Outlet, NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ToastContainer } from "@/components/ui/Toast";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: "/admin/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    path: "/admin/activities",
    label: "Activities",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    path: "/admin/users",
    label: "Users",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    path: "/admin/skills",
    label: "Skills",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    path: "/admin/system-skills",
    label: "System Skills",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
    ),
  },
  {
    path: "/admin/categories",
    label: "Categories",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    path: "/admin/tags",
    label: "Tags",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
];

function getBreadcrumbs(pathname: string): Array<{ label: string; path?: string }> {
  const breadcrumbs: Array<{ label: string; path?: string }> = [
    { label: "Admin", path: "/admin" },
  ];

  if (pathname.startsWith("/admin/dashboard")) {
    breadcrumbs.push({ label: "Dashboard" });
  } else if (pathname.startsWith("/admin/activities")) {
    breadcrumbs.push({ label: "Activities" });
  } else if (pathname.startsWith("/admin/users")) {
    breadcrumbs.push({ label: "Users" });
  } else if (pathname.startsWith("/admin/system-skills")) {
    breadcrumbs.push({ label: "System Skills" });
  } else if (pathname.startsWith("/admin/skills")) {
    breadcrumbs.push({ label: "Skills" });
  } else if (pathname.startsWith("/admin/categories")) {
    breadcrumbs.push({ label: "Categories" });
  } else if (pathname.startsWith("/admin/tags")) {
    breadcrumbs.push({ label: "Tags" });
  }

  return breadcrumbs;
}

export function AdminLayout() {
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  return (
    <div className="bg-grid min-h-screen bg-bg-deep">
      {/* Top Bar */}
      <header className="fixed top-0 z-40 w-full border-b border-neon-cyan/10 bg-bg-deep/80 backdrop-blur-md">
        <div className="flex h-28 items-center justify-between px-4 lg:px-8">
          {/* Logo / Back Link */}
          <NavLink to="/" className="flex items-center gap-3">
            <img src="/logo.svg?v=10" alt="ORNN" className="h-8 w-auto" />
            <span className="font-heading text-lg tracking-wider text-neon-magenta">
              Admin Panel
            </span>
          </NavLink>

          {/* Breadcrumbs */}
          <nav className="hidden items-center gap-2 sm:flex">
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb.label} className="flex items-center gap-2">
                {idx > 0 && <span className="text-text-muted">/</span>}
                {crumb.path && idx < breadcrumbs.length - 1 ? (
                  <NavLink
                    to={crumb.path}
                    className="font-body text-sm text-text-muted hover:text-neon-cyan transition-colors"
                  >
                    {crumb.label}
                  </NavLink>
                ) : (
                  <span className="font-body text-sm text-text-primary">
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>

          {/* Back to Main */}
          <NavLink
            to="/"
            className="flex items-center gap-2 font-body text-sm text-text-muted hover:text-neon-cyan transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Exit Admin
          </NavLink>
        </div>
      </header>

      <div className="flex pt-28">
        {/* Sidebar */}
        <aside className="fixed left-0 top-28 z-30 hidden h-[calc(100vh-7rem)] w-60 border-r border-neon-cyan/10 bg-bg-deep lg:block">
          <nav className="flex flex-col gap-1 p-4">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/admin"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-4 py-2.5 font-body text-sm transition-all duration-200 ${
                    isActive
                      ? "bg-neon-magenta/10 text-neon-magenta border border-neon-magenta/30 shadow-[0_0_10px_rgba(255,140,56,0.1)]"
                      : "text-text-muted hover:bg-bg-elevated hover:text-text-primary border border-transparent"
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Mobile Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-neon-cyan/10 bg-bg-deep/95 backdrop-blur-md lg:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/admin"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors ${
                  isActive
                    ? "text-neon-magenta"
                    : "text-text-muted hover:text-text-primary"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Main Content */}
        <main className="min-h-[calc(100vh-4rem)] flex-1 p-4 pb-20 lg:ml-60 lg:p-8 lg:pb-8">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <ToastContainer />
    </div>
  );
}
