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
 * The slice of a skill the manifests need. Decoupled from
 * `SkillDocument` so this module stays free of DB/runtime types and is
 * trivially unit-testable.
 */
export interface MarketplaceSkillInput {
  /** Canonical skill name — also the folder name and plugin source path. */
  name: string;
  description: string;
  /** Ornn `<major>.<minor>` latest version, used as the plugin version. */
  version: string;
  /** Skill tags -> Claude Code plugin `keywords`. Empty array => omitted. */
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
  version: string;
  description: string;
}

/** Stable, locale-independent ascending compare by skill name. */
function byName(a: MarketplaceSkillInput, b: MarketplaceSkillInput): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/** Pretty-print with a trailing newline so the file is git-friendly. */
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Build the root `.claude-plugin/marketplace.json` cataloguing every
 * supplied (already public + safely-named) skill as a single-skill
 * plugin sourced from its sibling folder.
 */
export function buildMarketplaceJson(
  skills: MarketplaceSkillInput[],
  cfg: MarketplaceConfig,
): string {
  const plugins: MarketplacePluginEntry[] = [...skills].sort(byName).map((skill) => {
    const entry: MarketplacePluginEntry = {
      name: skill.name,
      source: `./${skill.name}`,
      description: skill.description,
      version: skill.version,
    };
    // Omit `keywords` entirely when empty — keeps the manifest clean and
    // avoids an unnecessary `[]` diff for tag-less skills.
    if (skill.keywords.length > 0) {
      entry.keywords = [...skill.keywords];
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
 * Build a single skill folder's `.claude-plugin/plugin.json`, making
 * that folder a valid one-skill Claude Code plugin and pinning the
 * plugin version to the skill's latest Ornn version.
 */
export function buildPluginJson(skill: MarketplaceSkillInput): string {
  const manifest: PluginManifest = {
    name: skill.name,
    version: skill.version,
    description: skill.description,
  };
  return serialize(manifest);
}
