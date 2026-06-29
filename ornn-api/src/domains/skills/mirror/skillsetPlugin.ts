/**
 * Curated multi-skill skillset plugin builder (#1155).
 *
 * #1153/#1154 auto-export every public skill as a SINGLE-skill Claude Code
 * plugin under `<skill-name>/`. This is the second layer: a skillset OWNER
 * may opt in (`exportAsPlugin`) to also export the whole curated set as ONE
 * multi-skill plugin, laid out under a dedicated `skillsets/<name>/` subtree
 * so it never collides with the per-skill folders:
 *
 *   skillsets/<name>/.claude-plugin/plugin.json   { name, version, description }
 *   skillsets/<name>/skills/<member>/SKILL.md      (+ that member's files)
 *   skillsets/<name>/README.md                     (master prompt + member list + install)
 *
 * There is deliberately NO root SKILL.md — multi-skill plugins use
 * `skills/<name>/SKILL.md` discovery. The skillset master prompt (the
 * `instructions` field) goes into the README only, NOT as an invokable skill.
 *
 * Everything here is **pure + deterministic**: same input -> byte-identical
 * output (members sorted + de-duped by name, stable JSON key order, trailing
 * newline, NO timestamp). The mirror skips no-op commits by comparing git blob
 * SHAs, so any non-determinism would manufacture churn commits on every sync.
 *
 * @module domains/skills/mirror/skillsetPlugin
 */

import { createLogger } from "../../../shared/logger";
import { SKILL_NAME_REGEX, SKILL_NAME_MAX } from "../../../shared/schemas/skillFrontmatter";
import {
  buildPluginJson,
  PLUGIN_MANIFEST_RELPATH,
  type MarketplacePluginInput,
} from "./marketplaceManifest";

const logger = createLogger("skillsetPlugin");

/** Repo-root subtree all skillset plugins live under. */
export const SKILLSET_FOLDER = "skillsets";
/** Per-skillset folder path of the README — relative to `skillsets/<name>/`. */
const SKILLSET_README_RELPATH = "README.md";
/** Sub-folder holding the member skills inside a multi-skill plugin. */
const SKILLS_SUBFOLDER = "skills";

/** A resolved member skill, ready to embed under `skills/<name>/`. */
export interface SkillsetPluginMember {
  /** Canonical member skill name — the folder name under `skills/`. */
  name: string;
  /** Concrete `<major>.<minor>` version of the resolved member. */
  version: string;
  /** Short human description — surfaced in the README member list. */
  description: string;
  /** Package-relative files (e.g. `SKILL.md`, `references/x`) -> content. */
  files: Record<string, string>;
}

/** The skillset slice the builder needs — no DB/runtime types. */
export interface SkillsetPluginInput {
  /** Skillset name — the `skillsets/<name>/` folder + the plugin name. */
  name: string;
  /** Skillset description — plugin.json description + README blurb. */
  description: string;
  /** Skillset `latestVersion` — pins the plugin version. */
  version: string;
  /** Skillset tags -> marketplace `keywords`. */
  tags: string[];
  /** Master prompt (#978) — README only, never an invokable skill. */
  instructions: string;
  /** Resolved member skills (already visibility-checked + safe-named upstream). */
  members: SkillsetPluginMember[];
}

/** Install-snippet + provenance context for the README. */
export interface SkillsetPluginConfig {
  /** `https://ornn.chrono-ai.fun` (no trailing slash) — README provenance link. */
  ornnPublicOrigin: string;
  /** `<owner>/<repo>` for the `/plugin marketplace add` snippet. */
  repoSlug: string;
  /** `<repo>` for the `/plugin install <name>@<repo>` snippet. */
  repoName: string;
}

/** Folder-name safety (#807, CWE-22) — gates the skills/<member>/ subtree. */
export function isSafeMemberName(name: string): boolean {
  return SKILL_NAME_REGEX.test(name) && name.length <= SKILL_NAME_MAX;
}

/**
 * Stable member ordering + de-dupe by name. Two member refs MAY resolve to
 * the same skill name (e.g. one pinned, one `latest`); the first wins so the
 * file map never collides and output stays deterministic.
 */
function normalizeMembers(members: SkillsetPluginMember[]): SkillsetPluginMember[] {
  const seen = new Set<string>();
  const safe: SkillsetPluginMember[] = [];
  for (const m of members) {
    if (!isSafeMemberName(m.name)) {
      logger.error({ member: m.name }, "skillsetPlugin: skipping member with unsafe folder name");
      continue;
    }
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    safe.push(m);
  }
  return safe.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The marketplace catalogue entry for a skillset plugin — source
 * `./skillsets/<name>`. Lightweight (no member resolution), so the skill
 * incremental publish/remove path can include skillset entries in the shared
 * root marketplace.json without assembling the full subtree.
 */
export function skillsetMarketplaceInput(input: {
  name: string;
  description: string;
  version: string;
  keywords: string[];
}): MarketplacePluginInput {
  return {
    name: input.name,
    source: `./${SKILLSET_FOLDER}/${input.name}`,
    description: input.description,
    version: input.version,
    keywords: [...input.keywords],
  };
}

/**
 * Build a skillset plugin's full file map (paths RELATIVE to
 * `skillsets/<name>/`) plus its marketplace catalogue entry. Pure +
 * deterministic. The caller prefixes each path with `skillsets/<name>/`.
 */
export function buildSkillsetPlugin(
  input: SkillsetPluginInput,
  cfg: SkillsetPluginConfig,
): { files: Map<string, string>; marketplace: MarketplacePluginInput } {
  const members = normalizeMembers(input.members);
  const files = new Map<string, string>();

  // Per-skillset plugin manifest (multi-skill form — no root SKILL.md).
  files.set(PLUGIN_MANIFEST_RELPATH, buildPluginJson({
    name: input.name,
    version: input.version,
    description: input.description,
  }));

  // Each member's package files land under skills/<member>/… so Claude Code's
  // multi-skill discovery (skills/<name>/SKILL.md) finds every set member.
  for (const member of members) {
    for (const [relPath, content] of Object.entries(member.files)) {
      files.set(`${SKILLS_SUBFOLDER}/${member.name}/${relPath}`, content);
    }
  }

  files.set(SKILLSET_README_RELPATH, buildSkillsetReadme(input, members, cfg));

  return {
    files,
    marketplace: skillsetMarketplaceInput({
      name: input.name,
      description: input.description,
      version: input.version,
      keywords: input.tags,
    }),
  };
}

/**
 * Deterministic human README for a skillset plugin. Carries the master prompt
 * (README-only, never an invokable skill), the member list, the install
 * snippet, and the auto-update caveat. NO timestamp — byte-stable across
 * no-op syncs.
 */
function buildSkillsetReadme(
  input: SkillsetPluginInput,
  members: SkillsetPluginMember[],
  cfg: SkillsetPluginConfig,
): string {
  const url = `${cfg.ornnPublicOrigin}/skillsets/${encodeURIComponent(input.name)}`;
  const memberLines =
    members.length > 0
      ? members.map((m) => `- \`${m.name}@${m.version}\` — ${m.description}`)
      : ["- _(no resolvable members)_"];
  return [
    `# ${input.name}`,
    "",
    `> ${input.description}`,
    "",
    "---",
    "",
    `**Mirrored from [Ornn](${url}) — read-only.**`,
    "",
    "A curated multi-skill Claude Code plugin. Edits here are NOT propagated",
    "back; manage this skillset on Ornn.",
    "",
    `- Latest version: \`${input.version}\``,
    `- Skills bundled: ${members.length}`,
    "",
    "## Master prompt",
    "",
    "How an agent should orchestrate the members of this set:",
    "",
    input.instructions,
    "",
    "## Skills in this plugin",
    "",
    ...memberLines,
    "",
    "Each member ships its own `SKILL.md` under `skills/<name>/`.",
    "",
    "## Install",
    "",
    "```bash",
    `/plugin marketplace add ${cfg.repoSlug}`,
    `/plugin install ${input.name}@${cfg.repoName}`,
    "```",
    "",
    "> Third-party marketplaces default to auto-update OFF. Enable it in",
    "> `/plugin` → Marketplaces if you want this skillset to update automatically.",
    "",
  ].join("\n");
}
