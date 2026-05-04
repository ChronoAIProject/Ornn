/**
 * Mirror service — keeps `<owner>/<repo>` (typically
 * `ChronoAIProject/ornn-skills`) in lockstep with the public + system
 * subset of Ornn's skill catalogue.
 *
 * Three operations:
 *   - `publishSkill(guid)` — incremental: replace one `<name>/` subtree
 *   - `removeSkill(name)`  — incremental: drop one `<name>/` subtree
 *   - `reconcileAll()`     — full sweep: build the union of all
 *                            eligible skills + diff against the mirror
 *                            in one atomic commit
 *
 * Eligibility: `!skill.isPrivate`. Private skills (incl. those shared
 * with specific users / orgs) NEVER appear in the mirror — they're the
 * Ornn moat. The eligibility predicate is enforced at the start of
 * every operation; covered by a regression test.
 *
 * Each successful sync emits one annotated git tag of the form
 * `sync-<ISO timestamp>` so the mirror's tag history doubles as an
 * audit log of what was on the mirror at any given time.
 *
 * @module domains/skills/mirror/mirrorService
 */

import { createHash } from "node:crypto";
import pino from "pino";
import { GitHubMirrorClient, type TreeEntry } from "./githubMirrorClient";
import type { SkillRepository } from "../crud/repository";
import type { SkillService } from "../crud/service";
import type { SkillDocument } from "../../../shared/types/index";

const logger = pino({ level: "info" }).child({ module: "mirrorService" });

export interface MirrorServiceDeps {
  github: GitHubMirrorClient;
  skillRepo: SkillRepository;
  skillService: SkillService;
  /** `https://ornn.chrono-ai.fun` (no trailing slash). Used in the per-skill README footer. */
  ornnPublicOrigin: string;
  /**
   * GitHub mirror coordinates surfaced in the auto-generated READMEs
   * so the `npx skills add <owner>/<repo>/<name>` snippet always
   * reflects the operator's actual mirror repo, not a hardcoded
   * `ChronoAIProject/ornn-skills` placeholder. Sourced from the
   * `GITHUB_MIRROR_REPO_OWNER` + `GITHUB_MIRROR_REPO_NAME` env vars
   * on the configmap; whatever you change there flows into the next
   * sync's README content.
   */
  mirrorRepoOwner: string;
  mirrorRepoName: string;
}

export interface ReconcileResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * Test seam — `mirror.enabled` short-circuits the whole class. When
 * `false`, every public method is a no-op so the publish path is safe
 * to call regardless of config.
 */
export class MirrorService {
  private readonly enabled: boolean;

  constructor(
    private readonly deps: MirrorServiceDeps,
    enabled: boolean,
  ) {
    this.enabled = enabled;
  }

  /** Eligibility predicate. Single source of truth across all paths. */
  static isEligible(skill: SkillDocument): boolean {
    return skill.isPrivate === false;
  }

  /**
   * Single umbrella the route layer calls after any mutation that
   * could change a skill's eligibility OR its content. Decides whether
   * to publish or remove based on the current DB state. Always
   * fire-and-forget from the route — never blocks the user response.
   */
  async syncSkill(guid: string): Promise<void> {
    if (!this.enabled) return;
    const skill = await this.deps.skillRepo.findByGuid(guid);
    if (!skill) {
      logger.warn({ guid }, "syncSkill: skill not found, treating as remove");
      return;
    }
    if (MirrorService.isEligible(skill)) {
      await this.publishSkill(guid);
    } else {
      // Skill exists but is now private → remove from mirror.
      await this.removeSkill(skill.name);
    }
  }

  // ────────────────────────── Public ops ──────────────────────────

  /**
   * Mirror or refresh a single skill's folder. No-op when the skill
   * isn't eligible (private), or when the skill doesn't exist anymore
   * (caller probably wanted `removeSkill`).
   */
  async publishSkill(guid: string): Promise<void> {
    if (!this.enabled) return;
    const skill = await this.deps.skillRepo.findByGuid(guid);
    if (!skill) {
      logger.warn({ guid }, "publishSkill: skill not found, skipping");
      return;
    }
    if (!MirrorService.isEligible(skill)) {
      // Important: if the skill *was* eligible before and got flipped
      // private, the caller's responsibility is to also fire
      // `removeSkill(name)` to take it off the mirror. We don't infer
      // that here because we don't know the prior state.
      logger.info({ guid, name: skill.name }, "publishSkill: skill not eligible, skipping");
      return;
    }
    const desired = await this.buildSkillFolder(skill);
    await this.commitSkillFolderChange(skill.name, desired, "publish");
  }

  /**
   * Remove a single skill's folder from the mirror. No-op when the
   * folder isn't present (idempotent).
   */
  async removeSkill(name: string): Promise<void> {
    if (!this.enabled) return;
    await this.commitSkillFolderChange(name, null, "remove");
  }

  /**
   * Full sweep: scan every eligible skill, fetch its payload, diff
   * against the mirror's current state, write a single commit
   * containing all add/update/remove deltas. Idempotent — running
   * twice in a row with no Ornn changes between produces zero new
   * commits the second time (one read of the tree, no writes).
   */
  async reconcileAll(): Promise<ReconcileResult> {
    if (!this.enabled) {
      return { added: 0, updated: 0, removed: 0, unchanged: 0 };
    }
    const eligible = await this.deps.skillRepo.findAllEligibleForMirror();
    logger.info({ count: eligible.length }, "reconcileAll: found eligible skills");

    // Build the desired full state in memory.
    const desired = new Map<string, string>(); // path → content
    for (const skill of eligible) {
      const folder = await this.buildSkillFolder(skill);
      for (const [relPath, content] of folder) {
        desired.set(`${skill.name}/${relPath}`, content);
      }
    }
    desired.set("README.md", this.repoReadme());

    // Read current state of the mirror.
    const headCommit = await this.deps.github.getDefaultBranchHead();
    const currentEntries: TreeEntry[] = headCommit
      ? await this.deps.github
          .getRecursiveTree(await this.deps.github.getCommitTreeSha(headCommit))
          .then((entries) => entries.filter((e) => e.type === "blob"))
      : [];
    const currentByPath = new Map<string, TreeEntry>();
    for (const e of currentEntries) currentByPath.set(e.path, e);

    // Diff.
    const result: ReconcileResult = { added: 0, updated: 0, removed: 0, unchanged: 0 };
    const changes: TreeEntry[] = [];
    for (const [path, content] of desired) {
      const existingSha = currentByPath.get(path)?.sha;
      const desiredSha = computeGitBlobSha(content);
      if (existingSha === desiredSha) {
        result.unchanged++;
        continue;
      }
      // Upload a new blob for this path. We could try to reuse an
      // existing blob with the same SHA elsewhere in the tree, but
      // GitHub deduplicates blob storage by SHA anyway — uploading is
      // free if the content is identical to one already stored.
      const newSha = await this.deps.github.createBlob(content);
      changes.push({ path, mode: "100644", type: "blob", sha: newSha });
      if (existingSha) result.updated++;
      else result.added++;
    }
    // Anything currently in the mirror but not in `desired` is a delete.
    for (const path of currentByPath.keys()) {
      if (!desired.has(path)) {
        changes.push({ path, mode: "100644", type: "blob", sha: null as unknown as string });
        result.removed++;
      }
    }

    if (changes.length === 0) {
      logger.info({ ...result }, "reconcileAll: tree already matches; no commit");
      return result;
    }

    await this.writeCommitAndTag({
      changes,
      parentCommit: headCommit,
      message: `mirror: reconcile (added=${result.added}, updated=${result.updated}, removed=${result.removed})`,
    });
    logger.info({ ...result }, "reconcileAll: committed");
    return result;
  }

  // ────────────────────────── Internals ──────────────────────────

  /**
   * Materialize a skill's folder content as a `relativePath → content`
   * map. The folder shape we publish:
   *
   *   <name>/
   *   ├── SKILL.md            ← from the skill package
   *   ├── references/...      ← from the skill package
   *   ├── scripts/...         ← from the skill package
   *   ├── assets/...          ← from the skill package (if any)
   *   └── README.md           ← auto-generated mirror footer
   */
  private async buildSkillFolder(skill: SkillDocument): Promise<Map<string, string>> {
    // Reuse the existing `/skills/:id/json` extraction so we don't
    // duplicate ZIP logic. Pulls latest version.
    const json = await this.deps.skillService.getSkillJson(skill.guid);
    const out = new Map<string, string>();
    for (const [path, content] of Object.entries(json.files)) {
      // Drop README.md from the package if any, since we're writing
      // our own auto-generated one. (Frontend's per-skill README
      // is rare; SKILL.md is the canonical doc.)
      if (path.toLowerCase() === "readme.md") continue;
      out.set(path, content);
    }
    out.set("README.md", this.skillReadme(skill));
    return out;
  }

  /** `<owner>/<repo>` shorthand used in install snippets. */
  private get repoSlug(): string {
    return `${this.deps.mirrorRepoOwner}/${this.deps.mirrorRepoName}`;
  }

  private skillReadme(skill: SkillDocument): string {
    const url = `${this.deps.ornnPublicOrigin}/skills/${encodeURIComponent(skill.name)}`;
    const ts = new Date().toISOString();
    return [
      `# ${skill.name}`,
      "",
      `> ${skill.description}`,
      "",
      "---",
      "",
      `**Mirrored from [Ornn](${url}) — read-only.**`,
      "",
      `Edits here are NOT propagated back. Submit changes on Ornn.`,
      "",
      `- Latest version: \`${skill.latestVersion}\``,
      `- Last synced: \`${ts}\``,
      "",
      "## Install",
      "",
      "```bash",
      `npx skills add ${this.repoSlug}/${skill.name}`,
      "```",
      "",
      "## Use",
      "",
      "See `SKILL.md` in this folder for the full instructions an AI agent",
      "follows when this skill is loaded.",
      "",
    ].join("\n");
  }

  private repoReadme(): string {
    return [
      `# ${this.deps.mirrorRepoName}`,
      "",
      "Auto-generated, **read-only** mirror of public + system skills from",
      `[Ornn](${this.deps.ornnPublicOrigin}).`,
      "",
      "## Install a skill",
      "",
      "```bash",
      `npx skills add ${this.repoSlug}/<skill-name>`,
      "```",
      "",
      "Each subdirectory carries a `SKILL.md` and any references / scripts /",
      "assets the skill ships with. The folder name matches the canonical",
      "skill name on Ornn.",
      "",
      "## What's here",
      "",
      "- **Public skills** — anyone-can-pull skills from the Ornn registry",
      "- **System skills** — skills tied to a platform-wide NyxID service",
      "  (e.g. NyxID, twitter-api). Always public by definition.",
      "",
      "## What's not here",
      "",
      "Limited-access skills (private, shared with specific users / orgs)",
      "are **not** mirrored. Install those via NyxID-authenticated Ornn API",
      "instead — see the agent manual on Ornn for details.",
      "",
      "## Canonical source of truth",
      "",
      `Each skill's canonical version lives at`,
      `\`${this.deps.ornnPublicOrigin}/skills/<name>\`. Edits to this`,
      "GitHub repo are not propagated back; they will be overwritten by the",
      "next sync.",
      "",
      "## Sync history",
      "",
      "Every sync run leaves an annotated tag of the form",
      "`sync-<ISO timestamp>`. `git tag --list 'sync-*'` is the audit log.",
      "",
    ].join("\n");
  }

  /**
   * Common path shared by `publishSkill` and `removeSkill` — produces
   * a per-skill incremental commit. `desired === null` is the remove
   * case; otherwise it's a publish.
   */
  private async commitSkillFolderChange(
    skillName: string,
    desired: Map<string, string> | null,
    op: "publish" | "remove",
  ): Promise<void> {
    const headCommit = await this.deps.github.getDefaultBranchHead();
    if (!headCommit) {
      // First-ever push — bootstrap requires an initial commit. Defer
      // to reconcile so the bootstrap commit reflects the entire
      // current Ornn catalogue, not just one skill in isolation.
      logger.warn(
        { skillName, op },
        "commitSkillFolderChange: mirror branch missing — running reconcileAll instead",
      );
      await this.reconcileAll();
      return;
    }
    const currentTreeSha = await this.deps.github.getCommitTreeSha(headCommit);
    const currentTree = await this.deps.github.getRecursiveTree(currentTreeSha);
    const folderPrefix = `${skillName}/`;
    const currentInFolder = currentTree
      .filter((e) => e.type === "blob" && e.path.startsWith(folderPrefix))
      .map((e) => ({ path: e.path, sha: e.sha }));

    const changes: TreeEntry[] = [];
    if (desired) {
      // Build add/update entries for every desired path; mark deletes
      // for any current path that isn't in the desired set.
      const desiredPaths = new Set<string>();
      for (const [relPath, content] of desired) {
        const fullPath = `${folderPrefix}${relPath}`;
        desiredPaths.add(fullPath);
        const existing = currentInFolder.find((e) => e.path === fullPath);
        const desiredSha = computeGitBlobSha(content);
        if (existing?.sha === desiredSha) continue;
        const newSha = await this.deps.github.createBlob(content);
        changes.push({ path: fullPath, mode: "100644", type: "blob", sha: newSha });
      }
      for (const e of currentInFolder) {
        if (!desiredPaths.has(e.path)) {
          changes.push({ path: e.path, mode: "100644", type: "blob", sha: null as unknown as string });
        }
      }
    } else {
      if (currentInFolder.length === 0) {
        logger.info({ skillName }, "removeSkill: folder absent, no-op");
        return;
      }
      for (const e of currentInFolder) {
        changes.push({ path: e.path, mode: "100644", type: "blob", sha: null as unknown as string });
      }
    }

    if (changes.length === 0) {
      logger.info({ skillName, op }, "commitSkillFolderChange: no diff, skipping commit");
      return;
    }

    await this.writeCommitAndTag({
      changes,
      parentCommit: headCommit,
      message:
        op === "publish"
          ? `mirror: publish ${skillName}`
          : `mirror: remove ${skillName}`,
    });
    logger.info({ skillName, op, changes: changes.length }, "commitSkillFolderChange: committed");
  }

  private async writeCommitAndTag(opts: {
    changes: TreeEntry[];
    parentCommit: string | null;
    message: string;
  }): Promise<void> {
    const { changes, parentCommit, message } = opts;
    const baseTree = parentCommit
      ? await this.deps.github.getCommitTreeSha(parentCommit)
      : null;
    const newTreeSha = await this.deps.github.createTree(changes, baseTree);
    const commitSha = await this.deps.github.createCommit({
      message,
      treeSha: newTreeSha,
      parents: parentCommit ? [parentCommit] : [],
    });
    if (parentCommit) {
      await this.deps.github.updateDefaultBranch(commitSha);
    } else {
      await this.deps.github.createBranchRef(commitSha);
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await this.deps.github.createAnnotatedTag({
      tagName: `sync-${ts}`,
      message: `${message}\n\nSynced from ornn-api at ${ts}`,
      objectSha: commitSha,
    });
  }
}

/**
 * Compute a git blob SHA1 the same way `git hash-object` does:
 *   sha1("blob " + length + "\0" + content)
 *
 * Used to skip blob uploads when the content already matches what's
 * on the mirror — saves a round-trip per unchanged file in the
 * common reconcile case.
 */
function computeGitBlobSha(content: string): string {
  const buf = Buffer.from(content, "utf-8");
  const header = Buffer.from(`blob ${buf.length}\0`, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([header, buf]))
    .digest("hex");
}
