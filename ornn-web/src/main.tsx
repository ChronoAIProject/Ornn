import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/neon.css";
import "./stores/themeStore"; // Apply saved theme immediately
import "./i18n"; // Initialize i18next

/**
 * Stale-bundle rescue. After a redeploy, an older tab holds an
 * index.html that references chunk hashes which no longer exist on
 * disk. The next lazy import (e.g. navigating to SkillDetailPage) then
 * throws "Failed to fetch dynamically imported module" / "error
 * loading dynamically imported module". Force a single reload to pull
 * the fresh shell — sessionStorage flag prevents reload loops if the
 * error is something other than chunk-hash drift.
 *
 * Catches it from both spots Vite may surface it:
 *   - window 'error' (script tag insertion failure)
 *   - 'unhandledrejection' (top-level await of import())
 */
const RELOAD_FLAG = "ornn-stale-bundle-reloaded";
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Loading chunk \S+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}
function maybeReload(err: unknown): void {
  if (!isChunkLoadError(err)) return;
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, "1");
  window.location.reload();
}
window.addEventListener("error", (e) => maybeReload(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => maybeReload(e.reason));
// Clear the guard once the page has loaded successfully so a future
// stale-bundle event after another redeploy is also recoverable.
window.addEventListener("load", () => {
  sessionStorage.removeItem(RELOAD_FLAG);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
