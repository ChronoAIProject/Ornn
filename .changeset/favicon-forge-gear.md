---
"ornn-web": patch
---

Replace the old `favicon.png` with the Forge-gear mark on a transparent background. The pre-redesign favicon was a 64×64 RGB PNG (no alpha) with a solid plate baked in; it no longer matched the wordmark `Logo.tsx` renders in the navbar and read as an opaque tile against any non-matching browser-tab chrome.

- New `ornn-web/public/favicon.svg` — single ember `#FF7322` gear path lifted from `logo-light.svg`, transparent background, 64×64 viewBox. The primary favicon for modern browsers.
- New `ornn-web/public/favicon.png` — 64×64 RGBA rendered from the SVG via `rsvg-convert` so the transparent background carries through. Fallback for legacy clients that don't honor `type="image/svg+xml"`.
- `ornn-web/index.html` lists both `<link rel="icon">` tags with SVG first; cache-bust bumped `?v=12` → `?v=13` so existing browser caches refetch.

Closes #367.
