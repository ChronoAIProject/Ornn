# Design System — Ornn

## Product Context
- **What this is:** Skill-as-a-Service platform. Users create, publish, search, and execute AI skills (packaged prompts + scripts) via web UI or API.
- **Who it's for:** AI agent developers, teams building agent workflows, platform integrators.
- **Space/industry:** Developer tools, AI infrastructure, agent frameworks.
- **Project type:** Web app (dashboard + marketplace + playground) with future CLI/SDK.

## Aesthetic Direction
- **Direction:** Industrial Forge — dark surfaces, molten accents, tech typography. The "Ornn" name (League of Legends forge master) is the metaphor. The product should feel like a tool being forged, not a marketing page.
- **Decoration level:** Intentional — glass morphism on cards/panels, subtle dot-grid background pattern, forge-orange glow on interactive elements. No scanlines (deprecated). No decorative blobs or generic gradients.
- **Mood:** Professional but with personality. Dark, warm, precise. The visual language says "this is where serious tools are made."
- **Anti-patterns to avoid:** Purple/violet gradients, 3-column icon grids with colored circles, centered-everything layouts, uniform bubbly border-radius, generic stock-photo hero sections.

## Typography
- **Display/Hero:** Orbitron — Geometric, tech, uppercase-native. Used for headings, nav items, section titles, and anywhere the brand voice is loudest. Load weights: 400, 500, 600, 700, 800, 900.
- **Body:** Rajdhani — Readable with a tech edge. Sharp terminals and clean geometry pair well with Orbitron. Used for body text, descriptions, form labels, and all general content. Load weights: 300, 400, 500, 600, 700.
- **UI/Labels:** Same as body (Rajdhani).
- **Data/Tables:** JetBrains Mono with `font-variant-numeric: tabular-nums` for aligned columns.
- **Code:** JetBrains Mono — Industry standard. Used for code blocks, skill names, execution IDs, API paths. Load weights: 400, 500, 600.
- **Loading:** Google Fonts CDN (`https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@300;400;500;600;700&display=swap`)
- **Scale:**

| Token | Size | Usage |
|-------|------|-------|
| xs | 11px | Badges, labels, fine print |
| sm | 13px | Secondary text, captions, metadata |
| base | 15px | Body text (default reading size) |
| lg | 18px | Lead paragraphs, card descriptions |
| xl | 22px | Section headings in content areas |
| 2xl | 28px | Subsection headings |
| 3xl | 36px | Page-level headings |
| 4xl | 48px | Landing section headings |
| hero | 64px | Hero headline only |

## Color
- **Approach:** Restrained but warm. Orange is the brand. Everything else supports it.

### Forge Accents
| Token | Hex | Usage |
|-------|-----|-------|
| forge-primary | `#FF6B00` | CTAs, active states, brand moments, links |
| forge-ember | `#FF8C38` | Hover states, secondary actions, blockquote borders |
| forge-gold | `#FFB800` | Warnings, highlights, premium/version indicators |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| forge-green | `#39FF14` | Success states, active/audited badges |
| forge-red | `#FF003C` | Error states, danger actions, risky badges |

### Surfaces (Dark Mode — Default)
| Token | Hex | Usage |
|-------|-----|-------|
| bg-deep | `#0A0A0F` | Page background, code blocks, deepest layer |
| bg-surface | `#131313` | Cards, panels, nav bars |
| bg-elevated | `#1E1E1E` | Hover states, elevated cards, dropdowns |
| text-primary | `#E8E8E8` | Main text |
| text-muted | `#7A7A7A` | Secondary text, placeholders, metadata |

### Surfaces (Light Mode)
| Token | Hex | Usage |
|-------|-----|-------|
| bg-deep | `#FAFAFA` | Page background |
| bg-surface | `#FFFFFF` | Cards, panels |
| bg-elevated | `#F3F3F5` | Hover states, elevated surfaces |
| text-primary | `#2D2D2D` | Main text |
| text-muted | `#888888` | Secondary text |
| forge-primary | `#D45A00` | Darkened for WCAG contrast on light bg |
| forge-ember | `#C06000` | Darkened |
| forge-gold | `#B38200` | Darkened |
| forge-green | `#1A8C0A` | Darkened |
| forge-red | `#D42020` | Darkened |

### Glass Morphism
- Dark: `background: rgba(19, 19, 19, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(255, 107, 0, 0.12);`
- Light: `background: rgba(255, 255, 255, 0.92); border: 1px solid rgba(0, 0, 0, 0.08);`
- Hover (dark): `border-color: rgba(255, 107, 0, 0.35); box-shadow: 0 0 15px rgba(255, 107, 0, 0.15);`

### Glow Effects
- Text glow: `text-shadow: 0 0 8px rgba(255, 107, 0, 0.5);` (dark mode only)
- Border glow: `box-shadow: 0 0 5px #FF6B0044, inset 0 0 5px #FF6B0022;`
- Focus glow: `box-shadow: 0 0 0 2px #FF6B00, 0 0 10px #FF6B0044;`
- Shimmer: linear-gradient with `rgba(255, 107, 0, 0.05/0.12)` stops

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — not cramped, not wasteful. Developer tools need data density without feeling like a spreadsheet.

| Token | Value | Usage |
|-------|-------|-------|
| 2xs | 2px | Hairline gaps, tight badge padding |
| xs | 4px | Icon-to-text gap, minimal padding |
| sm | 8px | Intra-component padding, small gaps |
| md | 16px | Standard component padding, card padding, grid gaps |
| lg | 24px | Section internal padding, card gap |
| xl | 32px | Section separation, major component padding |
| 2xl | 48px | Page section padding |
| 3xl | 64px | Hero padding, major section breaks |

## Layout
- **Approach:** Grid-disciplined for app pages. Creative treatment only on landing/marketing.
- **Grid:** 12-column responsive. Breakpoints: sm(640px) md(768px) lg(1024px) xl(1280px)
- **Max content width:** 1200px (app pages), full-width for landing hero
- **Sidebar:** 240px fixed width when present
- **Two-column split:** 40/60 for playground (chat/preview), 50/50 for detail pages

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Badges, inline code, small elements |
| md | 8px | Buttons, inputs, small cards |
| lg | 12px | Cards, panels, modals |
| xl | 16px | Large containers, mockup frames |
| full | 9999px | Avatars, pills, circular buttons |

## Motion
- **Approach:** Intentional — Framer Motion for orchestrated animations, CSS transitions for micro-interactions. Motion should communicate state changes, not entertain.
- **Library:** Framer Motion (React), CSS transitions (micro-interactions)

### Easing
| Context | Easing |
|---------|--------|
| Enter / appear | ease-out |
| Exit / dismiss | ease-in |
| Move / reposition | ease-in-out |

### Duration
| Token | Value | Usage |
|-------|-------|-------|
| micro | 100ms | Button press feedback, toggle switches |
| short | 200ms | Hover effects, border/shadow transitions, focus rings |
| medium | 350ms | Page transitions, card hover lift, panel open/close |
| long | 500ms | Stagger reveals, complex layout shifts |

### Patterns
- **Card hover:** `transform: translateY(-2px)` + glow intensify on `duration-short`
- **Button hover:** `transform: translateY(-1px)` + shadow increase on `duration-short`
- **Page transition:** Fade + slight Y translate, `duration-medium`, orchestrated via Framer Motion `PageTransition` component
- **List stagger:** 50ms stagger between items, each item fades in + translates Y on `duration-short`
- **Skeleton shimmer:** Linear gradient sweep at 1.5s cycle

## CSS Variable Migration Plan

Current CSS uses `neon-*` naming which is misleading (`neon-cyan` = orange). Migrate to `forge-*` naming:

| Current | Target |
|---------|--------|
| `--color-neon-cyan` | `--color-forge-primary` |
| `--color-neon-magenta` | `--color-forge-ember` |
| `--color-neon-yellow` | `--color-forge-gold` |
| `--color-neon-green` | `--color-forge-green` |
| `--color-neon-red` | `--color-forge-red` |

All Tailwind utility classes (`text-neon-cyan`, `bg-neon-cyan/15`, `border-neon-cyan/20`, etc.) must be updated across all frontend files. This is a breaking change — do it in a single PR with find-and-replace.

## Deprecated Patterns

- **Scanlines:** The `.scanlines` CSS class and its `::after` overlay are deprecated. Remove from all components. The forge metaphor is carried by color and typography, not by CRT-era visual noise.
- **`neon-*` variable names:** See migration plan above.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-14 | Initial design system created | Codified existing visual identity from `neon.css` and component analysis via /design-consultation |
| 2026-04-14 | Formalized type scale (9 levels) | Existing codebase used ad-hoc font sizes. Standardizing for consistency as product grows |
| 2026-04-14 | Formalized spacing scale (4px base, 8 levels) | Standardize spacing across components. 4px base matches existing patterns |
| 2026-04-14 | Formalized border radius scale (5 levels) | Existing code mixed inline values. Standardize for visual consistency |
| 2026-04-14 | Formalized motion duration scale (4 levels) | Consistent animation timing across all interactive elements |
| 2026-04-14 | Deprecated scanlines | CRT-era reference adds noise, conflicts with forge aesthetic |
| 2026-04-14 | Planned neon-* to forge-* CSS variable rename | Current naming is misleading (neon-cyan = orange). Semantic naming improves DX |
| 2026-04-14 | Kept Orbitron + Rajdhani + JetBrains Mono | Distinctive pairing, well-established in codebase, fits forge aesthetic |
| 2026-04-14 | Kept #FF6B00 orange as primary | Unique in dev tools space (most use blue/green/purple). Strong brand differentiator |
