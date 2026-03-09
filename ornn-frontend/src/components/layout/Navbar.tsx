/**
 * Navigation Bar Component.
 * Fixed top navigation with links, mobile hamburger menu, and user dropdown.
 * Cyberpunk styled with glass morphism and neon accents.
 * @module components/layout/Navbar
 */

import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore, useIsAuthenticated, useCurrentUser, isAdmin } from "@/stores/authStore";

interface NavLink {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  authRequired?: boolean;
  adminOnly?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { to: "/", label: "Public Skills", icon: ExploreIcon },
  { to: "/my-skills", label: "My Skills", icon: SkillsIcon, authRequired: true },
];

/** Explore icon */
function ExploreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

/** Skills icon */
function SkillsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

/** Settings icon */
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

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

export function Navbar({ className = "" }: NavbarProps) {
  const location = useLocation();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Filter nav links based on auth and role
  const visibleLinks = NAV_LINKS.filter((link) => {
    if (link.adminOnly && !isAdmin(user)) return false;
    if (link.authRequired && !isAuthenticated) return false;
    return true;
  });

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

  const handleLogout = () => {
    useAuthStore.getState().logout();
  };

  const isLinkActive = (linkTo: string) => {
    if (linkTo === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(linkTo);
  };

  return (
    <>
      <nav
        className={`glass sticky top-0 z-40 shrink-0 border-b border-neon-cyan/10 ${className}`}
      >
        <div className="flex h-16 items-center justify-between px-6 sm:px-10">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <img src="/logo.png" alt="ORNN" className="h-10 w-10 rounded-lg object-cover" />
            <span className="neon-cyan font-heading text-2xl font-bold tracking-widest text-neon-cyan hidden sm:block">
              ORNN
            </span>
          </Link>

          {/* Right section: Nav links + User menu / Login + Mobile menu button */}
          <div className="flex items-center gap-4">
            {/* Desktop Navigation Links */}
            <div className="hidden lg:flex items-center gap-2 mr-3">
              {visibleLinks.map((link) => {
                const isActive = isLinkActive(link.to);

                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="relative px-4 py-2.5 rounded-lg transition-colors group"
                  >
                    <span
                      className={`font-body text-base font-semibold uppercase tracking-wider transition-colors ${
                        isActive
                          ? "text-neon-cyan"
                          : "text-text-muted group-hover:text-text-primary"
                      }`}
                    >
                      {link.label}
                    </span>
                    {isActive && (
                      <motion.div
                        layoutId="nav-underline"
                        className="absolute -bottom-0.5 left-2 right-2 h-0.5 bg-neon-cyan shadow-[0_0_8px_#FF6B00]"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </Link>
                );
              })}
            </div>

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

                      {/* Menu Items */}
                      <div className="py-1">
                        <Link
                          to="/settings"
                          className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                        >
                          <SettingsIcon className="h-4 w-4 text-text-muted" />
                          Settings
                        </Link>

                        {isAdmin(user) && (
                          <Link
                            to="/admin"
                            className="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-text-primary transition-colors hover:bg-neon-cyan/5"
                          >
                            <AdminIcon className="h-4 w-4 text-text-muted" />
                            Admin Panel
                          </Link>
                        )}
                      </div>

                      {/* Logout */}
                      <div className="border-t border-neon-cyan/10 py-1">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-3 px-4 py-2.5 font-body text-sm text-neon-red transition-colors hover:bg-neon-red/10 cursor-pointer"
                        >
                          <LogoutIcon className="h-4 w-4" />
                          Sign Out
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
                className="hidden sm:block rounded-lg px-4 py-2 border border-neon-cyan/50 font-body text-sm font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
              >
                Sign In
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
              className="fixed top-16 right-0 bottom-0 z-30 w-72 glass border-l border-neon-cyan/10 overflow-y-auto lg:hidden"
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
              <nav className="p-2">
                {visibleLinks.map((link) => {
                  const isActive = isLinkActive(link.to);
                  const Icon = link.icon;

                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-all ${
                        isActive
                          ? "bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30"
                          : "text-text-muted hover:bg-bg-elevated hover:text-text-primary border border-transparent"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="font-body text-sm font-medium">
                        {link.label}
                      </span>
                      {isActive && (
                        <div className="ml-auto h-2 w-2 rounded-full bg-neon-cyan shadow-[0_0_8px_#FF6B00]" />
                      )}
                    </Link>
                  );
                })}
              </nav>

              {/* Bottom section */}
              <div className="absolute bottom-0 left-0 right-0 border-t border-neon-cyan/10 p-2 bg-bg-deep/80">
                {isAuthenticated && user ? (
                  <>
                    <Link
                      to="/settings"
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
                    >
                      <SettingsIcon className="h-5 w-5" />
                      <span className="font-body text-sm font-medium">Settings</span>
                    </Link>

                    {isAdmin(user) && (
                      <Link
                        to="/admin"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
                      >
                        <AdminIcon className="h-5 w-5" />
                        <span className="font-body text-sm font-medium">Admin Panel</span>
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-neon-red hover:bg-neon-red/10 transition-colors cursor-pointer"
                    >
                      <LogoutIcon className="h-5 w-5" />
                      <span className="font-body text-sm font-medium">Sign Out</span>
                    </button>
                  </>
                ) : (
                  <Link
                    to="/login"
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-neon-cyan/50 text-neon-cyan font-body text-sm font-semibold transition-all hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
                  >
                    Sign In
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
