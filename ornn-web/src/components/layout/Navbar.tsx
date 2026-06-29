/**
 * Navigation Bar — Forge Workshop top-level nav.
 *
 * Single source of truth for the top nav across the entire product:
 * landing surface (`/`) and the app shell (everything routed through
 * `RootLayout`). The previous split between `Navbar` and
 * `pages/landing/LandingNav` was a token-aliasing illusion — landing
 * tokens (parchment / bone / ember) resolve to the exact same colors
 * as the app shell's semantic tokens (strong / body / accent) in both
 * themes. The only real differences were:
 *
 *   - landing has an extra "Get started" CTA next to "Sign in"
 *   - landing animated the avatar dropdown with framer-motion
 *   - landing used i18n keys for "Language" / "Theme" mobile labels
 *     while the app navbar hard-coded English (a real i18n bug)
 *
 * All three are reconciled here: opt into the landing-style CTA pair
 * via `showGetStartedCta`, the motion-wrapped dropdown is now default
 * (cheap and consistent), and all labels go through i18n.
 *
 * @module components/layout/Navbar
 */

import { useState, useRef, useEffect } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore, useIsAuthenticated, useCurrentUser } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { logActivity } from "@/services/activityApi";
import { Logo } from "@/components/brand/Logo";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { HighlighterMark } from "@/pages/landing/HighlighterMark";
import { EmberLink } from "@/pages/landing/EmberButton";
import { useUserMenuGroups, type UserMenuItem } from "@/lib/userMenu";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.847-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 14A8.5 8.5 0 0 1 9.5 3.5a.75.75 0 0 0-.9-.9A9.5 9.5 0 1 0 21.4 14.9a.75.75 0 0 0-.9-.9Z" />
    </svg>
  );
}

const NAV_ITEMS = [
  { i18nKey: "nav.news", path: "/news", requiresAuth: false },
  { i18nKey: "nav.build", path: "/skills/new", requiresAuth: true },
  { i18nKey: "nav.registry", path: "/registry", requiresAuth: false, exact: true },
  { i18nKey: "nav.skillsets", path: "/skillsets", requiresAuth: false },
  { i18nKey: "nav.docs", path: "/docs", requiresAuth: false },
  { i18nKey: "nav.contact", path: "/contact", requiresAuth: false },
] as const;

export interface NavbarProps {
  className?: string;
  /**
   * Render the landing-style "Sign in + Get started" CTA pair instead
   * of the lone "Sign in" link. Used by the landing page only.
   */
  showGetStartedCta?: boolean;
}

function DropdownExternal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      role="menuitem"
      className="flex items-center px-4 py-2.5 font-text text-sm text-body transition-colors hover:bg-elevated hover:text-accent"
    >
      {children}
    </a>
  );
}

function DropdownInternal({
  to,
  onClick,
  children,
}: {
  to: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      role="menuitem"
      className="flex items-center px-4 py-2.5 font-text text-sm text-body transition-colors hover:bg-elevated hover:text-accent"
    >
      {children}
    </Link>
  );
}

export function Navbar({ className = "", showGetStartedCta = false }: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();
  const userMenuGroups = useUserMenuGroups(user);

  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close both menus on navigation. Using the "adjust state during
  // render" pattern (tracking the previous pathname) rather than a
  // route-change effect avoids the extra commit + cascading render that
  // setState-in-effect causes (#888).
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname);
    setUserMenuOpen(false);
    setMenuOpen(false);
  }

  function renderDesktopItem(
    item: UserMenuItem,
    closeMenu: () => void,
    onLogout: () => void | Promise<void>,
  ) {
    if (item.kind === "external" && item.href) {
      return (
        <DropdownExternal key={item.key} href={item.href}>
          {item.label}
        </DropdownExternal>
      );
    }
    if (item.kind === "internal" && item.to) {
      return (
        <DropdownInternal key={item.key} to={item.to} onClick={closeMenu}>
          {item.label}
        </DropdownInternal>
      );
    }
    return (
      <button
        key={item.key}
        type="button"
        onClick={onLogout}
        className="flex w-full items-center px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-colors hover:bg-elevated"
      >
        {item.label}
      </button>
    );
  }

  function renderMobileItem(item: UserMenuItem, closeMenu: () => void) {
    const itemRowClass =
      "border-b border-subtle py-3 font-text text-[16px] text-body transition-colors hover:text-accent";
    if (item.kind === "external" && item.href) {
      return (
        <a
          key={item.key}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={closeMenu}
          tabIndex={menuOpen ? 0 : -1}
          className={itemRowClass}
        >
          {item.label}
        </a>
      );
    }
    if (item.kind === "internal" && item.to) {
      return (
        <Link
          key={item.key}
          to={item.to}
          onClick={closeMenu}
          tabIndex={menuOpen ? 0 : -1}
          className={itemRowClass}
        >
          {item.label}
        </Link>
      );
    }
    return (
      <button
        key={item.key}
        type="button"
        onClick={handleLogout}
        tabIndex={menuOpen ? 0 : -1}
        className="py-3 text-left font-mono text-[12px] uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-muted"
      >
        {item.label}
      </button>
    );
  }

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setUserMenuOpen(false);
    setMenuOpen(false);
    await logActivity("logout");
    useAuthStore.getState().logout();
  };

  const initial = (user?.displayName || user?.email || "?").charAt(0).toUpperCase();
  const closeMenu = () => setMenuOpen(false);
  const toggleLang = () => i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `font-text text-[15px] transition-colors duration-150 ${
      isActive ? "font-semibold text-strong" : "text-body hover:text-accent"
    }`;

  return (
    <nav
      className={`sticky top-0 z-50 shrink-0 border-b border-subtle bg-page/95 backdrop-blur-md ${className}`}
    >
      <div className="relative mx-auto flex h-[60px] max-w-[1280px] items-center justify-between gap-3 px-6 sm:px-8 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <Link to="/" className="flex items-center gap-2 text-strong lg:justify-self-start" aria-label={t("aria.brandHome", { brand: "Ornn" })}>
          <Logo className="block h-[26px] w-auto" />
        </Link>

        <div className="hidden items-center justify-center gap-3 lg:flex lg:justify-self-center xl:gap-7">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.i18nKey}
              to={item.path}
              end={"exact" in item ? item.exact : false}
              onClick={(e) => {
                if (item.requiresAuth && !isAuthenticated) {
                  e.preventDefault();
                  navigate("/login", { state: { from: item.path } });
                }
              }}
              className={navLinkClass}
            >
              {({ isActive }) =>
                isActive ? (
                  <HighlighterMark className="highlighter-mark--loose">{t(item.i18nKey)}</HighlighterMark>
                ) : (
                  t(item.i18nKey)
                )
              }
            </NavLink>
          ))}
        </div>

        <div className="hidden items-center gap-3.5 lg:flex lg:justify-self-end">
          <a
            href="https://github.com/ChronoAIProject/Ornn"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("aria.brandOnGitHub", { brand: "ornn" })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-strong-edge bg-transparent text-strong transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <GitHubIcon className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={toggleLang}
            aria-label={t("aria.toggleLanguage")}
            className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-sm border border-strong-edge bg-transparent px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-strong transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {i18n.language === "zh" ? "中" : "EN"}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t("aria.toggleTheme")}
            aria-pressed={theme === "light"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-strong-edge bg-transparent text-strong transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {theme === "light" ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />}
          </button>

          {isAuthenticated && <NotificationBell />}

          {isAuthenticated && user ? (
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={t("aria.accountMenu")}
                className="flex items-center gap-2 rounded-sm border border-strong-edge bg-transparent p-1 pr-2.5 transition-colors duration-200 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-page text-accent">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-display text-sm font-semibold">{initial}</span>
                  )}
                </span>
                <svg
                  className={`h-3 w-3 text-meta transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="card-impression absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-sm border border-subtle bg-page"
                  >
                    <div className="border-b border-subtle px-4 py-3">
                      <p className="truncate font-display text-sm font-semibold text-strong">
                        {user.displayName}
                      </p>
                      <p className="truncate font-mono text-[11px] text-meta">{user.email}</p>
                    </div>

                    {userMenuGroups.map((group, i) => (
                      <div
                        key={group.id}
                        className={`py-1 ${i > 0 ? "border-t border-subtle" : ""}`}
                      >
                        {group.items.map((item) =>
                          renderDesktopItem(item, () => setUserMenuOpen(false), handleLogout),
                        )}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : showGetStartedCta ? (
            <EmberLink to="/login" variant="primary" className="whitespace-nowrap">
              {t("landing.getStarted")}
            </EmberLink>
          ) : (
            <Link
              to="/login"
              className="cta-letterpress cta-letterpress--ghost rounded-sm border border-strong-edge bg-card px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-strong hover:border-accent"
            >
              {t("nav.signIn")}
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? t("aria.closeMenu") : t("aria.openMenu")}
          aria-expanded={menuOpen}
          aria-controls="app-mobile-nav-panel"
          data-open={menuOpen}
          className="group inline-flex h-9 w-9 items-center justify-center rounded-sm border border-strong-edge bg-transparent text-strong transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" className="origin-center [transform-box:fill-box] transition-[translate,rotate] duration-300 ease-out group-data-[open=true]:translate-y-[6px] group-data-[open=true]:rotate-45" />
            <line x1="3" y1="12" x2="21" y2="12" className="transition-opacity duration-150 group-data-[open=true]:opacity-0" />
            <line x1="3" y1="18" x2="21" y2="18" className="origin-center [transform-box:fill-box] transition-[translate,rotate] duration-300 ease-out group-data-[open=true]:-translate-y-[6px] group-data-[open=true]:-rotate-45" />
          </svg>
        </button>
      </div>

      <div
        id="app-mobile-nav-panel"
        data-open={menuOpen}
        aria-hidden={!menuOpen}
        className="absolute left-0 right-0 top-full grid grid-rows-[0fr] bg-page transition-[grid-template-rows,border-color] duration-300 ease-out border-t border-transparent data-[open=true]:grid-rows-[1fr] data-[open=true]:border-subtle data-[open=true]:card-impression lg:hidden"
      >
        <div className="overflow-hidden">
          <div className="mx-auto flex max-w-[1280px] flex-col px-6 py-3 sm:px-8">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.i18nKey}
                to={item.path}
                end={"exact" in item ? item.exact : false}
                onClick={(e) => {
                  if (item.requiresAuth && !isAuthenticated) {
                    e.preventDefault();
                    navigate("/login", { state: { from: item.path } });
                  }
                  closeMenu();
                }}
                tabIndex={menuOpen ? 0 : -1}
                className={({ isActive }) =>
                  `border-b border-subtle py-3 font-text text-[16px] transition-colors ${
                    isActive ? "font-semibold text-strong" : "text-body hover:text-accent"
                  }`
                }
              >
                {({ isActive }) =>
                  isActive ? (
                    <HighlighterMark className="highlighter-mark--loose">{t(item.i18nKey)}</HighlighterMark>
                  ) : (
                    t(item.i18nKey)
                  )
                }
              </NavLink>
            ))}

            <a
              href="https://github.com/ChronoAIProject/Ornn"
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
              className="flex items-center gap-2 border-b border-subtle py-3 font-text text-[16px] text-body transition-colors hover:text-accent"
            >
              <GitHubIcon className="h-[18px] w-[18px]" />
              GitHub
            </a>
            <button
              type="button"
              onClick={toggleLang}
              tabIndex={menuOpen ? 0 : -1}
              className="flex items-center justify-between border-b border-subtle py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-body transition-colors hover:text-accent"
            >
              <span>{t("landing.languageLabel")}</span>
              <span className="text-accent">
                {i18n.language === "zh" ? t("landing.languageChinese") : t("landing.languageEnglish")}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              tabIndex={menuOpen ? 0 : -1}
              className="flex items-center justify-between border-b border-subtle py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-body transition-colors hover:text-accent"
            >
              <span>{t("landing.themeLabel")}</span>
              <span className="text-accent">
                {theme === "light" ? t("landing.themeLight") : t("landing.themeDark")}
              </span>
            </button>

            {isAuthenticated && user ? (
              <>
                <div className="flex items-center gap-3 border-b border-subtle py-3">
                  <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-elevated text-accent">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-display text-base font-semibold">{initial}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-semibold text-strong">
                      {user.displayName}
                    </p>
                    <p className="truncate font-mono text-[11px] text-meta">{user.email}</p>
                  </div>
                </div>
                {userMenuGroups
                  .flatMap((g) => g.items)
                  .map((item) => renderMobileItem(item, closeMenu))}
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={closeMenu}
                  tabIndex={menuOpen ? 0 : -1}
                  className="py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-strong transition-colors hover:text-accent"
                >
                  {t("nav.signIn")} →
                </Link>
                {showGetStartedCta && (
                  <EmberLink
                    to="/login"
                    variant="primary"
                    className="!mt-2 !w-full !justify-center"
                  >
                    {t("landing.getStarted")}
                  </EmberLink>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
