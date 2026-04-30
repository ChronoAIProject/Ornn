/**
 * Hardcoded narrative copy used by the landing page.
 *
 * `FEATURED_DEFAULT` and `CATALOG_DEFAULT` are placeholders; `useFeaturedSkills`
 * may overwrite them once `/api/v1/skills` resolves. `RAIL_SKILLS` stays hardcoded
 * forever — it drives the hero scroll-scrub narrative, not a real registry read.
 */

export type FeaturedSkill = {
  slug: string;
  tag: string;
  name: string;
  desc: string;
  install: string;
  author: string;
  version: string;
  date: string;
};

export type CatalogSkill = {
  num: string;
  name: string;
  tags: string;
  purpose: string;
  date: string;
};

/**
 * Target key matches the `data-target` on an element inside the styled phone
 * layer, so each rail row visually lands on a specific region of the mocked UI.
 */
export type RailTarget = "nav" | "type" | "media" | "cards" | "cta";

export type RailSkill = {
  idx: number;
  name: string;
  tag: string;
  target: RailTarget;
};

export const FEATURED_DEFAULT: FeaturedSkill[] = [
  {
    slug: "ornn-search-and-run",
    tag: "FEATURED · search",
    name: "ornn-search-and-run",
    desc: "Find any skill on the registry from inside your agent — semantic ranking via NyxID MCP, loaded into context on demand, no separate install step.",
    install: 'ornn-search-and-run "<query>"',
    author: "@ornn",
    version: "v 0.9.1",
    date: "24 Apr",
  },
  {
    slug: "ornn-upload",
    tag: "FEATURED · publish",
    name: "ornn-upload",
    desc: "Package a local skill folder and push it to the registry — versioned, audited, ready for any agent that consumes the format.",
    install: "ornn-upload <skill-folder>",
    author: "@ornn",
    version: "v 0.9.0",
    date: "20 Apr",
  },
  {
    slug: "ornn-build",
    tag: "FEATURED · build",
    name: "ornn-build",
    desc: "Meta-skill: describe the task in plain English, ornn-build drafts a working SKILL.md you can iterate on, sandbox, and publish.",
    install: 'ornn-build "<prompt>"',
    author: "@ornn",
    version: "v 0.9.0",
    date: "22 Apr",
  },
];

export const CATALOG_DEFAULT: CatalogSkill[] = [
  {
    num: "04",
    name: "sisyphus-researcher",
    tags: "@shining · sisyphus · research",
    purpose: "Sisyphus research agent prompt.",
    date: "31 Mar",
  },
  {
    num: "05",
    name: "sisyphus-decomposer",
    tags: "@shining · maker-decompose",
    purpose: "Task-decomposition agent.",
    date: "31 Mar",
  },
  {
    num: "06",
    name: "japanese-to-chinese-translator",
    tags: "@limkaiwei · translation · ja · zh",
    purpose: "Japanese → Chinese with tone, context, style control.",
    date: "24 Mar",
  },
  {
    num: "07",
    name: "gemini-marketing-image-gen",
    tags: "@shining · gemini · image · marketing",
    purpose: "Marketing images via Gemini 3.1 Flash.",
    date: "13 Mar",
  },
  {
    num: "08",
    name: "any-to-korean-translation",
    tags: "@shining · translation · korean",
    purpose: "Any → natural Korean, preserving tone & formatting.",
    date: "12 Mar",
  },
];

export const RAIL_SKILLS: RailSkill[] = [
  { idx: 0, name: "wireframing", tag: "@ornn · structure", target: "type" },
  { idx: 1, name: "design-system", tag: "@chrono · tokens", target: "type" },
  { idx: 2, name: "design/layout", tag: "@ornn · scaffolds", target: "nav" },
  { idx: 3, name: "design/type", tag: "@chrono · type", target: "type" },
  { idx: 4, name: "design/color", tag: "@shining · tokens", target: "media" },
  { idx: 5, name: "design/hero", tag: "@ornn · media", target: "media" },
  { idx: 6, name: "design/controls", tag: "@chrono · ui", target: "cta" },
  { idx: 7, name: "design/cards", tag: "@ornn · components", target: "cards" },
  { idx: 8, name: "design/icons", tag: "@chrono · assets", target: "nav" },
  { idx: 9, name: "design/motion", tag: "@ornn · motion", target: "media" },
  { idx: 10, name: "react", tag: "@ornn · framework", target: "cards" },
  { idx: 11, name: "responsive", tag: "@ornn · layout", target: "cta" },
  { idx: 12, name: "seo", tag: "@chrono · meta", target: "nav" },
  { idx: 13, name: "meta-og", tag: "@chrono · meta", target: "nav" },
  { idx: 14, name: "oauth", tag: "@ornn · auth", target: "cta" },
  { idx: 15, name: "footer", tag: "@ornn · layout", target: "cards" },
];
