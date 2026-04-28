# Editorial Forge Design Language - Ornn

## Product Context
- **What this is:** A Skill-as-a-Service platform for discovering, installing, publishing, and operating AI agent skills through a web UI, docs, and API-adjacent tooling.
- **Who it is for:** Agent developers, platform builders, technical teams, and operators who expect tools to feel composed and credible rather than playful or trend-driven.
- **Scope of this document:** Whole app, landing-led. The landing page is the flagship expression, and app shell, registry, docs, admin, forms, and data views inherit the same language.
- **Reference source:** This document is derived from the editorial forge reference artifacts `forge.css` and `landing.html`.

## Design Thesis
Ornn should feel like a registry, workshop, and publishing desk for skills. The product is not a generic SaaS dashboard and not a cyberpunk toy. Its visual language is a controlled blend of:

- **Paper:** editorial warmth, legible reading surfaces, quiet hierarchy
- **Metal:** forged structure, thin separators, instrument-like controls
- **Ember:** selective heat, action emphasis, and directional energy

The result should read as warm, tactile, precise, industrial, and composed. Interfaces should feel authored, not templated.

## Core Visual Language
### Principles
- **Editorial first:** Use typography, spacing, and alignment to create hierarchy before reaching for effects.
- **Material contrast:** Build the UI from paper, ink, metal, and ember relationships rather than flat neutral gray layers.
- **Operational clarity:** Controls, metadata, and system affordances should feel exact and tool-like.
- **Restrained heat:** Ember is the brand accent. It should be specific and intentional, not sprayed across the interface.
- **Landing-led, app-safe:** The landing page may be cinematic. Core app screens should stay disciplined and fast to read.

### Signature Traits
- Warm paper backgrounds in bright mode, forged metal surfaces in dark mode
- Fraunces display typography with italic ember emphasis for brand voice
- Inter for product reading surfaces and general UI copy
- JetBrains Mono for controls, metadata, search, code, and operational labels
- Hairline dividers, tight radii, and measured white space
- Localized glow, wire, and pulse effects used as accents rather than baseline decoration

### Anti-Patterns
- No cyberpunk language or sci-fi chrome as the primary voice
- No Orbitron or Rajdhani as the forward-looking type system
- No generic glassmorphism as the default surface treatment
- No purple, blue, or rainbow tech gradients
- No oversized pill-heavy SaaS cards or bubbly border radius
- No decorative noise unless it directly supports the forge metaphor
- No glow-heavy interfaces where every active element appears electrified

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
| `obsidian` | `#0E0D0B` | `#F5EFE1` | deepest material in each theme family |
| `graphite` | `#17150F` | `#EBE4D3` | structural panels and bands |
| `iron` | `#26221B` | `#DDD3BD` | elevated surfaces and internal framing |
| `steel` | `#3A3328` | `#C9BFAD` | hard edges, hardware, and trim |
| `ash` | `#6B6254` | `#8A7F6C` | metadata and low-emphasis text |
| `bone` | `#C9BFAD` | `#5E5544` | body reading tone |
| `parchment` | `#F1ECDE` | `#1A1812` | strongest text and ink contrast |
| `ember` | `#FF6A1A` | `#C94A0E` | primary accent and action color |
| `ember-dim` | `#C94A0E` | `#A33A08` | lower-heat accent state |
| `molten` | `#E8B341` | `#B8861A` | secondary warmth, highlights, and supporting emphasis |
| `line` | `rgba(201,191,173,0.12)` | `rgba(26,24,18,0.10)` | subtle borders and separators |
| `line-strong` | `rgba(201,191,173,0.22)` | `rgba(26,24,18,0.22)` | stronger borders and control edges |

### Specialized Primitive Tokens
These exist for specific reference behaviors and should not be overused outside their intended context.

| Token | Dark | Bright | Usage Intent |
|-------|------|--------|--------------|
| `page-bg` | `#0A0907` | `#F5EFE1` | page-level background |
| `phone-bezel` | `#2A2620` | `#B8AE98` | hero device hardware only |
| `phone-inner` | `#0A0907` | `#1A1812` | dark operational screen and contrast islands |
| `wire-glow` | `rgba(255,106,26,0.6)` | `rgba(201,74,14,0.45)` | landing wires and pulse accents |
| `grain-opacity` | `0.08` | `0.05` | subtle film grain only where explicitly called for |

### Semantic Tokens
Semantic tokens describe role, not material. These are the names future implementation should standardize on.

| Semantic Role | Dark | Bright | Usage |
|---------------|------|--------|-------|
| `color-page-bg` | `#0A0907` | `#F5EFE1` | page background |
| `color-surface-panel` | `#17150F` | `#EBE4D3` | bands, nav strips, footer, section backing |
| `color-surface-card` | `#17150F` | `#FFFBF0` | cards, drawers, list containers |
| `color-surface-elevated` | `#26221B` | `#E9E2CE` | highlighted or lifted surfaces |
| `color-text-strong` | `#F1ECDE` | `#1A1812` | headings, primary controls, strong text |
| `color-text-body` | `#C9BFAD` | `#5E5544` | paragraphs and standard UI copy |
| `color-text-meta` | `#6B6254` | `#8A7F6C` | metadata, helper text, low-priority labels |
| `color-accent-primary` | `#FF6A1A` | `#C94A0E` | primary action and brand accent |
| `color-accent-muted` | `#C94A0E` | `#A33A08` | lower-heat accent and hover dim |
| `color-accent-support` | `#E8B341` | `#B8861A` | secondary highlight and supportive emphasis |
| `color-border-subtle` | `rgba(201,191,173,0.12)` | `rgba(26,24,18,0.10)` | hairlines and quiet dividers |
| `color-border-strong` | `rgba(201,191,173,0.22)` | `rgba(26,24,18,0.22)` | stronger separators and control frames |
| `color-wire-glow` | `rgba(255,106,26,0.6)` | `rgba(201,74,14,0.45)` | wire, pulse, and guided motion accents |
| `color-code-surface` | `#0A0907` | `#1A1612` | terminal and code-chrome surfaces |

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
/* Button */
--button-primary-bg: var(--color-accent-primary);
--button-primary-fg: var(--color-page-bg);
--button-ghost-border: var(--color-border-strong);
--button-ghost-fg: var(--color-text-strong);

/* Panel */
--panel-bg: var(--color-surface-card);
--panel-border: var(--color-border-subtle);
--panel-shadow: 0 20px 60px -20px rgba(0, 0, 0, 0.18);

/* Input */
--input-bg: var(--color-surface-card);
--input-border: var(--color-border-subtle);
--input-focus: var(--color-accent-primary);

/* Table */
--table-row-border: var(--color-border-subtle);
--table-row-active-bg: color-mix(in srgb, var(--color-accent-primary) 8%, transparent);
```

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
| Display | `Fraunces` | hero lines, section titles, editorial emphasis, comparison headlines |
| Body | `Inter` | paragraphs, forms, docs prose, app content, interface copy |
| Operational Mono | `JetBrains Mono` | controls, metadata, search prompts, install commands, code, tables |

### Type Rules
- **Fraunces is a voice font, not a workhorse font.** Use it for tone-setting, hierarchy, and selective emphasis. Do not use it for dense UI controls or long reading passages.
- **Inter is the default product font.** Use it for all general interface reading surfaces, body copy, helper text, and form labels.
- **JetBrains Mono is the system voice.** Use it for buttons, micro-labels, stamps, counters, search prompts, status text, technical metadata, code, and data tables.
- Fraunces should retain a refined editorial feel using optical size and soft axis settings where supported. Italic display treatment is a signature behavior.

### Signature Emphasis
- Italic Fraunces combined with ember is a brand-level treatment for key hero words, highlighted nouns, and restrained emotional emphasis.
- Mono uppercase micro-labels with increased letter spacing are the default pattern for metadata, section markers, utility controls, and compact status affordances.

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
Bright mode is the flagship brand expression. It should feel like warm paper laid out on a drafting table rather than a white enterprise dashboard.

| Area | Rule |
|------|------|
| Backgrounds | Use parchment and warm paper tones, never stark white as the primary page field |
| Surfaces | Prefer paper cards, warm graphite bands, and lightly tinted elevated surfaces |
| Text | Strong text uses ink-like dark values; body text stays warm, not pure black |
| Borders | Use ink-like hairlines, not generic medium-gray borders |
| Accent | Ember shifts deeper for contrast and sophistication on paper |
| Depth | Use soft shadows and separation sparingly; the UI should feel layered, not floating |
| Glow | Keep glow subtle and rare; emphasis comes from contrast and hierarchy first |

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
- Shadows should feel like physical lift, not decorative haze.
- Prefer edge definition plus subtle depth over blurred glow.

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
- Fraunces belongs in the wordmark or section-level naming, not in dense nav menus.
- Inter is the default for navigational labels.
- JetBrains Mono is appropriate for utility controls, toggles, counters, and top-strip metadata.

### Buttons
- Primary buttons use ember fill with tight radius and mono uppercase labels.
- Secondary buttons use outline or ghost treatment with strong border tokens.
- Button copy should read like an instrument label, not marketing copy.
- Hover lift is subtle, typically 1px vertical movement or a stronger edge, not a large bounce.

### Stamps and Micro-Labels
- Use JetBrains Mono, uppercase, and increased tracking.
- Keep stamps compact, framed, and slightly technical.
- Use them for status markers, version tags, section labels, and registry metadata.

### Panels and Cards
- Default to paper or metal surfaces before reaching for translucent glass.
- Use 2px to 4px radius and thin borders.
- Favor disciplined padding and typography over icon-heavy decoration.
- Hover states should strengthen edge definition, tint warmth slightly, and lift minimally.

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

## Whole-App Application Guidance
### Landing and Marketing
- Use the full editorial forge expression here.
- Emphasize storytelling, staged hierarchy, and signature brand flourishes.
- Allow asymmetry, animated guidance, and higher motion budgets within performance constraints.
- Use Tailwind for structure and styling, and Framer Motion for choreography.
- Treat mobile landing layouts as a distinct composition problem, not a shrunken desktop scene.

### App Shell
- Translate the landing language into a calmer system: warm page fields, exact controls, thin separators, mono utility affordances, and editorial heading hierarchy.
- Navigation should feel structured and tool-like, not theatrical.
- Default to Tailwind-first implementation so shell-wide adjustments remain fast and centralized.

### Registry, Search, and Catalog Views
- Treat these as indices and ledgers.
- Use numbered lists, strong row rhythm, compact metadata, and explicit action labels.
- Fraunces can headline sections or item names sparingly; operational text should stay in Inter and JetBrains Mono.

### Forms, Create Flows, and Playground
- Keep surfaces disciplined and task-first.
- Use the warm material palette and mono metadata patterns to reinforce craft.
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

## Migration Notes from the Current System
The current app still uses a legacy design vocabulary centered on `neon.css`, `neon-*` token names, Orbitron, Rajdhani, scanline remnants, and glow-forward card styling. That system is now legacy.

### What Becomes Legacy
| Legacy Direction | New Direction |
|------------------|---------------|
| Orbitron display language | Fraunces editorial display language |
| Rajdhani body/UI language | Inter product reading language |
| `neon-*` token naming | semantic role-based token naming |
| glow-heavy glass as default | paper and metal surfaces as default |
| dark-first neon forge posture | light-first editorial forge posture |
| scanline-era decoration | restrained material texture only where justified |
| pill-soft rounded controls | tighter 2px to 4px edge language |

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
