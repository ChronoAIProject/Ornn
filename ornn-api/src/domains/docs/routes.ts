/**
 * Documentation routes. Serves doc tree, markdown content, and release notes from the filesystem.
 * No auth required — docs are publicly accessible.
 * @module domains/docs/routes
 */

import { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "docsRoutes" });

const SUPPORTED_LANGS = new Set(["en", "zh"]);

export interface DocsRoutesConfig {
  /** Absolute path to the docs/site directory */
  docsBasePath: string;
}

/** Parse release note frontmatter (version, date, title) from markdown content. */
function parseReleaseFrontmatter(content: string): {
  version: string;
  date: string;
  title: { en: string; zh: string };
  body: string;
} | null {
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

/** Extract the language-specific section from a release note body. */
function extractLangSection(body: string, lang: string): string {
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

export function createDocsRoutes(config: DocsRoutesConfig): Hono {
  const { docsBasePath } = config;
  const app = new Hono();

  /**
   * GET /docs/tree?lang=en — Return the menu structure for a language.
   */
  app.get("/docs/tree", async (c) => {
    const lang = c.req.query("lang") ?? "en";
    if (!SUPPORTED_LANGS.has(lang)) {
      return c.json(
        { data: null, error: { code: "INVALID_LANG", message: `Unsupported language: ${lang}` } },
        400,
      );
    }

    const menuPath = join(docsBasePath, lang, "menuStructure.json");
    try {
      const content = await readFile(menuPath, "utf-8");
      const menu = JSON.parse(content);
      logger.debug({ lang }, "Docs tree loaded");
      return c.json({ data: menu, error: null });
    } catch (err) {
      logger.error({ err, lang, menuPath }, "Failed to read menu structure");
      return c.json(
        { data: null, error: { code: "MENU_NOT_FOUND", message: "Menu structure not found" } },
        404,
      );
    }
  });

  /**
   * GET /docs/content/:lang/:slug — Return raw markdown content for a doc.
   * The slug is the doc ID (e.g. "what-is-ornn"), resolved to a .md file via menuStructure.
   */
  app.get("/docs/content/:lang/:slug", async (c) => {
    const lang = c.req.param("lang");
    const slug = c.req.param("slug");

    if (!SUPPORTED_LANGS.has(lang)) {
      return c.json(
        { data: null, error: { code: "INVALID_LANG", message: `Unsupported language: ${lang}` } },
        400,
      );
    }

    // Prevent path traversal
    if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
      return c.json(
        { data: null, error: { code: "INVALID_SLUG", message: "Invalid document slug" } },
        400,
      );
    }

    // Load menu to resolve slug → file
    const menuPath = join(docsBasePath, lang, "menuStructure.json");
    let fileName: string | null = null;
    try {
      const menuContent = await readFile(menuPath, "utf-8");
      const menu = JSON.parse(menuContent);
      for (const section of menu.sections) {
        for (const child of section.children) {
          if (child.id === slug) {
            fileName = child.file;
            break;
          }
        }
        if (fileName) break;
      }
    } catch {
      return c.json(
        { data: null, error: { code: "MENU_NOT_FOUND", message: "Menu structure not found" } },
        404,
      );
    }

    if (!fileName) {
      return c.json(
        { data: null, error: { code: "DOC_NOT_FOUND", message: `Document '${slug}' not found` } },
        404,
      );
    }

    // Resolve and validate file path stays within docs directory
    const filePath = resolve(docsBasePath, lang, fileName);
    if (!filePath.startsWith(resolve(docsBasePath))) {
      return c.json(
        { data: null, error: { code: "INVALID_PATH", message: "Invalid document path" } },
        400,
      );
    }

    try {
      const content = await readFile(filePath, "utf-8");
      logger.debug({ lang, slug, fileName }, "Doc content loaded");
      return c.json({ data: { slug, lang, content }, error: null });
    } catch {
      logger.warn({ lang, slug, filePath }, "Doc file not found");
      return c.json(
        { data: null, error: { code: "DOC_NOT_FOUND", message: `Document '${slug}' not found` } },
        404,
      );
    }
  });

  // ---- Release Notes ----

  const releasesPath = join(docsBasePath, "..", "releases");

  /**
   * GET /docs/releases?lang=en — List all releases with metadata.
   * Returns version, date, title (localized), sorted newest first.
   */
  app.get("/docs/releases", async (c) => {
    const lang = c.req.query("lang") ?? "en";

    try {
      const files = await readdir(releasesPath);
      const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();

      const releases = [];
      for (const file of mdFiles) {
        const content = await readFile(join(releasesPath, file), "utf-8");
        const parsed = parseReleaseFrontmatter(content);
        if (parsed) {
          releases.push({
            version: parsed.version,
            date: parsed.date,
            title: lang === "zh" ? parsed.title.zh : parsed.title.en,
          });
        }
      }

      logger.debug({ lang, count: releases.length }, "Releases list loaded");
      return c.json({ data: releases, error: null });
    } catch (err) {
      logger.error({ err }, "Failed to read releases directory");
      return c.json(
        { data: null, error: { code: "RELEASES_NOT_FOUND", message: "Releases directory not found" } },
        404,
      );
    }
  });

  /**
   * GET /docs/releases/:version?lang=en — Get release note content for a specific version.
   * Returns the localized markdown body for the given version.
   */
  app.get("/docs/releases/:version", async (c) => {
    const version = c.req.param("version");
    const lang = c.req.query("lang") ?? "en";

    // Prevent path traversal
    if (version.includes("..") || version.includes("/") || version.includes("\\")) {
      return c.json(
        { data: null, error: { code: "INVALID_VERSION", message: "Invalid version" } },
        400,
      );
    }

    const filePath = resolve(releasesPath, `v${version}.md`);
    if (!filePath.startsWith(resolve(releasesPath))) {
      return c.json(
        { data: null, error: { code: "INVALID_PATH", message: "Invalid path" } },
        400,
      );
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseReleaseFrontmatter(content);
      if (!parsed) {
        return c.json(
          { data: null, error: { code: "PARSE_ERROR", message: "Failed to parse release note" } },
          500,
        );
      }

      const body = extractLangSection(parsed.body, lang);

      logger.debug({ version, lang }, "Release note loaded");
      return c.json({
        data: {
          version: parsed.version,
          date: parsed.date,
          title: lang === "zh" ? parsed.title.zh : parsed.title.en,
          content: body,
        },
        error: null,
      });
    } catch {
      logger.warn({ version, filePath }, "Release note file not found");
      return c.json(
        { data: null, error: { code: "RELEASE_NOT_FOUND", message: `Release '${version}' not found` } },
        404,
      );
    }
  });

  return app;
}
