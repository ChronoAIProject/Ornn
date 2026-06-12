/**
 * Display-percentage helper shared by QuotaSummary + QuotaInline.
 *
 * #629 — the old `Math.round((used / ceiling) * 100)` could promote
 * `99.5%` (e.g. `used=199, ceiling=200`) to `100%` even though
 * `remaining=1`. The chip / "X remaining" copy next to it then
 * contradicted the banner ("100% used this month" + "1 Playground
 * calls left"). Pin the displayed percent so 100 never appears while
 * any quota remains.
 *
 * @module components/quota/quotaDisplay
 */

/**
 * Compute the integer percent to render in chrome ("100% used", the
 * progress bar fill, etc.).
 *
 * Contract:
 *   - 0 when ceiling is non-positive (nothing meaningful to show).
 *   - `100` only when `remaining <= 0`. Below that, the result is
 *     clamped to `[0, 99]` so the banner never claims "100% used"
 *     while a call is still allowed.
 *   - Always `Math.floor` so a usage of `99.5%` reads as `99%`, not
 *     a misleading `100%`.
 */
export function displayUsagePercent(
  used: number,
  ceiling: number,
  remaining: number,
): number {
  if (ceiling <= 0) return 0;
  if (remaining <= 0) return 100;
  const raw = (used / ceiling) * 100;
  return Math.max(0, Math.min(99, Math.floor(raw)));
}
