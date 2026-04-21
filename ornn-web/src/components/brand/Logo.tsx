/**
 * Ornn wordmark — picks the dark-mode or light-mode SVG based on the
 * current theme. Kept as a thin component so the 4 nav/login touch
 * points stay one-line swaps.
 *
 * Asset naming mirrors the background it's meant to sit on:
 *   - `logo-dark.svg`  → white "rnn" text, use on dark backgrounds.
 *   - `logo-light.svg` → dark-grey "rnn" text, use on light backgrounds.
 */

import { useThemeStore } from "@/stores/themeStore";

export interface LogoProps {
  /** Optional Tailwind class set (sizing, margin, etc.). */
  className?: string;
  /** Alt text override — defaults to "ORNN". */
  alt?: string;
}

/**
 * Cache-bust version stamp. Bump when swapping the underlying SVGs so
 * browsers (and our CDN, if any) refetch instead of serving a stale
 * copy after a logo redesign. All logo consumers import this Logo
 * component, so bumping here fans out to every render site.
 */
const LOGO_VERSION = "12";

export function Logo({ className = "", alt = "ORNN" }: LogoProps) {
  const theme = useThemeStore((s) => s.theme);
  const src = theme === "dark" ? "/logo-dark.svg" : "/logo-light.svg";
  return <img src={`${src}?v=${LOGO_VERSION}`} alt={alt} className={className} />;
}
