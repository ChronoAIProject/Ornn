/**
 * Static docs loader. Markdown and menu JSON under `src/docs/` are pulled in
 * at build time via Vite's `import.meta.glob`, so the docs experience is
 * fully client-side — no backend round-trip, no nginx bypass, no auth proxy.
 *
 * Public API matches what the former `/api/docs/*` endpoints returned so
 * consumers only need to swap the fetch call.
 * @module lib/docsContent
 */

export type DocLang = "en" | "zh";

export interface DocChild {
  id: string;
  label: string;
  file: string;
  order: number;
}

export interface DocSection {
  id: string;
  label: string;
  order: number;
  children: DocChild[];
}

export interface MenuStructure {
  defaultDoc: string;
  sections: DocSection[];
}

export interface ReleaseInfo {
  version: string;
  date: string;
  title: string;
}

export interface ReleaseDetail extends ReleaseInfo {
  content: string;
}

// Eager, raw-text glob imports. The resulting record is keyed by the
// module-relative path so we can route by lang + filename.
const siteMarkdown = import.meta.glob("../docs/site/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const siteMenus = import.meta.glob("../docs/site/*/menuStructure.json", {
  eager: true,
}) as Record<string, { default: MenuStructure }>;

const releaseMarkdown = import.meta.glob("../docs/releases/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function menuPathFor(lang: DocLang): string {
  return `../docs/site/${lang}/menuStructure.json`;
}

function sitePathFor(lang: DocLang, fileName: string): string {
  return `../docs/site/${lang}/${fileName}`;
}

function releasePathFor(version: string): string {
  return `../docs/releases/v${version}.md`;
}

/** Return the menu structure for a language, or `null` if unavailable. */
export function getDocsTree(lang: DocLang): MenuStructure | null {
  const mod = siteMenus[menuPathFor(lang)];
  return mod?.default ?? null;
}

/** Return the markdown body for a doc slug, or `null` if not found. */
export function getDocContent(lang: DocLang, slug: string): string | null {
  // Guard against traversal; slugs in menuStructure.json are plain ids.
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    return null;
  }

  const menu = getDocsTree(lang);
  if (!menu) return null;

  for (const section of menu.sections) {
    for (const child of section.children) {
      if (child.id === slug) {
        return siteMarkdown[sitePathFor(lang, child.file)] ?? null;
      }
    }
  }
  return null;
}

interface ParsedRelease {
  version: string;
  date: string;
  title: { en: string; zh: string };
  body: string;
}

function parseReleaseFrontmatter(content: string): ParsedRelease | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  const versionMatch = frontmatter.match(/^version:\s*(.+)$/m);
  const dateMatch = frontmatter.match(/^date:\s*(.+)$/m);
  const enTitleMatch = frontmatter.match(/^\s+en:\s*(.+)$/m);
  const zhTitleMatch = frontmatter.match(/^\s+zh:\s*(.+)$/m);

  if (!versionMatch || !dateMatch) return null;

  return {
    version: versionMatch[1].trim(),
    date: dateMatch[1].trim(),
    title: {
      en: enTitleMatch?.[1]?.trim() ?? "",
      zh: zhTitleMatch?.[1]?.trim() ?? "",
    },
    body,
  };
}

function extractLangSection(body: string, lang: DocLang): string {
  const sectionHeader = lang === "zh" ? "### ZH" : "### EN";
  const otherHeader = lang === "zh" ? "### EN" : "### ZH";

  const sectionStart = body.indexOf(sectionHeader);
  if (sectionStart === -1) return body;

  const contentStart = sectionStart + sectionHeader.length;
  const sectionEnd = body.indexOf(otherHeader, contentStart);

  const section = sectionEnd === -1
    ? body.slice(contentStart)
    : body.slice(contentStart, sectionEnd);

  return section.trim();
}

/**
 * List releases newest-first. The sort key is the filename (`vX.Y.Z.md`),
 * matching the legacy backend ordering so callers that pick `[0]` as
 * "latest" keep the same behavior.
 */
export function getReleases(lang: DocLang): ReleaseInfo[] {
  const entries = Object.entries(releaseMarkdown)
    .sort((a, b) => b[0].localeCompare(a[0]));

  const out: ReleaseInfo[] = [];
  for (const [, content] of entries) {
    const parsed = parseReleaseFrontmatter(content);
    if (!parsed) continue;
    out.push({
      version: parsed.version,
      date: parsed.date,
      title: lang === "zh" ? parsed.title.zh : parsed.title.en,
    });
  }
  return out;
}

/** Return the localized detail for a release, or `null` if missing/malformed. */
export function getRelease(version: string, lang: DocLang): ReleaseDetail | null {
  if (version.includes("..") || version.includes("/") || version.includes("\\")) {
    return null;
  }
  const content = releaseMarkdown[releasePathFor(version)];
  if (!content) return null;

  const parsed = parseReleaseFrontmatter(content);
  if (!parsed) return null;

  return {
    version: parsed.version,
    date: parsed.date,
    title: lang === "zh" ? parsed.title.zh : parsed.title.en,
    content: extractLangSection(parsed.body, lang),
  };
}
