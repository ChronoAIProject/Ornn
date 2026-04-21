/**
 * Navigation Bar Component.
 * Fixed top navigation with links, mobile hamburger menu, and user dropdown.
 * Cyberpunk styled with glass morphism and neon accents.
 * @module components/layout/Navbar
 */

import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore, useIsAuthenticated, useCurrentUser, isAdmin } from "@/stores/authStore";
import { logActivity } from "@/services/activityApi";
import { useThemeStore } from "@/stores/themeStore";
import { useTranslation } from "react-i18next";

/** Admin icon */
function AdminIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

/** Logout icon */
function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

/** NyxID icon (shield/key) */
function NyxIdIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  );
}

/** Derive NyxID home URL from the authorize URL env var */
function getNyxIdUrl(): string {
  try {
    const authorizeUrl = import.meta.env.VITE_NYXID_AUTHORIZE_URL ?? "";
    if (authorizeUrl) {
      const url = new URL(authorizeUrl);
      return url.origin;
    }
  } catch { /* ignore */ }
  return "https://nyx.chrono-ai.fun";
}

/** Menu icon (hamburger) */
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
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

export interface NavbarProps {
  className?: string;
}

/** Sun icon */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

/** Moon icon */
function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

/** Theme toggle button */
function ThemeToggle() {
  const { theme, toggle } = useThemeStore();
  return (
    <button
      type="button"
      onClick={toggle}
      className="hidden sm:flex items-center justify-center h-10 w-10 rounded-lg border border-neon-cyan/30 bg-bg-surface/50 text-text-muted transition-all duration-200 hover:text-neon-cyan hover:border-neon-cyan/50 cursor-pointer"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <SunIcon className="h-5 w-5" />
      ) : (
        <MoonIcon className="h-5 w-5" />
      )}
    </button>
  );
}

/** GitHub icon */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

/** GitHub link button */
function GitHubLink() {
  return (
    <a
      href="https://github.com/aevatarAI/chrono-ornn"
      target="_blank"
      rel="noopener noreferrer"
      className="hidden sm:flex items-center justify-center h-10 w-10 rounded-lg border border-neon-cyan/30 bg-bg-surface/50 text-text-muted transition-all duration-200 hover:text-neon-cyan hover:border-neon-cyan/50"
      title="GitHub"
    >
      <GitHubIcon className="h-5 w-5" />
    </a>
  );
}

/** Language dropdown */
function LangDropdown() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const LANGS = [
    { code: "en", label: "English" },
    { code: "zh", label: "中文" },
  ] as const;

  const current = LANGS.find((l) => l.code === i18n.language) ?? LANGS[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 h-10 px-3 rounded-lg border border-neon-cyan/30 bg-bg-surface/50 font-heading text-xs tracking-wider text-text-muted transition-all duration-200 hover:text-neon-cyan hover:border-neon-cyan/50 cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A8.966 8.966 0 013 12c0-1.777.514-3.434 1.4-4.832" />
        </svg>
        {current.label}
        <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg glass border border-neon-cyan/20 shadow-lg shadow-neon-cyan/10 py-1 z-50">
          {LANGS.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                i18n.changeLanguage(lang.code);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2 font-body text-sm transition-colors cursor-pointer ${
                lang.code === i18n.language
                  ? "text-neon-cyan bg-neon-cyan/5"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mobile language toggle */
function MobileLangToggle() {
  const { i18n } = useTranslation();
  const isZh = i18n.language === "zh";
  const toggle = () => i18n.changeLanguage(isZh ? "en" : "zh");
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors cursor-pointer"
    >
      <span className="font-heading text-sm">{isZh ? "EN" : "中"}</span>
      <span className="font-body text-sm font-medium">{isZh ? "English" : "中文"}</span>
    </button>
  );
}

/** Mobile theme toggle (full-width row) */
function MobileThemeToggle() {
  const { theme, toggle } = useThemeStore();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors cursor-pointer"
    >
      {theme === "dark" ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
      <span className="font-body text-sm font-medium">
        {theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
      </span>
    </button>
  );
}

/** Top-level nav items next to the logo */
const NAV_ITEMS = [
  { i18nKey: "nav.home", path: "/", requiresAuth: false, exact: true },
  { i18nKey: "nav.registry", path: "/registry", requiresAuth: false, exact: true },
  { i18nKey: "nav.build", path: "/skills/new", requiresAuth: true },
  { i18nKey: "nav.docs", path: "/docs", requiresAuth: false },
] as const;

export function Navbar({ className = "" }: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close menus on navigation
  useEffect(() => {
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const handleLogout = async () => {
    await logActivity("logout");
    useAuthStore.getState().logout();
  };

  return (
    <>
      <nav
        className={`glass sticky top-0 z-40 shrink-0 border-b border-neon-cyan/10 ${className}`}
      >
        <div className="flex h-24 items-center px-6 sm:px-10 lg:px-14">
          {/* Logo */}
          <div className="flex items-center shrink-0">
            <Link to="/" className="flex items-center">
              <img src="/logo.svg?v=10" alt="ORNN" className="h-10 w-auto" />
            </Link>
          </div>

          <div className="flex-1" />

          {/* Right section: Nav + GitHub + Lang + Theme + User menu */}
          <div className="flex items-center gap-4 shrink-0">

            {/* Nav links — pushed right, sits just to the left of the
                GitHub icon with a small visual gap via `mr-2`. */}
            <nav className="hidden sm:flex items-center gap-1 mr-2">
              {NAV_ITEMS.map((item) => {
                const isActive = "exact" in item && item.exact
                  ? location.pathname === item.path
                  : location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.i18nKey}
                    type="button"
                    onClick={() => {
                      if (item.requiresAuth && !isAuthenticated) {
                        navigate("/login", { state: { from: item.path } });
                      } else {
                        navigate(item.path);
                      }
                    }}
                    className={`
                      relative px-4 py-2 rounded-lg font-heading text-base tracking-wider transition-all duration-200 cursor-pointer
                      ${isActive
                        ? "text-neon-cyan"
                        : "text-text-muted hover:text-text-primary"
                      }
                    `}
                  >
                    {t(item.i18nKey)}
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-neon-cyan"
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* GitHub + Lang + Theme */}
            <GitHubLink />
            <LangDropdown />
            <ThemeToggle />

            {/* User Menu (Desktop) */}
            {isAuthenticated && user && (
              <div ref={userMenuRef} className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2 rounded-full border border-neon-cyan/30 bg-bg-surface/50 p-1.5 pr-3 transition-all duration-200 hover:border-neon-cyan/60 cursor-pointer"
                >
                  {/* Avatar */}
                  <div className="h-10 w-10 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-neon-cyan/20">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="font-heading text-base text-neon-cyan">
                          {user.displayName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Arrow */}
                  <svg
                    className={`h-4 w-4 text-text-muted transition-transform duration-200 ${
                      isUserMenuOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                <AnimatePresence>
                  {isUserMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-lg glass border border-neon-cyan/20 shadow-lg shadow-neon-cyan/10"
                    >
                      {/* User Info */}
                      <div className="border-b border-neon-cyan/10 px-4 py-3">
                        <p className="font-body text-sm font-semibold text-text-primary truncate">
                          {user.displayName}
                        </p>
                        <p className="font-mono text-xs text-text-muted truncate">
                          {user.email}
                        </p>
                      </div>

                      {/* Section 1 — caller-scoped (every signed-in user). */}
                      <div className="py-1">
                        <a
                          href={`${getNyxIdUrl()}/settings`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                        >
                          <svg className="h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {t("nav.myProfile", "My Profile")}
                        </a>
                        <Link
                          to="/services/my"
                          className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                        >
                          <svg className="h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                          </svg>
                          {t("nav.myServices", "My NyxID Services")}
                        </Link>
                        <a
                          href={`${getNyxIdUrl()}/orgs`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                        >
                          <svg className="h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          {t("nav.myOrgs", "My Organizations")}
                        </a>
                        <a
                          href={getNyxIdUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                        >
                          <NyxIdIcon className="h-4 w-4 text-text-muted" />
                          {t("nav.goToNyxId")}
                        </a>
                      </div>

                      {/* Section 2 — ornn platform admins only. Rendered as a
                          separate bordered block so the visual grouping
                          signals "this group requires elevated access". */}
                      {isAdmin(user) && (
                        <div className="border-t border-neon-cyan/10 py-1">
                          <Link
                            to="/admin"
                            className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                          >
                            <AdminIcon className="h-4 w-4 text-text-muted" />
                            {t("nav.adminPanel")}
                          </Link>
                          <Link
                            to="/services/admin"
                            className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                          >
                            <svg className="h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {t("nav.adminServices", "Admin NyxID Services")}
                          </Link>
                        </div>
                      )}

                      {/* Section 3 — Sign out */}
                      <div className="border-t border-neon-cyan/10 py-1">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-3 px-4 py-2.5 font-body text-sm text-neon-red transition-colors hover:bg-neon-red/10 cursor-pointer"
                        >
                          <LogoutIcon className="h-4 w-4" />
                          {t("nav.signOut")}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Login button when not authenticated */}
            {!isAuthenticated && (
              <Link
                to="/login"
                className="hidden sm:block rounded-lg px-5 py-2.5 border border-neon-cyan/50 font-body text-base font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
              >
                {t("nav.signIn")}
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden flex items-center justify-center h-10 w-10 rounded-lg border border-neon-cyan/30 bg-bg-surface/50 text-text-muted transition-colors hover:text-neon-cyan hover:border-neon-cyan/50 cursor-pointer"
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? (
                <CloseIcon className="h-5 w-5" />
              ) : (
                <MenuIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />

            {/* Mobile Menu Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed top-20 right-0 bottom-0 z-30 w-72 glass border-l border-neon-cyan/10 overflow-y-auto lg:hidden"
            >
              {/* User section (mobile) */}
              {isAuthenticated && user && (
                <div className="border-b border-neon-cyan/10 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-full bg-bg-elevated ring-2 ring-neon-cyan/20">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="font-heading text-lg text-neon-cyan">
                            {user.displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-semibold text-text-primary truncate">
                        {user.displayName}
                      </p>
                      <p className="font-mono text-xs text-text-muted truncate">
                        {user.email}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation Links */}
              <nav className="p-2 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = "exact" in item && item.exact
                    ? location.pathname === item.path
                    : location.pathname.startsWith(item.path);
                  return (
                    <button
                      key={item.i18nKey}
                      type="button"
                      onClick={() => {
                        if (item.requiresAuth && !isAuthenticated) {
                          navigate("/login", { state: { from: item.path } });
                        } else {
                          navigate(item.path);
                        }
                        setIsMobileMenuOpen(false);
                      }}
                      className={`
                        flex w-full items-center gap-3 px-4 py-3 rounded-lg transition-all cursor-pointer
                        ${isActive
                          ? "text-neon-cyan bg-neon-cyan/10 border border-neon-cyan/30"
                          : "text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                        }
                      `}
                    >
                      <span className="font-heading text-sm tracking-wider">{t(item.i18nKey)}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Bottom section */}
              <div className="absolute bottom-0 left-0 right-0 border-t border-neon-cyan/10 p-2 bg-bg-deep/80">
                {/* Mobile lang + theme toggles */}
                <MobileLangToggle />
                <MobileThemeToggle />

                {isAuthenticated && user ? (
                  <>
                    {isAdmin(user) && (
                      <Link
                        to="/admin"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
                      >
                        <AdminIcon className="h-5 w-5" />
                        <span className="font-body text-sm font-medium">{t("nav.adminPanel")}</span>
                      </Link>
                    )}

                    <Link
                      to="/services/my"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
                    >
                      <span className="font-body text-sm font-medium">My NyxID Services</span>
                    </Link>
                    {isAdmin(user) && (
                      <Link
                        to="/services/admin"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
                      >
                        <span className="font-body text-sm font-medium">Admin NyxID Services</span>
                      </Link>
                    )}
                    <a
                      href={getNyxIdUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
                    >
                      <NyxIdIcon className="h-5 w-5" />
                      <span className="font-body text-sm font-medium">{t("nav.goToNyxId")}</span>
                    </a>

                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-neon-red hover:bg-neon-red/10 transition-colors cursor-pointer"
                    >
                      <LogoutIcon className="h-5 w-5" />
                      <span className="font-body text-sm font-medium">{t("nav.signOut")}</span>
                    </button>
                  </>
                ) : (
                  <Link
                    to="/login"
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-neon-cyan/50 text-neon-cyan font-body text-sm font-semibold transition-all hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
                  >
                    {t("nav.signIn")}
                  </Link>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
