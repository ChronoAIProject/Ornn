/**
 * Admin Layout Component.
 * Layout wrapper for admin pages with sidebar navigation.
 * @module components/layout/AdminLayout
 */

import { Outlet, NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ToastContainer } from "@/components/ui/Toast";
import { Logo } from "@/components/brand/Logo";
import { QuotaChip } from "@/components/quota/QuotaChip";

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
    path: "/admin/models",
    label: "Models",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17 9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" />
      </svg>
    ),
  },
  {
    path: "/admin/quota",
    label: "Quota",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3v18h18M7 14l4-4 4 4 5-5" />
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
  {
    path: "/admin/settings",
    label: "Settings",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    path: "/admin/mirror",
    label: "GitHub Mirror",
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 .5a11.5 11.5 0 00-3.64 22.42c.58.11.79-.25.79-.56v-2.16c-3.21.7-3.89-1.37-3.89-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.76.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18.92-.26 1.92-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.85 1.19 3.11 0 4.45-2.7 5.42-5.28 5.71.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z" />
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
  } else if (pathname.startsWith("/admin/skills")) {
    breadcrumbs.push({ label: "Skills" });
  } else if (pathname.startsWith("/admin/models")) {
    breadcrumbs.push({ label: "Models" });
  } else if (pathname.startsWith("/admin/quota")) {
    breadcrumbs.push({ label: "Quota" });
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
    <div className="bg-grid min-h-screen bg-page">
      {/* Top Bar */}
      <header className="fixed top-0 z-40 w-full border-b border-subtle bg-page/95 backdrop-blur-md">
        <div className="flex h-[60px] items-center justify-between px-4 lg:px-8">
          {/* Logo / Back Link */}
          <NavLink to="/" className="flex items-center gap-3">
            <Logo className="h-[26px] w-auto" />
            <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-accent">
              Admin
            </span>
          </NavLink>

          {/* Breadcrumbs */}
          <nav className="hidden items-center gap-2 sm:flex">
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb.label} className="flex items-center gap-2">
                {idx > 0 && <span className="text-meta">/</span>}
                {crumb.path && idx < breadcrumbs.length - 1 ? (
                  <NavLink
                    to={crumb.path}
                    className="font-text text-sm text-meta hover:text-accent transition-colors"
                  >
                    {crumb.label}
                  </NavLink>
                ) : (
                  <span className="font-text text-sm text-strong">
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>

          {/* Right cluster: quota chip + back to main */}
          <div className="flex items-center gap-3">
            <QuotaChip className="hidden md:inline-flex" />
            <NavLink
              to="/"
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent"
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
        </div>
      </header>

      <div className="flex pt-[60px]">
        {/* Sidebar */}
        <aside className="fixed left-0 top-[60px] z-30 hidden h-[calc(100vh-60px)] w-60 border-r border-subtle bg-page lg:block">
          <nav className="flex flex-col gap-1 p-4">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/admin"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-sm px-4 py-2.5 font-text text-sm transition-colors duration-150 ${
                    isActive
                      ? "border border-accent/30 bg-accent/10 text-accent"
                      : "border border-transparent text-meta hover:bg-elevated hover:text-strong"
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
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-subtle bg-page/95 backdrop-blur-md lg:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/admin"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                  isActive
                    ? "text-accent"
                    : "text-meta hover:text-strong"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Main Content */}
        <main className="min-h-[calc(100vh-60px)] flex-1 p-4 pb-20 lg:ml-60 lg:p-8 lg:pb-8">
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
