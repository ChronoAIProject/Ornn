/**
 * Claude Code marketplace manifest generators (#1153).
 *
 * The GitHub mirror repo (`ChronoAIProject/ornn-skills`) already holds
 * one `<skill-name>/` folder per public skill. Adding a root
 * `.claude-plugin/marketplace.json` plus a per-folder
 * `.claude-plugin/plugin.json` turns that same repo into a valid
 * Claude Code plugin marketplace — users run
 * `/plugin marketplace add <owner>/<repo>` then
 * `/plugin install <skill>@<marketplace>`.
 *
 * Ornn stays the model-agnostic registry of record; this is purely an
 * export adapter on top of the existing mirror. No browse/ranking, no
 * consuming external marketplaces.
 *
 * These functions are intentionally **pure and deterministic**: same
 * input -> byte-identical output. The mirror skips no-op commits by
 * comparing git blob SHAs, so any non-determinism here (unstable key
 * order, unsorted plugins) would manufacture churn commits on every
 * sync. Plugins are sorted by name and JSON is serialized with a
 * stable key order + trailing newline.
 *
 * @module domains/skills/mirror/marketplaceManifest
 */

/** Repo-root path of the marketplace catalogue file. */
export const MARKETPLACE_MANIFEST_PATH = ".claude-plugin/marketplace.json";

/** Per-skill plugin manifest path, relative to the skill's `<name>/` folder. */
export const PLUGIN_MANIFEST_RELPATH = ".claude-plugin/plugin.json";

/**
 * One catalogue entry the marketplace manifest needs. Decoupled from
 * `SkillDocument` / `SkillsetDocument` so this module stays free of
 * DB/runtime types and is trivially unit-testable.
 *
 * Generalized for #1155: an entry carries its `source` path EXPLICITLY
 * rather than deriving it from `name`, so a single-skill plugin can pass
 * `./<name>` while a curated multi-skill skillset plugin passes
 * `./skillsets/<name>` — both land in the same root marketplace.json.
 */
export interface MarketplacePluginInput {
  /** Plugin name — the marketplace catalogue key + install handle. */
  name: string;
  /**
   * Plugin source path relative to the repo root, e.g. `./pdf-extract`
   * (per-skill) or `./skillsets/research-bundle` (skillset). Carried
   * explicitly so skill and skillset entries can diverge.
   */
  source: string;
  description: string;
  /** Ornn `<major>.<minor>` latest version, used as the plugin version. */
  version: string;
  /** Tags -> Claude Code plugin `keywords`. Empty array => omitted. */
  keywords: string[];
}

/** Claude Code marketplace `owner` object (only `name` is required). */
export interface MarketplaceOwner {
  name: string;
}

export interface MarketplaceConfig {
  /** Marketplace `name` field — the mirror repo name, e.g. `ornn-skills`. */
  name: string;
  owner: MarketplaceOwner;
}

interface MarketplacePluginEntry {
  name: string;
  source: string;
  description: string;
  version: string;
  keywords?: string[];
}

interface MarketplaceManifest {
  name: string;
  owner: MarketplaceOwner;
  plugins: MarketplacePluginEntry[];
}

interface PluginManifest {
  name: string;
  /** Optional human label (#1157) — present only for an owner-overridden skillset plugin. */
  displayName?: string;
  version: string;
  description: string;
}

/**
 * Stable, locale-independent ascending compare — primarily by name, then
 * by source as a tiebreaker. The source tiebreaker keeps output
 * byte-stable even if a skill and a skillset ever share a name (distinct
 * source paths), so the mirror's blob-SHA no-op check never sees churn.
 */
function byPlugin(a: MarketplacePluginInput, b: MarketplacePluginInput): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return 0;
}

/** Pretty-print with a trailing newline so the file is git-friendly. */
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Build the root `.claude-plugin/marketplace.json` cataloguing every
 * supplied plugin entry (already public + safely-named), each sourced
 * from its own `source` path. Mixes single-skill plugins (`./<name>`)
 * and curated multi-skill skillset plugins (`./skillsets/<name>`) in one
 * catalogue (#1155).
 */
export function buildMarketplaceJson(
  inputs: MarketplacePluginInput[],
  cfg: MarketplaceConfig,
): string {
  const plugins: MarketplacePluginEntry[] = [...inputs].sort(byPlugin).map((input) => {
    const entry: MarketplacePluginEntry = {
      name: input.name,
      source: input.source,
      description: input.description,
      version: input.version,
    };
    // Omit `keywords` entirely when empty — keeps the manifest clean and
    // avoids an unnecessary `[]` diff for tag-less entries.
    if (input.keywords.length > 0) {
      entry.keywords = [...input.keywords];
    }
    return entry;
  });

  const manifest: MarketplaceManifest = {
    name: cfg.name,
    owner: cfg.owner,
    plugins,
  };
  return serialize(manifest);
}

/**
 * Build a plugin folder's `.claude-plugin/plugin.json`, making that
 * folder a valid Claude Code plugin and pinning the plugin version to
 * the source's latest Ornn version. Used for both a single-skill folder
 * and a curated skillset folder.
 *
 * `displayName` (#1157) is OPTIONAL — emitted only when supplied, with a stable
 * key position right after `name`. When absent the manifest is byte-identical
 * to the pre-#1157 `{ name, version, description }` form, so the per-skill
 * plugins (which never set it) never churn a no-op commit.
 */
export function buildPluginJson(input: {
  name: string;
  version: string;
  description: string;
  displayName?: string;
}): string {
  const manifest: PluginManifest =
    input.displayName !== undefined
      ? {
          name: input.name,
          displayName: input.displayName,
          version: input.version,
          description: input.description,
        }
      : {
          name: input.name,
          version: input.version,
          description: input.description,
        };
  return serialize(manifest);
}
