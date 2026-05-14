/**
 * Admin Layout Component.
 *
 * Thin sidebar wrapper for admin pages — nested inside RootLayout so
 * the regular Navbar + breadcrumb chrome (theme switcher, language
 * switcher, user menu, QuotaChip) renders on every admin route just
 * like any other authenticated page.
 *
 * Provides only the admin-specific navigation (sidebar on desktop,
 * bottom strip on mobile). The 7 NAV_ITEMS are the admin top-level
 * surfaces; sub-pages (e.g. /admin/settings/*) drive their own
 * secondary navigation inside their page components.
 *
 * @module components/layout/AdminLayout
 */

import { Outlet, NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface NavItem {
  path: string;
  /** Either a literal label or an i18n key resolved at render time. */
  label: string;
  /** When true, `label` is treated as an i18n key. */
  i18nLabel?: boolean;
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
    path: "/admin/users",
    label: "Users",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
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
    path: "/admin/redemption-codes",
    label: "Redemption codes",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5l-3 3m0 0l-3-3m3 3V3m6 14a3 3 0 11-6 0 3 3 0 016 0zM9 7a2 2 0 11-4 0 2 2 0 014 0z" />
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
    path: "/admin/announcements",
    label: "Announcements",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.586l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
  },
  {
    path: "/admin/broadcasts",
    label: "nav.admin.broadcasts",
    i18nLabel: true,
    icon: (
      // lucide-react `Bell` icon path, inlined to match the other nav
      // entries' bare-SVG style and avoid a new dep just for this row.
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
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
];

export function AdminLayout() {
  const location = useLocation();
  const { t } = useTranslation();

  const renderLabel = (item: NavItem): string =>
    item.i18nLabel ? t(item.label) : item.label;

  return (
    <div className="flex h-full min-h-0 gap-6 py-4">
      {/* Desktop sidebar — admin-only navigation. Lives inside
          RootLayout's max-w-[1280px] container; main app navigation
          is handled by the parent Navbar. */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="flex flex-col gap-1">
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
              {renderLabel(item)}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile bottom nav — stays fixed to viewport so admin nav is
          always reachable on small screens. */}
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
            {renderLabel(item)}
          </NavLink>
        ))}
      </nav>

      {/* Main admin content. Scrolls inside its own container since
          RootLayout's outer main is overflow-hidden. pb-20 reserves
          space for the mobile bottom nav. */}
      <main className="min-w-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
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
  );
}
