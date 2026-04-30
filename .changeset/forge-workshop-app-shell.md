---
"ornn-web": minor
---

feat(web): apply Forge Workshop v3 design language to the entire app shell + ship landing-nav avatar dropdown.

Landing v3 ships shared visual language to every component and page in the app shell, so the registry, build flows, skill detail, playground, settings, admin, and auth pages all read in the same Space Grotesk display + Inter body + JetBrains Mono operational vocabulary. Cards, buttons, and panels now press DOWN under hover via letterpress impression shadows; the legacy soft drop shadows, glow halos, hover-lift, and Fraunces display from the Editorial Forge era are retired everywhere outside the landing page (landing surfaces keep their own design contract).

Also ships the landing-nav avatar dropdown so authenticated users see the same identity anchor on the landing surface that they get inside the app — profile / services / orgs / NyxID portal / admin / sign out.

Both dark and light modes are covered. `bun run build` and `tsc --noEmit` are clean across the seven-commit migration.
