# Editorial Forge Design Language - Ornn

## Product Context
- **What this is:** A Skill-as-a-Service platform for discovering, installing, publishing, and operating AI agent skills through a web UI, docs, and API-adjacent tooling.
- **Who it is for:** Agent developers, platform builders, technical teams, and operators who expect tools to feel composed and credible rather than playful or trend-driven.
- **Scope of this document:** Whole app, landing-led. The landing page is the flagship expression, and app shell, registry, docs, admin, forms, and data views inherit the same language.
- **Canonical source of truth:** **This document is canonical.** It defines the intended state of the design system. Two reference builds are kept aligned with it for visual sanity-checking:
  - `design-preview/Ornn-Landing-v3.html` (deployed at `chrono-ornn.surge.sh/Ornn-Landing-v3.html`) — standalone Forge Workshop reference
  - The live ornn-web implementation (deployed at `chrono-ornn-web.surge.sh`) — production application
- **When this doc and an implementation disagree, the implementation is wrong.** Bring the implementation back into alignment, then re-verify the build. Do not silently update DESIGN.md to match drifted code; instead, propose the change explicitly (PR description: "DESIGN.md change + impl follows" or "DESIGN.md unchanged, impl regression fix"). This protects the system from lossy round-trips between code and doc.

## Design Thesis
Ornn should feel like a registry, workshop, and publishing desk for skills. The product is not a generic SaaS dashboard and not a cyberpunk toy. Its visual language is a controlled blend of:

- **Paper:** editorial warmth, legible reading surfaces, quiet hierarchy
- **Metal:** forged structure, thin separators, instrument-like controls
- **Ember:** selective heat, action emphasis, and directional energy

The result should read as warm, tactile, precise, industrial, and composed. Interfaces should feel authored, not templated.

## Differentiation Guardrails

Ornn ships in the same era as Anthropic Claude and several other AI products that share a recognizable visual vocabulary: warm parchment background (~`#F0EEE6`), italic serif display, soft clay-orange brand color, generous editorial whitespace, light-first marketing pages. **Ornn's surface intentionally steers away from that vocabulary** — not because Claude is wrong, but because Ornn is a different stance: a registry / workshop / tool, not a thinking partner. The brand metaphor is forge / industrial publication, not editorial paper. The user is a builder doing technical work, not a reader doing reflection.

This section is **testable rules**, not aspiration. PRs that touch landing surfaces are reviewed against these.

### Banned visual combination
**Warm parchment background + italic serif display + soft drop shadows is the Claude marketing-page silhouette.** Any landing surface that reads as all three at once fails review regardless of color values. This is the load-bearing rule; everything below is a refinement of it.

### Allowed background ranges (light mode)
Light-mode page background must satisfy `B ≥ G ≥ R` (cool or neutral, never warm). Listed allowed values:

- `#EAECEC` (default — matches v3 reference build)
- `#EBEDEA`, `#EDEEEB` (variant cool-neutral)

Forbidden: anything with `R > B` by more than 2 points (warm cream territory like `#F5EFE1`, `#F0EEE6`, `#F4F4F1`).

### Type role rules
- **Display** is Space Grotesk Bold UPPERCASE on landing surfaces. Italic Fraunces is **deprecated for new landing surfaces** and may not be reintroduced. Fraunces persists on app shell during a separate migration.
- Hero / section titles / comparison headlines / final CTAs use the new display only.
- Highlighter mark on selected nouns (translucent ember or arc-blue rectangular wash with hand-applied edges) is the brand emphasis treatment that replaces the legacy italic-Fraunces-ember signature.

### Shadow rules
- **No** soft drop shadows (`0 Xpx Ypx Zpx rgba(...)`) on cards, panels, or CTAs.
- Cards use `--card-shadow-rest` / `--card-shadow-hover` component tokens.
- Buttons use `--button-primary-shadow-rest` / `-hover` / `-active` component tokens.
- **Inline arbitrary shadow strings in JSX/className are a review-blocker.** Centralize via tokens.

### Hover behavior rule
Buttons and cards **press DOWN** on hover (translate `+2px / +2px`, shadow shrinks). They do NOT lift up. The press metaphor is mandatory on the landing — re-introducing hover-lift is a review-blocker.

### Brand color rule
- Primary brand accent stays **ember orange**. This is the action voice.
- **Arc-blue** (welding light) is permitted as a **secondary diagrammatic accent only** — bracketed labels, dim-rule end caps, hover-arc variants, status-info pings. Never as primary CTA fill, never as a gradient wash, never as a default decorative tint. This relaxes the prior "no purple, blue, or rainbow tech gradients" anti-pattern just for arc-blue at this restricted role.

### Pre-merge requirement
Every PR touching landing visuals attaches dark+light × desktop+mobile screenshots in the PR description. **No screenshots = no merge.** Reduced-motion check is also required where motion is changed.

### Reference builds (sanity-check artifacts, not authority)
Two builds are kept aligned with this document and used to visually verify what the doc prescribes:

- `design-preview/Ornn-Landing-v3.html` — standalone Forge Workshop reference (deployed at `chrono-ornn.surge.sh/Ornn-Landing-v3.html`)
- The live ornn-web implementation (deployed at `chrono-ornn-web.surge.sh`)

These are **snapshots of intent**, not authority. **When this doc and a build disagree, the build is wrong** — bring the build back into alignment, then re-verify (see "Canonical source of truth" in Product Context).

## Core Visual Language
### Principles
- **Editorial first:** Use typography, spacing, and alignment to create hierarchy before reaching for effects.
- **Material contrast:** Build the UI from paper, ink, metal, and ember relationships rather than flat neutral gray layers.
- **Operational clarity:** Controls, metadata, and system affordances should feel exact and tool-like.
- **Restrained heat:** Ember is the brand accent. It should be specific and intentional, not sprayed across the interface.
- **Landing-led, app-safe:** The landing page may be cinematic. Core app screens should stay disciplined and fast to read.

### Signature Traits
- **Cool steel-paper backgrounds in bright mode** (`#EAECEC` family, B≥G≥R), forged-metal surfaces in dark mode
- **Space Grotesk Bold UPPERCASE display** with the hand-applied highlighter mark on emphasis nouns (replaces the legacy Fraunces italic-ember signature on landing)
- Inter for product reading surfaces and general UI copy
- JetBrains Mono for controls, metadata, search, code, operational labels, and bracketed section labels (`[§ XX — NAME]`)
- **Letterpress hard-offset shadows** on cards / buttons / panels — never soft drop shadows, never glow halos
- **Press-down hover** on interactive surfaces (translate INTO impression) — never hover-lift
- Hairline dividers, tight radii (2-4px default), welded-seam section dividers with rivet dots + ember+arc accent bars
- Drafting-paper signaling on light-mode landing — page-edge dimension rulers + blueprint grid backdrop + page-corner registration crosshairs
- Bi-tonal accent identity — ember orange (action voice, primary) paired with arc-blue (system / diagrammatic, restricted secondary)
- Localized glow, wire, and pulse effects used as accents rather than baseline decoration

### Anti-Patterns
- No cyberpunk language or sci-fi chrome as the primary voice
- No Orbitron or Rajdhani as the forward-looking type system
- No generic glassmorphism as the default surface treatment
- No purple or rainbow tech gradients. **Blue is permitted ONLY as arc-blue at the secondary diagrammatic role** per Brand color rule above (never primary CTA, never gradient wash)
- No oversized pill-heavy SaaS cards or bubbly border radius
- No decorative noise unless it directly supports the forge metaphor
- No glow-heavy interfaces where every active element appears electrified
- **No warm parchment / cream backgrounds on landing** — the cool steel-paper field is load-bearing for differentiation from Anthropic Claude's marketing surface
- **No hover-lift on landing buttons or cards** — letterpress press-down is mandatory
- **No inline arbitrary `shadow-[…]` Tailwind values on cards/CTAs** — use `--card-shadow-*` and `--button-primary-shadow-*` tokens

## Token Architecture
Use a three-layer token system moving forward:

1. **Primitive tokens:** Raw material values such as paper, metal, ember, and spacing units
2. **Semantic tokens:** Role-based aliases such as page background, strong text, panel border, and brand accent
3. **Component tokens:** Component-specific tokens for buttons, panels, tables, forms, nav, and docs surfaces

Material names belong only to the primitive layer. Future implementation should stop introducing `neon-*` names as long-term tokens. Semantic and component layers should be role-based.

### Primitive Tokens
These are the base material values extracted from the reference system. They are theme-scoped primitives rather than cross-theme semantic aliases.

| Token | Dark | Bright | Usage Intent |
|-------|------|--------|--------------|
| `obsidian` | `#0B0907` | `#EAECEC` | deepest material in each theme family. Light is **cool steel paper** (B ≥ G > R), not warm parchment — see Differentiation Guardrails |
| `graphite` | `#14110B` | `#DCDFDF` | structural panels and bands |
| `iron` | `#221E16` | `#CECECE` | elevated surfaces and internal framing |
| `steel` | `#3A3328` | `#B8B8B8` | hard edges, hardware, and trim |
| `ash` | `#6B6254` | `#7E776B` | metadata and low-emphasis text |
| `bone` | `#C9BFAD` | `#4A453B` | body reading tone |
| `parchment` | `#F1ECDE` | `#14130E` | strongest text and ink contrast |
| `ember` | `#FF7322` | `#D9461A` | primary accent and action color (brand) |
| `ember-dim` | `#C9460D` | `#B33912` | lower-heat accent state, also press-shadow color on primary CTAs |
| `ember-deep` | `#7A2308` | `#6E2207` | deep burnt-sienna for letterpress card-shadow impression. Light is slightly deeper for paper contrast |
| `molten` | `#E8B341` | `#B8861A` | secondary warmth, highlights, and supporting emphasis |
| `arc` | `#5BC8E8` | `#2B7791` | **secondary diagrammatic accent** — welding-arc blue, "the cool side of the forge". See brand color rule in Differentiation Guardrails — restricted role only |
| `arc-dim` | `#3A8FB8` | `#1A5670` | lower-temperature arc state |
| `line` | `rgba(201,191,173,0.12)` | `rgba(20,19,14,0.08)` | subtle borders and separators |
| `line-strong` | `rgba(201,191,173,0.22)` | `rgba(20,19,14,0.18)` | stronger borders and control edges |
| `line-stronger` | `rgba(201,191,173,0.34)` | `rgba(20,19,14,0.40)` | rivet dots, welded-seam markers, hard separators |

### Specialized Primitive Tokens
These exist for specific reference behaviors and should not be overused outside their intended context.

| Token | Dark | Bright | Usage Intent |
|-------|------|--------|--------------|
| `page-bg` | `#0B0907` | `#EAECEC` | page-level background — cool steel paper in light mode (must satisfy B≥G≥R per Differentiation Guardrails) |
| `wire-glow` | `rgba(255,115,34,0.30)` | `rgba(217,70,26,0.22)` | landing wires, pulse accents, hero floor radial — ember at low opacity |
| `arc-glow` | `rgba(91,200,232,0.28)` | `rgba(43,119,145,0.22)` | secondary diagrammatic glows — bracketed labels, dim-rule end caps, status-info pings |
| `grain-opacity` | `0.08` | `0.05` | subtle film grain only where explicitly called for |

### Semantic Tokens
Semantic tokens describe role, not material. These are the names future implementation should standardize on.

| Semantic Role | Dark | Bright | Usage |
|---------------|------|--------|-------|
| `color-page-bg` | `#0B0907` | `#EAECEC` | page background — cool steel paper in light mode (no warm cream) |
| `color-surface-panel` | `#14110B` | `#DCDFDF` | bands, nav strips, footer, section backing |
| `color-surface-card` | `#1A1610` | `#FFFFFF` | cards, drawers, list containers |
| `color-surface-elevated` | `#221E16` | `#EDEFEF` | highlighted or lifted surfaces |
| `color-text-strong` | `#F1ECDE` | `#14130E` | headings, primary controls, strong text |
| `color-text-body` | `#C9BFAD` | `#4A453B` | paragraphs and standard UI copy |
| `color-text-meta` | `#6B6254` | `#7E776B` | metadata, helper text, low-priority labels |
| `color-accent-primary` | `#FF7322` | `#D9461A` | primary action and brand accent |
| `color-accent-muted` | `#C9460D` | `#B33912` | lower-heat accent, hover dim, and press-shadow color on primary CTAs |
| `color-accent-support` | `#E8B341` | `#B8861A` | secondary warmth, molten gold highlights |
| `color-accent-secondary` | `#5BC8E8` | `#2B7791` | **secondary diagrammatic accent** (arc-blue / welding light). Restricted role per Differentiation Guardrails — never primary CTA, never gradient wash |
| `color-shadow-press` | `rgba(0,0,0,0.55)` | `rgba(110,34,7,0.13)` | letterpress hard-offset card shadow impression |
| `color-border-subtle` | `rgba(201,191,173,0.12)` | `rgba(20,19,14,0.08)` | hairlines and quiet dividers |
| `color-border-strong` | `rgba(201,191,173,0.22)` | `rgba(20,19,14,0.18)` | stronger separators and control frames |
| `color-border-stronger` | `rgba(201,191,173,0.34)` | `rgba(20,19,14,0.40)` | rivet dots, welded-seam markers |
| `color-wire-glow` | `rgba(255,115,34,0.30)` | `rgba(217,70,26,0.22)` | wire, pulse, and guided motion accents |
| `color-code-surface` | `#08070A` | `#14110B` | terminal and code-chrome surfaces (deliberately stays dark in both themes) |

### Semantic State Tokens
State color should stay within the editorial forge palette family. Avoid bright consumer-app greens and reds. Supporting states should feel mineral, muted, and credible beside ember.

| State Role | Dark | Bright | Usage |
|------------|------|--------|-------|
| `color-state-success` | `#7FA06A` | `#5F7A46` | success text, confirmations, positive status |
| `color-state-success-bg` | `rgba(127,160,106,0.12)` | `rgba(95,122,70,0.10)` | quiet success fills and badges |
| `color-state-warning` | `#E8B341` | `#A97818` | warnings, cautions, review-needed states |
| `color-state-warning-bg` | `rgba(232,179,65,0.12)` | `rgba(169,120,24,0.10)` | warning tint backgrounds |
| `color-state-danger` | `#C96B5A` | `#9E4E42` | destructive actions, errors, irreversible states |
| `color-state-danger-bg` | `rgba(201,107,90,0.12)` | `rgba(158,78,66,0.10)` | danger tint backgrounds |
| `color-state-info` | `#8A97A3` | `#5D6973` | informational guidance and neutral status |
| `color-state-info-bg` | `rgba(138,151,163,0.12)` | `rgba(93,105,115,0.10)` | info tint backgrounds |
| `color-state-disabled-text` | `rgba(201,191,173,0.45)` | `rgba(26,24,18,0.38)` | disabled text and icons |
| `color-state-disabled-surface` | `rgba(201,191,173,0.06)` | `rgba(26,24,18,0.05)` | disabled surfaces |

Rules:
- Success should read as oxidized metal or moss, not neon green.
- Warning should stay in the brass or molten family.
- Danger should feel kiln-red or fired clay, not saturated app-red.
- Info should read as tempered steel, never bright blue.
- State color must not be the only signal. Pair it with copy, iconography, shape, or border treatment.

### Component Token Guidance
Each component family should expose its own tokens by referencing the semantic layer.

```css
/* Button — per-state letterpress shadows + explicit focus ring.
   Press-down hover/active mandatory; resting carries the impression. */
--button-primary-bg:            var(--color-accent-primary);
--button-primary-fg:            var(--color-page-bg);
--button-primary-border:        var(--color-accent-muted);
--button-primary-shadow-rest:   4px 4px 0 0 var(--color-accent-muted);
--button-primary-shadow-hover:  2px 2px 0 0 var(--color-accent-muted);
--button-primary-shadow-active: 0 0 0 0 transparent;
--button-ghost-border:          var(--color-border-strong);
--button-ghost-fg:              var(--color-text-strong);
--button-ghost-shadow-rest:     3px 3px 0 0 var(--color-border-stronger);
--button-ghost-shadow-hover:    1.5px 1.5px 0 0 var(--color-accent-primary);
--button-focus-ring:            0 0 0 2px var(--color-page-bg), 0 0 0 4px var(--color-accent-primary);

/* Card / Panel — letterpress impression shadow.
   No soft drop shadows; never inline arbitrary shadow strings. */
--card-bg:           var(--color-surface-card);
--card-border:       var(--color-border-strong);
--card-shadow-rest:  5px 5px 0 0 var(--color-shadow-press), inset 0 0 0 1px var(--color-border-subtle);
--card-shadow-hover: 2px 2px 0 0 var(--color-shadow-press), inset 0 0 0 1px var(--color-border-strong);

/* Input */
--input-bg:     var(--color-surface-card);
--input-border: var(--color-border-subtle);
--input-focus:  var(--color-accent-primary);

/* Table */
--table-row-border:    var(--color-border-subtle);
--table-row-active-bg: color-mix(in srgb, var(--color-accent-primary) 8%, transparent);
```

#### State + interaction contract for Buttons and Cards
- **Resting:** carries the press shadow always.
- **Hover:** `transform: translate(2px, 2px)` AND swap shadow to `-hover` value. Visually, the element presses INTO the impression. Hover-lift (negative Y translate or ascending shadow) is a review-blocker on landing.
- **Active:** continues translating to `(4px, 4px)`, shadow → transparent. Fully sunk.
- **Focus-visible:** stacks `--button-focus-ring` ON TOP of the press-state shadow. The ring uses an outer page-color halo + 2px ember outer ring so it's visible regardless of which press state is active.
- **Disabled:** removes the press shadow entirely, replaces with `inset 0 0 0 1px var(--color-border-subtle)`, `opacity: 0.5`, `cursor: not-allowed`. **Disabled CTAs must NOT carry a press impression** — disabled-with-shadow misreads as actionable.
- **Reduced-motion (`@media (prefers-reduced-motion: reduce)`):** hover and active swap shadow only — no translate. The press is communicated through impression collapse, not movement.

### Implementation Posture
- **Tailwind is the implementation layer for all new UI work.** Layout, spacing, typography, borders, color, responsiveness, and state styling should all be expressed through Tailwind utilities and Tailwind-backed tokens.
- Keep the design language rooted in CSS variables and semantic tokens, then expose those tokens through Tailwind-friendly utilities and theme values.
- Prefer semantic utility usage over ad hoc one-off values.
- If a design need is repeated or important, extend the Tailwind theme rather than introducing standalone styling systems.
- If a reference-accurate value is missing, add it to the Tailwind token layer first instead of scattering arbitrary values through components.
- Inline styles should be rare and limited to runtime-calculated values that cannot reasonably be expressed through Tailwind utilities.

### Tailwind Contract
The goal is ease of change through a centralized utility vocabulary. New implementation work should standardize around semantic Tailwind-facing names such as:

- `bg-page`, `bg-panel`, `bg-card`, `bg-elevated`
- `text-strong`, `text-body`, `text-meta`
- `border-subtle`, `border-strong`
- `text-accent`, `bg-accent`, `border-accent`
- `text-success`, `text-warning`, `text-danger`, `text-info`
- `bg-success-soft`, `bg-warning-soft`, `bg-danger-soft`, `bg-info-soft`

If those utilities do not exist yet, extend the Tailwind theme or token definitions until they do. Do not solve system gaps with ad hoc styling conventions.

## Typography
### Font Roles
| Role | Typeface | Usage |
|------|----------|-------|
| **Display** | **Space Grotesk Bold UPPERCASE (700)** | hero lines, section titles, comparison headlines, all flagship type moments on landing surfaces |
| Body | `Inter` | paragraphs, forms, docs prose, app content, interface copy |
| Operational Mono | `JetBrains Mono` | controls, metadata, search prompts, install commands, code, tables, bracketed section labels (`[§ XX — NAME]`) |
| *Legacy display* (deprecated for landing) | `Fraunces` / PP Editorial New | retained for app-shell surfaces during migration. **Do not introduce on new landing surfaces.** Italic-Fraunces-ember emphasis is replaced by the Highlighter Mark pattern below |

### Type Rules
- **Space Grotesk Bold UPPERCASE is the display voice on landing.** Use `letter-spacing: -0.025em` and `line-height: 0.98`. It owns hero type moments, section h2s, and comparison headlines. Do not use it for dense UI controls or long reading passages.
- **Inter is the default product font.** Use it for all general interface reading surfaces, body copy, helper text, and form labels.
- **JetBrains Mono is the system voice.** Use it for buttons, micro-labels, stamps, counters, search prompts, status text, technical metadata, code, and data tables.
- **Fraunces is legacy** for landing surfaces. It may still appear on app-shell pages (docs, registry, admin) until a separate migration passes. Re-introducing italic Fraunces emphasis on landing is a review-blocker per Differentiation Guardrails.

### Signature Emphasis — Highlighter Mark
- The brand emphasis pattern on landing is a **hand-applied highlighter mark** wrapped around selected nouns: a translucent ember (or arc-blue, restricted role) rectangular wash sitting OVER the text with `mix-blend-mode: multiply` (light) or `screen` (dark). Asymmetric border-radius (`9px 14px 7px 11px / 11px 6px 14px 8px`-style) plus an SVG `feTurbulence` filter gives organic, hand-drawn edges. Slight rotate/skew variation per nth-of-type so adjacent marks don't read as stamped.
- This pattern **replaces** the legacy italic-Fraunces-ember signature for new landing surfaces.
- Mono uppercase micro-labels with increased letter spacing remain the default pattern for metadata, section markers, utility controls, and compact status affordances. Bracketed form `[§ XX — NAME]` is the section-label signature.

### Recommended Type Scale
| Token | Size | Typical Usage |
|-------|------|---------------|
| `type-micro` | `10px` | stamps, overlines, mono micro-labels |
| `type-meta` | `11px` | counters, metadata, table headers, install chrome |
| `type-sm` | `14px` | helper text, compact body, control copy |
| `type-body` | `16px` | default body and UI reading size |
| `type-lead` | `18px` | lead paragraphs and prominent body copy |
| `type-title-sm` | `24px` | small section titles and card titles |
| `type-title-md` | `32px` | large section titles |
| `type-title-lg` | `40px` to `56px` | landing section headlines |
| `type-hero` | `clamp(48px, 7vw, 104px)` | flagship landing headline only |

### Font Loading
Use a forward-looking stack based on the reference:

```text
Fraunces, Inter, JetBrains Mono
```

When loading from Google Fonts, match the reference behavior:
- Fraunces with italics and variable optical settings
- Inter at standard reading weights
- JetBrains Mono at 400, 500, and 600

## Theme Expression
The system is **light-first, dark-complete**.

### Bright Mode
Bright mode is the flagship brand expression. It should feel like **cool drafting paper laid out on a workbench under daylight** — outside Anthropic Claude's warm-cream marketing-page neighborhood by design (see Differentiation Guardrails). Not a white enterprise dashboard either.

| Area | Rule |
|------|------|
| Backgrounds | Cool steel-paper tones (`#EAECEC` family, B≥G≥R). **Never warm parchment / cream / `#F5EFE1`-family** — that's the banned Claude-adjacent gestalt |
| Surfaces | Light cool-paper panels, white cards (max contrast), lightly tinted elevated surfaces. Drafting overlay (page-edge dim rulers + blueprint grid backdrop) on landing |
| Text | Strong text uses ink-tone (`#14130E`); body stays warm-neutral, not pure black. The slight warm/cool tension between ink and paper is part of the drafting feel |
| Borders | Ink-tone hairlines (`rgba(20,19,14,…)` family), not generic medium-gray borders. `--color-border-stronger` for rivet dots and welded-seam markers |
| Accent | Ember shifts deeper (`#D9461A`) for paper contrast. Arc-blue at restricted secondary role only |
| Depth | **Hard-offset letterpress shadows on cards / CTAs** (deep ember impression at low opacity). No soft drop shadows. Press-down on hover, never lift |
| Glow | Keep glow subtle and rare; emphasis comes from contrast and hierarchy first. Ember-glow + arc-glow reserved for hero choreography and active states |
| Chrome | Page-corner registration crosshairs (4 viewport corners) and welded-seam section dividers carry the "printed object / industrial publication" signal |

### Dark Mode
Dark mode is the forged-metal counterpart. It should feel like the workshop at night, not a generic charcoal dashboard.

| Area | Rule |
|------|------|
| Backgrounds | Use obsidian, graphite, and iron with warm undertones |
| Surfaces | Panels should feel forged and weighty rather than translucent by default |
| Text | Strong text is parchment-toned; body text is bone-toned |
| Borders | Use thin warm separators, not bright strokes |
| Accent | Ember can be more radiant than in bright mode |
| Depth | Use localized shadow and glow for emphasis, not omnipresent neon bloom |
| Glow | Restrained and directional; reserve it for action, guided motion, and landing highlights |

### Shared Theme Rules
- Some surfaces may remain dark in both themes when the metaphor requires operational contrast:
  - terminal and code-chrome surfaces
  - install or command surfaces
  - selective contrast islands where high signal-to-noise matters
- Theme switching should feel like a material translation, not a simple inversion.
- The semantic role of each component must remain stable across themes even when the primitive values change.

### Accessibility and Interaction Guarantees
- Full keyboard accessibility is mandatory across the entire product.
- Full accessibility coverage is required for the landing experience. Other app surfaces must still preserve the baseline guarantees below even if deeper accessibility hardening is phased by priority.
- Body text and essential controls must target WCAG AA contrast against their surfaces in both bright and dark themes.
- Strong text, body text, borders, and muted text should each be chosen for role clarity, not only for visual subtlety.
- Hover cannot be the only affordance signal. Pair hover with icon shift, underline, edge change, tint, or copy.
- Focus-visible must be explicit on every interactive control. The default pattern is a clear ember-led focus treatment with enough separation from the component surface in both themes.
- Every interactive surface must be operable by keyboard alone, including navigation, menus, dialogs, forms, tables, and primary workflow actions.
- Touch targets should aim for at least `44px` by `44px` on mobile.
- Disabled, read-only, loading, success, warning, and danger states must be visually distinct and textually explicit.
- Error and validation patterns must pair state color with iconography or copy; never rely on color alone.
- Reduced-motion users should receive equivalent clarity without staged choreography, parallax, wire movement, or pulse-heavy emphasis.
- Responsive behavior is an accessibility requirement, not a visual enhancement.

### Accessibility Scope by Surface
- **Landing pages:** Require full accessibility treatment, including keyboard flow, focus order, semantic structure, meaningful alt text, reduced-motion behavior, readable contrast, screen-reader-friendly interaction design, and mobile usability.
- **Core app surfaces:** Keyboard operation, visible focus, essential contrast, responsive behavior, and explicit error or state communication are the baseline non-negotiables.
- **Internal or dense operational surfaces:** May phase deeper accessibility refinements over time, but cannot regress on keyboard access, focus visibility, or basic readability.

## Layout, Spacing, Borders, and Motion
### Layout
- Use a disciplined grid for app pages and a more expressive editorial composition for landing surfaces.
- Standard max content width is **1280px**.
- Use asymmetric editorial layouts when they create hierarchy, but keep registry, docs, admin, and forms highly legible.
- Favor generous section spacing over crowded card mosaics.

### Responsive System
Responsive behavior from desktop to mobile is mandatory for every surface.

| Breakpoint | Min Width | Intent |
|------------|-----------|--------|
| `base` | `0px` | mobile-first default |
| `sm` | `640px` | larger phones and compact tablets |
| `md` | `768px` | tablet and split-layout threshold |
| `lg` | `1024px` | desktop layout activation |
| `xl` | `1280px` | full editorial desktop width |

Rules:
- Design mobile-first. Every layout should be coherent at `base` before expanding upward.
- Multi-column layouts must collapse gracefully to single-column or stacked flows on small screens.
- Fixed side-by-side hero compositions should simplify on tablet and mobile rather than scaling down unchanged.
- Dense registry tables should either become horizontally scrollable with clear affordances or restack into card or row blocks on narrow screens.
- Top navigation must condense cleanly on mobile. Utility controls, theme toggle, and primary action should remain reachable without crowding.
- Section spacing should reduce with screen size, but never to the point that the interface feels cramped.
- Landing theatrics such as wires, chips, staged overlays, and complex mockups should reduce, restack, or disappear on smaller viewports if clarity suffers.
- Motion must scale down on mobile when it interferes with comprehension, performance, or input precision.
- Mobile horizontal padding for landing sections is standardized at `space-6` (24px). Every section, the nav, and the footer share the same gutter so the reading column is uniform from top to bottom.
- Landing scrubs that read as side-by-side on desktop (intro / mockup / rail) should re-compose vertically on mobile, not shrink. The mobile narrative is: banner above, primary mockup centered, supporting surface (registry/rail) below. The scrub mechanic re-orients with it — chips and wires emerge from the supporting surface's outer edge nearest the mockup, not from the side.

### Spacing
Use a 4px base scale.

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | `4px` | tight gaps and icon spacing |
| `space-2` | `8px` | micro layout and compact controls |
| `space-3` | `12px` | stacked metadata and small card internals |
| `space-4` | `16px` | standard control padding and body rhythm |
| `space-6` | `24px` | card padding and local section spacing |
| `space-8` | `32px` | component groups and panel interiors |
| `space-12` | `48px` | section spacing |
| `space-16` | `64px` | large section separation |
| `space-24` | `96px` | landing hero and major editorial breaks |

### Border Radius
The system is intentionally tighter than the prior app language.

| Token | Value | Usage |
|-------|-------|-------|
| `radius-2` | `2px` | buttons, chips, stamps, inline controls |
| `radius-3` | `3px` | inputs, small cards, install surfaces |
| `radius-4` | `4px` | panels, drawers, tables, larger cards |
| `radius-8` | `8px` | rare softened containers only when needed |
| `radius-object` | exceptional | reserved for device mockups and special objects, not app defaults |

Default bias: **2px to 4px**. Large radius is the exception, not the norm.

### Borders and Shadows
- Use 1px hairlines as the default separator language.
- Dashed dividers are allowed for metadata breaks, row rhythm, and technical sections.
- **Shadows should feel like a printing press impression on paper, not physical lift.** Hard-offset letterpress (`Npx Npx 0 0 <ember-deep|black>`) is the system default for cards / buttons / panels. Soft drop shadows (`0 Npx Npx Npx rgba(...)`) and glow halos are anti-patterns on landing.
- Prefer edge definition plus letterpress impression over blurred glow.

### Motion
Motion should communicate state and sequence, not spectacle.

| Token | Value | Usage |
|-------|-------|-------|
| `motion-micro` | `120ms` to `160ms` | button press, icon state, small control feedback |
| `motion-fast` | `180ms` to `220ms` | hover, border, and opacity changes |
| `motion-medium` | `300ms` to `380ms` | panel reveal, list transitions, emphasis change |
| `motion-slow` | `450ms` to `650ms` | hero choreography, staged reveals, cinematic transitions |

Rules:
- **Framer Motion is the preferred React motion system** for orchestrated UI behavior such as page transitions, staged reveals, shared layout transitions, modal entry and exit, and ordered list choreography.
- Use Tailwind transition and animation utilities for micro-interactions, simple hover and focus states, and lightweight ambient motion.
- App motion should be crisp, quiet, and task-supportive.
- Landing motion may include staged reveals, wire pulses, chips, and scroll-scrub choreography.
- Ember glow pulses and wire animations are accent behaviors, never baseline defaults for the whole product.
- Motion timing should map back to the token ranges above whether implemented in Tailwind utilities or Framer Motion variants.

## Component and Surface Rules
### App Bars and Navigation
- Use thin separators and precise spacing.
- Apply restrained blur only where it improves layering, such as a fixed top bar over a complex hero.
- **Wordmark + brand-line accents** use the ember dot + JetBrains Mono. Section-level naming uses Space Grotesk Bold UPPERCASE.
- Inter is the default for navigational labels.
- JetBrains Mono is appropriate for utility controls, toggles, counters, and top-strip metadata.

### Buttons
- Primary buttons use ember fill with tight radius and mono uppercase labels.
- Secondary buttons use outline or ghost treatment with strong border tokens.
- Button copy should read like an instrument label, not marketing copy.
- **Resting state carries a hard-offset letterpress impression shadow** (`--button-primary-shadow-rest` / `--button-ghost-shadow-rest`). No soft drop shadows, no glow halos.
- **Hover presses DOWN** — translate by `(2px, 2px)` and shrink shadow to `-hover` value. Hover-lift (negative Y translate or expanding shadow) is a review-blocker on landing.
- **Active fully sinks** — translate `(4px, 4px)`, shadow → transparent.
- **Focus-visible stacks the focus ring on top** of the press shadow with sufficient contrast in both themes (see `--button-focus-ring`).
- **Disabled removes the press shadow entirely.** A disabled button with letterpress impression misreads as actionable.
- **Reduced-motion** suppresses the translate on hover/active; the shadow swap alone communicates press.

### Stamps and Micro-Labels
- Use JetBrains Mono, uppercase, and increased tracking.
- Keep stamps compact, framed, and slightly technical.
- Use them for status markers, version tags, section labels, and registry metadata.

### Panels and Cards
- Default to paper or metal surfaces before reaching for translucent glass.
- Use 2px to 4px radius and thin borders.
- Favor disciplined padding and typography over icon-heavy decoration.
- **Use `--card-shadow-rest` and `--card-shadow-hover` component tokens** for the impression. Never inline arbitrary shadow strings (`shadow-[...]` Tailwind arbitrary syntax on cards is a review-blocker).
- **Hover presses into the impression** — translate by `(2px, 2px)` and shrink shadow. Hover-lift is a review-blocker on landing.

### Forms
- Inter handles labels, helper text, and form body content.
- JetBrains Mono is reserved for field prefixes, structured values, counters, and technical hints.
- Focus states should tighten attention around ember edge emphasis, not explode into neon halo.
- Inputs should feel drafted and instrument-like rather than soft consumer controls.
- Success, warning, and error treatment should use the semantic state tokens above with quiet tinted backgrounds and strong readable text in both themes.

### Tables and Registries
- Table headers use mono uppercase micro-label treatment.
- Rows should have strong rhythm via hairlines, dash dividers, and typographic hierarchy.
- Use warmth and tinting for emphasized rows rather than loud badge clusters.
- Registry layouts should feel index-like: scannable, numbered, and precise.
- On mobile, tables must intentionally degrade into a readable responsive pattern rather than relying on accidental overflow.

### Docs and Reading Surfaces
- Docs should read like an editorial technical manual.
- Fraunces handles section titles and important display moments.
- Inter is the default for prose, guidance, and long-form explanation.
- JetBrains Mono is used for callouts, metadata, filenames, commands, inline technical values, and tables.
- Long-form reading widths, heading scale, and code block behavior must all remain readable on phone-sized screens.

### Terminal and Install Surfaces
- These remain deliberately dark in both themes unless a strong reason exists otherwise.
- Use obsidian-like code surfaces, ember prompts, molten arguments, bone output, and ash metadata.
- The goal is code-chrome clarity with brand warmth, not stylized hacker theatrics.

### Hero-Only Patterns
- Scroll-scrub storytelling, wire routing, chip motion, phone mockups, and cinematic staging belong to flagship landing surfaces.
- These patterns should not become the default behavior for dashboard, admin, docs, or registry pages.
- Landing-specific theatrics must degrade into clear, static compositions on small screens.
- When a scrub re-orients on mobile (rail under the phone instead of beside it), wire origins must anchor to the source surface's *outer visible edge* — never to an internal row position that may have scrolled out of view inside a clipped, max-height list. Anchoring to internal positions makes wires appear to start mid-air inside the mockup.
- Wire trails that share an axis (multiple skills firing into one mockup) should fan across the source surface's width rather than stack on a single vertical or horizontal line. Each trail follows its own arc so the choreography reads as parallel motion, not one fat line. Origins should be inset from the surface's edges (~5–10%) so the outermost trails don't clip.
- Reduced-motion users get a static composition with the same narrative beats — banner, mockup in its final/styled state, and an ambient skill marquee in place of the scroll-driven choreography. The marquee carries the "registry of skills" signal without requiring scroll input.
- **Wire origins anchor to the registry rail's outer phone-facing edge, not interior row positions, on every viewport.** Origins fan across the rail's height by index (~8% inset top + bottom). The rail-list internally auto-scrolls to keep the firing row visible — wire origins must NOT track that internal scroll, or landed wires will appear to slide with the rail content. See `HeroStage.tsx` desktop branch.

## Whole-App Application Guidance
### Landing and Marketing
- Use the full editorial forge expression here.
- Emphasize storytelling, staged hierarchy, and signature brand flourishes.
- Allow asymmetry, animated guidance, and higher motion budgets within performance constraints.
- Use Tailwind for structure and styling, and Framer Motion for choreography.
- Treat mobile landing layouts as a distinct composition problem, not a shrunken desktop scene.

### App Shell
- Translate the landing language into a calmer system: cool steel-paper page field, exact controls, thin separators, mono utility affordances, Space Grotesk for section-level display moments where they exist.
- Inherit the cool-bg page tokens and letterpress shadow tokens from the system. Do NOT inherit landing-only chrome (registration marks, drafting overlay, scroll-scrub theatrics).
- Navigation should feel structured and tool-like, not theatrical.
- Default to Tailwind-first implementation so shell-wide adjustments remain fast and centralized.

### Registry, Search, and Catalog Views
- Treat these as indices and ledgers.
- Use numbered lists, strong row rhythm, compact metadata, and explicit action labels.
- Space Grotesk Bold UPPERCASE for section / item-name display moments where appropriate; operational text stays in Inter and JetBrains Mono. Fraunces is legacy here too — do not introduce on new registry surfaces.

### Forms, Create Flows, and Playground
- Keep surfaces disciplined and task-first.
- Use the Forge Workshop material palette (cool steel paper, ember accent, mono metadata) to reinforce craft.
- Reserve accent color for active decisions, validation emphasis, and primary action.
- Prefer Tailwind utilities for form composition and Framer Motion only where sequence or progressive disclosure materially helps comprehension.

### Docs and Release Notes
- Present them as technical publishing surfaces.
- Use generous reading width controls, editorial headings, and strong metadata.
- Code and diagram surfaces may remain darker for clarity regardless of global theme.

### Admin and Data Views
- Keep density high but composed.
- Favor row rhythm, small caps mono labels, warm tints for state, and low-noise framing.
- Do not regress into generic enterprise blue-gray tables.

## Material & Print Vocabulary

Forge Workshop surfaces speak in print-shop / industrial-publication vocabulary, not SaaS card vocabulary. The cumulative effect is "this is a printed, drafted, forged object" — outside the visual neighborhood of any AI marketing landing page.

### Letterpress shadows
Cards, buttons, panels, and any "object placed onto the page" use **hard offset shadows** instead of soft drop shadows. The shadow is the impression left by the press: a flat solid offset, no blur. Light mode uses deep-ember-tinted impression (`--color-shadow-press` resolves to `rgba(110,34,7,0.13)`); dark mode uses near-black. The shadow is *information* — it tells you the element is pressed onto the page — not *atmosphere*.

### Page-corner registration marks
Four viewport-corner crosshairs (`+` cross + small ring) read as print-shop crop / registration marks. **Landing-only** — scoped to a route-level class, not mounted globally. Top corners anchor below the sticky nav so they sit at the page-content area's corners, not buried. App-shell pages do not render these.

### Drafting overlay (light mode, landing only)
Light-mode landing runs a **fixed page-edge dimension ruler** down both viewport edges (14px wide, dashed tick every 64px) plus a **global blueprint grid backdrop** on the body (`32px 32px` crosshatch at low opacity). This planted "drafting paper / technical document" gestalt is what replaces the warm cream parchment field. Dark mode skips both — its workshop signal comes from brushed-metal patina instead.

### Bracketed mono labels
Section markers, inline stamps, and metadata callouts use the JetBrains Mono `[ § XX — NAME ]` pattern with `letter-spacing: 0.18–0.22em`. The brackets are part of the type, not optional decoration.

### Welded-seam section dividers
Section transitions use a hairline horizontal rule with two small rivet dots (`3×3` at `--color-border-stronger`) at 25% and 75% positions, plus a 56px ember accent bar at the start and a 28px arc accent bar at the end. The rivet pattern is a load-bearing industrial signature; thin pure rules without rivets read as generic SaaS dividers.

### Highlighter Mark
Brand emphasis on selected nouns uses the hand-applied `<HighlighterMark>` component — a translucent ember (or arc, restricted) wash sitting OVER the text via SVG-filtered organic edges and `mix-blend-mode: multiply` (light) / `screen` (dark). The required SVG turbulence filter is mounted ONCE at the top of `LandingPage` via `<HighlighterMarkFilter />` with the namespaced id `ornn-highlighter-rough`; all `<HighlighterMark>` instances reference it. **Never use a bare `id="hi-rough"` filter** — bare names risk cross-component collision in any shared document.

### Implementation note
All of the above are **landing-surface vocabulary**. App shell (`RootLayout`-wrapped routes) inherits the cool-paper page background and the letterpress shadow tokens for cards / buttons, but does NOT render registration marks, drafting overlay, or scrub-style chrome.

## Migration Notes from the Current System
The current app still uses a legacy design vocabulary centered on `neon.css`, `neon-*` token names, Orbitron, Rajdhani, scanline remnants, and glow-forward card styling. That system is now legacy.

### What Becomes Legacy
| Legacy Direction | New Direction |
|------------------|---------------|
| Orbitron + Rajdhani display/body | **Space Grotesk Bold UPPERCASE display** + Inter body + JetBrains Mono operational |
| Italic Fraunces ember emphasis (v1/v2 signature) | **Hand-applied `<HighlighterMark>`** (ember or arc-restricted) on emphasis nouns |
| `neon-*` token naming | semantic role-based token naming |
| Soft drop shadows + hover-lift on cards/CTAs | **Letterpress hard-offset shadows + press-down hover** |
| Warm parchment / cream light bg (`#F5EFE1` family) | **Cool steel-paper light bg** (`#EAECEC` family, B≥G≥R) |
| Mono-orange brand accent | **Bi-tonal — ember (primary) + arc-blue (secondary diagrammatic)** |
| glow-heavy glass as default | paper, metal, and printed-object surfaces as default |
| scanline-era decoration | drafting-paper signaling (page-edge dim rulers, blueprint grid, registration marks) |
| pill-soft rounded controls | tighter 2px to 4px edge language |
| Inline arbitrary `shadow-[…]` in JSX | Component shadow tokens (`--card-shadow-*`, `--button-primary-shadow-*`) |

### Migration Rules
- Do not add new `neon-*` tokens or utilities.
- Existing theme-toggle behavior may remain while the token system is migrated.
- Remove scanline and CRT-inspired styling when touched.
- Reinterpret glass panels as exceptions, not the default container style.
- Preserve useful dark operational surfaces such as terminals, code blocks, and certain command contexts.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-24 | Replaced the prior neon-oriented design doc with Editorial Forge | The reference artifacts define a more mature, distinctive, and scalable brand language |
| 2026-04-24 | Declared the system whole-app and landing-led | The landing reference is the flagship expression and should guide the rest of the product |
| 2026-04-24 | Set the posture to light-first, dark-complete | The bright reference is the clearest brand expression while dark mode remains fully specified |
| 2026-04-24 | Replaced Orbitron and Rajdhani with Fraunces, Inter, and JetBrains Mono | The new trio better supports editorial warmth, operational clarity, and product credibility |
| 2026-04-24 | Standardized on three-layer tokens | Primitive, semantic, and component layers make the system easier to scale and theme |
| 2026-04-24 | Deprecated `neon-*` naming as the long-term model | Role-based naming better matches the new system and reduces semantic confusion |
| 2026-04-28 | Removed the editorial top-strip ("ORNN · CHRONO") above the landing nav | The wordmark in the nav already establishes the brand line; the strip read as decorative noise on every viewport, especially mobile |
| 2026-04-28 | Standardized mobile landing horizontal padding to `space-6` (24px) across every section, nav, footer, and divider | A uniform mobile gutter keeps the reading column consistent and eliminates the ragged left edge that came from mixing 16px and 24px insets per section |
| 2026-04-28 | Mobile landing hero re-composed vertically: banner above, phone centered at ~70% width, registry/rail compact at the bottom | The desktop 3-column scrub does not translate to a 390px column. Stacking by narrative (what is it → what does it look like → what's in it) gives mobile users immediate value above the fold instead of an empty starting frame |
| 2026-04-28 | Mobile scrub re-orients chip/wire motion vertically: skills emerge upward from the rail's outer top edge into phone targets, with origins fanned across the rail's width | Anchoring to the rail's visible top edge prevents wires from appearing to start mid-screen when interior rows scroll out of the rail's clipped list. Fanning origins across the rail width turns 16 skill trails into a parallel arc choreography rather than one stacked vertical line |
| 2026-04-28 | Reduced-motion users get a `SkillMarquee` (horizontal auto-scrolling skill chips) below the static phone in place of the scroll-driven scrub | Preserves the "registry of skills" signal without requiring scroll-driven choreography that reduced-motion users opt out of |
| 2026-04-29 | Promoted Forge Workshop direction (v3) into the documented system | The v2 Editorial Paper baseline read too close to Anthropic Claude's marketing surface (warm parchment + italic serif + soft drop shadows). v3 introduces Space Grotesk Bold UPPERCASE display, dark-first default, cool steel-paper light bg (`#EAECEC`), bi-tonal arc-blue secondary diagrammatic accent, letterpress press-down shadows on CTAs and cards, drafting-paper edge rulers and viewport-corner registration marks on landing, hand-applied highlighter mark replacing italic-Fraunces-ember signature. Reference build at `chrono-ornn.surge.sh/Ornn-Landing-v3.html` and `design-preview/Ornn-Landing-v3.html`. Italic Fraunces is deprecated for new landing surfaces; persists for app-shell during separate migration. New "Differentiation Guardrails" section makes the anti-Claude rules testable at PR-review time |
| 2026-04-29 | Approved arc-blue (`#5BC8E8` dark / `#2B7791` light) as a secondary diagrammatic accent | Relaxes the prior "no purple, blue, or rainbow tech gradients" anti-pattern at a restricted role only — bracketed labels, dim-rule end caps, hover variants, status-info pings. Never primary CTA fill, never gradient wash, never decorative default. The bi-tonal ember + arc identity is what carries the "two sides of the forge" brand distinction from Claude's mono-orange |
| 2026-04-29 | Replaced soft drop shadows with letterpress hard-offset impressions on cards and CTAs | Generic SaaS card vocabulary (soft drop shadows + hover lift) was a load-bearing Claude-adjacent trait. Letterpress vocabulary (hard offset shadows + hover-press-down) plants riso-print / industrial-publication identity instead. Component tokens for per-state shadows (`--button-primary-shadow-rest/-hover/-active`, `--card-shadow-rest/-hover`) replace inline arbitrary shadow strings. Inline shadows on landing components are now a review-blocker |
