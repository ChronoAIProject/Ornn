import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useThemeStore } from "@/stores/themeStore";
import { useAuthStore, useIsAuthenticated, useCurrentUser, isAdmin } from "@/stores/authStore";
import { logActivity } from "@/services/activityApi";
import { config } from "@/config";
import { EmberLink } from "./EmberButton";

/** Derive NyxID home URL from the authorize URL env var. */
function getNyxIdUrl(): string {
  try {
    const authorizeUrl = config.nyxidOauthAuthorizeUrl;
    if (authorizeUrl) {
      const url = new URL(authorizeUrl);
      return url.origin;
    }
  } catch {
    /* ignore */
  }
  return "https://nyx.chrono-ai.fun";
}

/**
 * One row inside the desktop avatar dropdown — opens an external URL
 * (NyxID portal sub-pages) in a new tab. Styled with landing tokens.
 */
function DropdownExternal({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      role="menuitem"
      className="flex items-center px-4 py-2.5 font-text text-sm text-bone transition-colors hover:bg-[color:var(--surface-elevated)] hover:text-ember"
    >
      {children}
    </a>
  );
}

/** Same shape as DropdownExternal but for in-app routes. */
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
      className="flex items-center px-4 py-2.5 font-text text-sm text-bone transition-colors hover:bg-[color:var(--surface-elevated)] hover:text-ember"
    >
      {children}
    </Link>
  );
}

/**
 * Top-level fixed nav. On md+ shows full nav inline; on mobile collapses
 * Registry/Build/Docs/Sign-in into a hamburger panel that drops below the
 * 60px nav row.
 *
 * When the user is authenticated, the desktop "Sign in" + "Get started"
 * pair is replaced with an avatar dropdown (profile / services / orgs /
 * NyxID portal / admin / sign out). Mobile follows the same swap inside
 * the hamburger panel.
 */
export function LandingNav() {
  const { theme, toggle } = useThemeStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  // Avatar dropdown — mirrors `Navbar.tsx`'s desktop user-menu but
  // restyled in landing tokens. Closes on outside click + ESC.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
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

  const handleLogout = async () => {
    setUserMenuOpen(false);
    closeMenu();
    await logActivity("logout");
    useAuthStore.getState().logout();
  };

  const initial = (user?.displayName || user?.email || "?").charAt(0).toUpperCase();

  return (
    <nav className="sticky top-0 z-50 border-b border-[color:var(--color-border-subtle)] [background-color:var(--surface-nav)] backdrop-blur-md">
      <div className="relative mx-auto flex h-[60px] max-w-[1280px] items-center justify-between gap-3 px-6 sm:px-8">
        <Link
          to="/"
          aria-label="ornn home"
          className="focus-ring-ember flex items-center gap-2.5 text-parchment no-underline"
        >
          <svg
            className="block h-[26px] w-auto"
            viewBox="0 0 230 64"
            fill="none"
            aria-hidden="true"
          >
            <path
              fill="var(--color-ember)"
              fillRule="evenodd"
              d="M63.39,38.24 L59.46,37.46 A28,28 0 0,1 55.28,47.56 L58.61,49.78 A32,32 0 0,1 49.78,58.61 L47.56,55.28 A28,28 0 0,1 37.46,59.46 L38.24,63.39 A32,32 0 0,1 25.76,63.39 L26.54,59.46 A28,28 0 0,1 16.44,55.28 L14.22,58.61 A32,32 0 0,1 5.39,49.78 L8.72,47.56 A28,28 0 0,1 4.54,37.46 L0.61,38.24 A32,32 0 0,1 0.61,25.76 L4.54,26.54 A28,28 0 0,1 8.72,16.44 L5.39,14.22 A32,32 0 0,1 14.22,5.39 L16.44,8.72 A28,28 0 0,1 26.54,4.54 L25.76,0.61 A32,32 0 0,1 38.24,0.61 L37.46,4.54 A28,28 0 0,1 47.56,8.72 L49.78,5.39 A32,32 0 0,1 58.61,14.22 L55.28,16.44 A28,28 0 0,1 59.46,26.54 L63.39,25.76 A32,32 0 0,1 63.39,38.24 Z M46,32 A14,14 0 1,0 18,32 A14,14 0 1,0 46,32 Z"
            />
            <g fill="currentColor">
              <path d="M74,60 L74,12 L86,12 A24,24 0 0,1 110,36 L98,36 A12,12 0 0,0 86,24 L86,60 Z" />
              <path d="M122,60 L122,36 A24,24 0 0,1 170,36 L170,60 L158,60 L158,36 A12,12 0 0,0 134,36 L134,60 Z" />
              <path d="M182,60 L182,36 A24,24 0 0,1 230,36 L230,60 L218,60 L218,36 A12,12 0 0,0 194,36 L194,60 Z" />
            </g>
          </svg>
        </Link>

        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 gap-7 font-text text-[15px] font-normal text-bone md:flex">
          <Link
            to="/registry"
            className="focus-ring-ember transition-colors duration-150 hover:text-ember"
          >
            Registry
          </Link>
          <Link
            to="/skills/new"
            className="focus-ring-ember transition-colors duration-150 hover:text-ember"
          >
            Build
          </Link>
          <Link
            to="/docs"
            className="focus-ring-ember transition-colors duration-150 hover:text-ember"
          >
            Docs
          </Link>
        </div>

        {/* Desktop right cluster — fully hidden on mobile; the hamburger
            owns all of these on small viewports via the dropdown panel. */}
        <div className="hidden items-center gap-3.5 md:flex">
          <a
            href="https://github.com/ChronoAIProject/Ornn"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ornn on GitHub"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-[color:var(--color-border-strong)] bg-transparent text-parchment transition-colors duration-200 hover:border-ember hover:text-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.847-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
          </a>
          <button
            type="button"
            aria-label="Toggle theme"
            aria-pressed={theme === "light"}
            onClick={toggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-[color:var(--color-border-strong)] bg-transparent text-parchment transition-colors duration-200 hover:border-ember hover:text-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            {theme === "light" ? (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.5 14A8.5 8.5 0 0 1 9.5 3.5a.75.75 0 0 0-.9-.9A9.5 9.5 0 1 0 21.4 14.9a.75.75 0 0 0-.9-.9Z" />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            )}
          </button>

          {isAuthenticated && user ? (
            // Avatar trigger + dropdown. Uses landing-page tokens
            // (parchment / bone / ember / page) so it sits inside the
            // Forge Workshop palette without leaking the rest of the
            // app's neon-cyan styling.
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="Account menu"
                className="focus-ring-ember flex items-center gap-2 rounded-[2px] border border-[color:var(--color-border-strong)] bg-transparent p-1 pr-2.5 transition-colors duration-200 hover:border-ember"
              >
                <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-page text-ember">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-display text-sm font-semibold">{initial}</span>
                  )}
                </span>
                <svg
                  className={`h-3 w-3 text-bone transition-transform duration-200 ${
                    userMenuOpen ? "rotate-180" : ""
                  }`}
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
                    className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-[2px] border border-[color:var(--color-border-subtle)] bg-page shadow-[var(--card-shadow-rest)]"
                  >
                    {/* Identity card */}
                    <div className="border-b border-[color:var(--color-border-subtle)] px-4 py-3">
                      <p className="truncate font-display text-sm font-semibold text-parchment">
                        {user.displayName}
                      </p>
                      <p className="truncate font-mono text-[11px] text-bone">{user.email}</p>
                    </div>

                    {/* Per-user external links — open the user's NyxID
                        portal in a new tab so the landing surface stays
                        focused on Ornn. */}
                    <div className="py-1">
                      <DropdownExternal href={`${getNyxIdUrl()}/settings`}>
                        My Profile
                      </DropdownExternal>
                      <DropdownExternal href={`${getNyxIdUrl()}/services`}>
                        My NyxID Services
                      </DropdownExternal>
                      <DropdownExternal href={`${getNyxIdUrl()}/orgs`}>
                        My Organizations
                      </DropdownExternal>
                      <DropdownExternal href={getNyxIdUrl()}>NyxID Portal</DropdownExternal>
                    </div>

                    {isAdmin(user) && (
                      <div className="border-t border-[color:var(--color-border-subtle)] py-1">
                        <DropdownInternal to="/admin" onClick={() => setUserMenuOpen(false)}>
                          Admin Panel
                        </DropdownInternal>
                      </div>
                    )}

                    <div className="border-t border-[color:var(--color-border-subtle)] py-1">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-ember transition-colors hover:bg-[color:var(--surface-elevated)]"
                      >
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              <EmberLink to="/login" variant="ghost">
                Sign in
              </EmberLink>

              <EmberLink to="/login" variant="primary">
                Get started
              </EmberLink>
            </>
          )}
        </div>

        {/* Mobile-only hamburger — rightmost element on small viewports.
            The three SVG lines morph into a cross when `data-open=true`:
            top line drops + rotates 45°, middle fades, bottom rises +
            rotates -45°. transform-origin lives at the line center via
            transform-box:fill-box so each line pivots about itself. */}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-panel"
          data-open={menuOpen}
          className="group inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-[color:var(--color-border-strong)] bg-transparent text-parchment transition-colors duration-200 hover:border-ember hover:text-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember md:hidden"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {/* Three lines collapse and rotate into a cross. The
                top/bottom lines first slide to the middle (delay 0),
                then the rotation carries them into the X. The middle
                line fades early so it's gone by the time the others
                reach center. */}
            <line
              x1="3"
              y1="6"
              x2="21"
              y2="6"
              className="origin-center [transform-box:fill-box] transition-[translate,rotate] duration-[500ms] ease-[cubic-bezier(0.65,0,0.35,1)] group-data-[open=true]:translate-y-[6px] group-data-[open=true]:rotate-45"
            />
            <line
              x1="3"
              y1="12"
              x2="21"
              y2="12"
              className="transition-opacity duration-150 ease-out group-data-[open=true]:opacity-0"
            />
            <line
              x1="3"
              y1="18"
              x2="21"
              y2="18"
              className="origin-center [transform-box:fill-box] transition-[translate,rotate] duration-[500ms] ease-[cubic-bezier(0.65,0,0.35,1)] group-data-[open=true]:-translate-y-[6px] group-data-[open=true]:-rotate-45"
            />
          </svg>
        </button>
      </div>

      {/* Mobile dropdown panel. Always rendered (so it can animate); the
          slide-down uses the `grid-template-rows: 0fr → 1fr` pattern so
          height is content-driven. Background is fully opaque (bg-page)
          rather than the semi-transparent surface-nav so the menu reads
          as a discrete surface, not a frosted overlay. */}
      <div
        id="mobile-nav-panel"
        data-open={menuOpen}
        aria-hidden={!menuOpen}
        className="absolute left-0 right-0 top-full grid grid-rows-[0fr] bg-page shadow-[var(--card-shadow-rest)] transition-[grid-template-rows,border-color] duration-300 ease-out border-t border-transparent data-[open=true]:grid-rows-[1fr] data-[open=true]:border-[color:var(--color-border-subtle)] md:hidden"
      >
        <div className="overflow-hidden">
          <div className="mx-auto flex max-w-[1280px] flex-col px-6 py-3 sm:px-8">
            <Link
              to="/registry"
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
              className="focus-ring-ember border-b border-[color:var(--color-border-subtle)] py-3 font-text text-[16px] text-bone transition-colors hover:text-ember"
            >
              Registry
            </Link>
            <Link
              to="/skills/new"
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
              className="focus-ring-ember border-b border-[color:var(--color-border-subtle)] py-3 font-text text-[16px] text-bone transition-colors hover:text-ember"
            >
              Build
            </Link>
            <Link
              to="/docs"
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
              className="focus-ring-ember border-b border-[color:var(--color-border-subtle)] py-3 font-text text-[16px] text-bone transition-colors hover:text-ember"
            >
              Docs
            </Link>
            <a
              href="https://github.com/ChronoAIProject/Ornn"
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMenu}
              tabIndex={menuOpen ? 0 : -1}
              className="flex items-center gap-2 border-b border-[color:var(--color-border-subtle)] py-3 font-display text-[16px] text-bone transition-colors hover:text-ember"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[18px] w-[18px]"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.847-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              GitHub
            </a>
            <button
              type="button"
              onClick={toggle}
              tabIndex={menuOpen ? 0 : -1}
              className="flex items-center justify-between border-b border-[color:var(--color-border-subtle)] py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-bone transition-colors hover:text-ember"
            >
              <span>Theme</span>
              <span className="text-ember">
                {theme === "light" ? "Light" : "Dark"}
              </span>
            </button>
            {isAuthenticated && user ? (
              <>
                {/* Identity row — same shape as the desktop dropdown's
                    header so the user has the same anchor in both
                    layouts. */}
                <div className="flex items-center gap-3 border-b border-[color:var(--color-border-subtle)] py-3">
                  <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-page text-ember">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-display text-base font-semibold">{initial}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-semibold text-parchment">
                      {user.displayName}
                    </p>
                    <p className="truncate font-mono text-[11px] text-bone">{user.email}</p>
                  </div>
                </div>
                <a
                  href={`${getNyxIdUrl()}/settings`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMenu}
                  tabIndex={menuOpen ? 0 : -1}
                  className="border-b border-[color:var(--color-border-subtle)] py-3 font-text text-[16px] text-bone transition-colors hover:text-ember"
                >
                  My Profile
                </a>
                {isAdmin(user) && (
                  <Link
                    to="/admin"
                    onClick={closeMenu}
                    tabIndex={menuOpen ? 0 : -1}
                    className="border-b border-[color:var(--color-border-subtle)] py-3 font-text text-[16px] text-bone transition-colors hover:text-ember"
                  >
                    Admin Panel
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  tabIndex={menuOpen ? 0 : -1}
                  className="flex items-center justify-start py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-ember transition-colors hover:text-parchment"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={closeMenu}
                  tabIndex={menuOpen ? 0 : -1}
                  className="py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-parchment transition-colors hover:text-ember"
                >
                  Sign in →
                </Link>
                <EmberLink
                  to="/login"
                  variant="primary"
                  className="!mt-2 !w-full !justify-center"
                >
                  Get started
                </EmberLink>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
