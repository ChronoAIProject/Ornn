/**
 * SPA stale-bundle self-recovery.
 *
 * The SPA bakes its build version into `__APP_VERSION__` at compile
 * time. nginx serves a sister file `/version.json` (written by the
 * Vite build, never cached) carrying that same version string. At
 * runtime the SPA polls `/version.json` periodically and on focus;
 * when the live version drifts from the baked one, a banner offers a
 * one-click reload. Users on stale tabs / aggressively-cached browsers
 * (Safari) recover without being told to clear cache.
 *
 * Failure-tolerant by design: any network / parse / 404 error is
 * silent — we'd rather under-prompt than spam the user.
 *
 * @module lib/versionCheck
 */

const VERSION_JSON_PATH = "/version.json";
const POLL_INTERVAL_MS = 60_000;

/**
 * The version baked into the JS bundle at build time. Defined via the
 * Vite `define` config in `vite.config.ts`. Format: `<pkg.version>+<git-short-sha>`.
 */
export function getBakedVersion(): string {
  // `__APP_VERSION__` is replaced at build time. In dev/test it can
  // be undefined when the test harness skips Vite — fall back to a
  // sentinel that never matches the deployed version, so the check
  // returns "outdated:false" rather than crashing on undefined.
  if (typeof __APP_VERSION__ === "undefined") return "dev";
  return __APP_VERSION__;
}

/**
 * Fetch the deployed version from `/version.json`. Returns null on
 * any failure (network, 404, parse, missing field) — caller treats
 * null as "couldn't check, leave UI alone".
 */
export async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch(VERSION_JSON_PATH, {
      cache: "no-store",
      // Same-origin, no credentials needed; keeps it lean.
      credentials: "omit",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string" || body.version.length === 0) {
      return null;
    }
    return body.version;
  } catch {
    return null;
  }
}

/**
 * Returns true when the deployed version differs from the baked one.
 * `null` (couldn't fetch) → `false` so the banner stays hidden when
 * we can't confirm.
 */
export function isOutdated(deployed: string | null, baked: string): boolean {
  if (!deployed) return false;
  if (baked === "dev") return false;
  return deployed !== baked;
}

interface MonitorOptions {
  /** Called once on first detected mismatch. The monitor stops after this fires. */
  onOutdated: (deployedVersion: string) => void;
  /** Override poll interval for tests. */
  intervalMs?: number;
}

interface MonitorHandle {
  stop: () => void;
}

/**
 * Start monitoring. Polls `/version.json` on the chosen interval and
 * additionally whenever the tab regains visibility / focus (so a tab
 * that was backgrounded for a day surfaces the prompt right away on
 * return rather than waiting up to a full poll interval).
 *
 * Idempotent against multiple invocations of `onOutdated` — fires
 * exactly once, then the monitor goes quiet. Whoever owns the banner
 * keeps the version in state and dismisses it on user action.
 */
export function startVersionMonitor(opts: MonitorOptions): MonitorHandle {
  const baked = getBakedVersion();
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const fire = (deployed: string) => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onFocus);
    opts.onOutdated(deployed);
  };

  const checkOnce = async () => {
    if (stopped) return;
    const deployed = await fetchDeployedVersion();
    if (deployed && isOutdated(deployed, baked)) fire(deployed);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void checkOnce();
  };
  const onFocus = () => void checkOnce();

  // Initial check is deferred a tick so the function returns a handle
  // synchronously (lets the caller cancel cleanly in tests).
  queueMicrotask(checkOnce);
  timer = setInterval(checkOnce, intervalMs);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    },
  };
}
