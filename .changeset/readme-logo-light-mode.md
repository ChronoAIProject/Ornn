---
"ornn-web": patch
---

Fix the README hero logo washing out on GitHub light mode. The static `ornn-web/public/logo.svg` had the wordmark fill hardcoded to `#F1ECDE` (parchment / dark-theme `text-strong`), so the "rnn" letters barely read against GitHub's default near-white page background. The website itself never had this problem — its inline `Logo.tsx` uses `fill="currentColor"` and inherits the surrounding text color, so it lands on obsidian on light themes and parchment on dark.

Split into two static variants and wire the README through GitHub's recommended `<picture>` + `prefers-color-scheme` pattern:

- `ornn-web/public/logo-light.svg` — wordmark in obsidian `#14130E`, served as the default `<img>` for GitHub light
- `ornn-web/public/logo-dark.svg` — wordmark in parchment `#F1ECDE` (the original artwork), served when the viewer is on GitHub dark
- README's hero `<img>` becomes a `<picture>` with both sources

Result is README-website parity: same wordmark color in the same viewer-theme context on both surfaces. `logo.svg` had no other consumer (favicon ships separately as `favicon.png`; `index.html` doesn't reference it), so the rename has no runtime impact.

Closes #365.
