/**
 * Cookie / analytics consent state.
 *
 * GDPR-compliant default: undecided users are NOT counted as consenting.
 * Once the user clicks Accept or Decline the choice persists in
 * localStorage so they aren't re-prompted every visit. Per #252 the
 * launch geography assumes EU users are present, so the banner ships on
 * by default.
 *
 * Listeners subscribe via `onConsentChange`; the analytics module wires
 * itself in on init to opt in/out of capture as the choice flips.
 *
 * @module lib/cookieConsent
 */

const STORAGE_KEY = "ornn-analytics-consent";

export type ConsentState = "granted" | "denied";

type Listener = (granted: boolean) => void;
const listeners = new Set<Listener>();

/**
 * In-memory fallback when `localStorage` is unavailable (private mode,
 * SSR-like environments, sandboxed test runners that disable storage).
 * This way the choice still sticks within the session even if it can't
 * persist across reloads.
 */
let memoryFallback: ConsentState | null = null;

function readStored(): ConsentState | null {
  if (typeof window === "undefined") return memoryFallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "granted" || raw === "denied") return raw;
    return memoryFallback;
  } catch {
    return memoryFallback;
  }
}

/** True when the user has explicitly granted consent. */
export function hasConsent(): boolean {
  return readStored() === "granted";
}

/** True when the user has not yet decided — drives banner visibility. */
export function isUndecided(): boolean {
  return readStored() === null;
}

/** Persist a choice and notify subscribers. */
export function setConsent(state: ConsentState): void {
  // Always set the in-memory mirror so reads inside the same session
  // succeed even when localStorage is unavailable.
  memoryFallback = state;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, state);
    } catch {
      /* localStorage may be disabled in private mode — memoryFallback covers it. */
    }
  }
  const granted = state === "granted";
  for (const fn of listeners) {
    try {
      fn(granted);
    } catch {
      /* one bad listener should not break the rest */
    }
  }
}

/**
 * Subscribe to consent changes. Returns an unsubscribe fn.
 * Use this from analytics / session-replay layers that need to react to
 * the choice without polling.
 */
export function onConsentChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test-only helper — clears the stored choice. */
export function __resetConsentForTests(): void {
  memoryFallback = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
