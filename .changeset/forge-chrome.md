---
"ornn-web": minor
---

refactor(web): Editorial Forge migration — Phase B, global chrome + token remap (#205). Legacy `neon-*` / `bg-deep` / `text-text-primary` / `font-heading` / `font-body` Tailwind tokens are remapped to Editorial Forge values directly inside `@theme` so every existing component using those classes adopts the Editorial Forge palette + Fraunces / Inter typography automatically. Sanitizes legacy helper classes (`.glass`, `.scanlines`, scrollbar, focus ring, markdown body, hljs syntax highlight) and migrates `RootLayout` breadcrumb + `Navbar` nav-button typography to Inter / mono per DESIGN.md.
