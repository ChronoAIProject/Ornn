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
import { GitHubAppAuth } from "./githubAppAuth";
import { GitHubMirrorClient, type TreeEntry } from "./githubMirrorClient";
import type { SkillRepository } from "../crud/repository";
import type { SkillService } from "../crud/service";
import type { SkillDocument } from "../../../shared/types/index";
import type { PlatformSettingsService } from "../../platform/service";

const logger = pino({ level: "info" }).child({ module: "mirrorService" });

export interface MirrorServiceDeps {
  skillRepo: SkillRepository;
  skillService: SkillService;
  /** `https://ornn.chrono-ai.fun` (no trailing slash). Used in the per-skill README footer. */
  ornnPublicOrigin: string;
  /**
   * Source of truth for the mirror config — kill switch, repo coords,
   * App credentials. Read on every sync so an admin patch via the admin
   * UI takes effect on the next operation without a redeploy. Cached
   * for 30s by the service itself, so repeated reads inside one sync
   * are cheap.
   */
  platformSettingsService: PlatformSettingsService;
  /**
   * Optional override — used by tests to inject a stub
   * `GitHubMirrorClient` without going through the GitHub App auth
   * factory. When set, the runtime cred fingerprint check is skipped
   * and `enabled` from DB still gates whether anything runs.
   */
  githubClientForTest?: GitHubMirrorClient;
}

export interface ReconcileResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * Mirror service — runtime-aware. Every public method first asks
 * `PlatformSettingsService` for the current mirror config; if disabled
 * or missing any of the four App fields, the call no-ops. The active
 * `GitHubMirrorClient` is cached by credential fingerprint so admin-
 * pasted creds take effect on the next call without recreating the
 * client on every blob/tree request.
 */
export class MirrorService {
  private cachedClient: { fingerprint: string; client: GitHubMirrorClient } | null = null;

  constructor(private readonly deps: MirrorServiceDeps) {
    if (deps.githubClientForTest) {
      this.cachedClient = { fingerprint: "test", client: deps.githubClientForTest };
    }
  }

  /**
   * Reads current mirror settings; returns the active client if the
   * mirror is enabled AND every required field is set, else null.
   * Rebuilds the client when credentials change so admin updates take
   * effect on the next call.
   */
  private async getActiveClient(): Promise<GitHubMirrorClient | null> {
    if (this.deps.githubClientForTest) {
      // Test seam: still gate on `enabled` so the disabled-short-circuit
      // assertion can be exercised without rebuilding the auth chain.
      const cfg = await this.deps.platformSettingsService.getGithubMirrorConfig();
      return cfg.enabled ? this.deps.githubClientForTest : null;
    }
    const cfg = await this.deps.platformSettingsService.getGithubMirrorConfig();
    if (!cfg.enabled) return null;
    if (!cfg.appId || !cfg.installationId || !cfg.appPrivateKey) return null;
    if (!cfg.owner || !cfg.repo || !cfg.branch) return null;
    const fp = fingerprintCfg(cfg);
    if (this.cachedClient && this.cachedClient.fingerprint === fp) {
      return this.cachedClient.client;
    }
    const auth = new GitHubAppAuth({
      appId: cfg.appId,
      privateKey: cfg.appPrivateKey,
      installationId: cfg.installationId,
    });
    const client = new GitHubMirrorClient(auth, async () => ({
      owner: cfg.owner,
      repo: cfg.repo,
      defaultBranch: cfg.branch,
    }));
    this.cachedClient = { fingerprint: fp, client };
    logger.info(
      { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch },
      "Mirror client (re)initialized from DB-backed config",
    );
    return client;
  }

  /** Plaintext snapshot of the current mirror state — used by routes for status responses. */
  async getRuntimeState(): Promise<{
    enabled: boolean;
    configured: boolean;
    owner: string;
    repo: string;
    branch: string;
  }> {
    const cfg = await this.deps.platformSettingsService.getGithubMirrorConfig();
    const configured =
      !!cfg.appId && !!cfg.installationId && !!cfg.appPrivateKey && !!cfg.owner && !!cfg.repo;
    return {
      enabled: cfg.enabled,
      configured,
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
    };
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
   *
   * Owns the un-mirror DB-clear path: `removeSkill(name)` itself never
   * touches the DB (it has to support the just-deleted-doc case), so
   * when un-mirror is the result of a privacy flip on an existing doc,
   * `syncSkill` clears the stamp here.
   */
  async syncSkill(guid: string): Promise<void> {
    if (!(await this.getActiveClient())) return;
    const skill = await this.deps.skillRepo.findByGuid(guid);
    if (!skill) {
      logger.warn({ guid }, "syncSkill: skill not found, treating as remove");
      return;
    }
    if (MirrorService.isEligible(skill)) {
      await this.publishSkill(guid);
    } else {
      // Skill exists but is now private → remove from mirror + clear DB stamp.
      await this.removeSkill(skill.name);
      await this.deps.skillRepo.setMirrorSyncState(guid, null);
    }
  }

  // ────────────────────────── Public ops ──────────────────────────

  /**
   * Mirror or refresh a single skill's folder. No-op when the skill
   * isn't eligible (private), or when the skill doesn't exist anymore
   * (caller probably wanted `removeSkill`).
   *
   * Stamps `mirrorSync` on the skill doc when an actual commit lands.
   * No-op commits (content already matched) leave the existing stamp
   * untouched — its `commitSha` still points at the most recent commit
   * that actually changed this skill, which is the correct audit link.
   */
  async publishSkill(guid: string): Promise<void> {
    const client = await this.getActiveClient();
    if (!client) return;
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
    const commit = await this.commitSkillFolderChange(client, skill.name, desired, "publish");
    if (commit) {
      await this.deps.skillRepo.setMirrorSyncState(guid, {
        version: skill.latestVersion,
        syncedAt: commit.committedAt,
        commitSha: commit.sha,
      });
    }
  }

  /**
   * Remove a single skill's folder from the mirror. No-op when the
   * folder isn't present (idempotent).
   */
  async removeSkill(name: string): Promise<void> {
    const client = await this.getActiveClient();
    if (!client) return;
    await this.commitSkillFolderChange(client, name, null, "remove");
  }

  /**
   * Full sweep: scan every eligible skill, fetch its payload, diff
   * against the mirror's current state, write a single commit
   * containing all add/update/remove deltas. Idempotent — running
   * twice in a row with no Ornn changes between produces zero new
   * commits the second time (one read of the tree, no writes).
   *
   * Stamps `mirrorSync` on every skill whose folder changed in this
   * commit. Skills whose content was unchanged keep their existing
   * stamp (already correct). Heals stale stamps at the start: any
   * `isPrivate: true` skill carrying a leftover `mirrorSync` (because
   * its un-mirror hook dropped on the floor) gets cleared, so the
   * cron is the safety net for incremental-hook failures.
   */
  async reconcileAll(): Promise<ReconcileResult> {
    const client = await this.getActiveClient();
    if (!client) {
      return { added: 0, updated: 0, removed: 0, unchanged: 0 };
    }

    // Heal stale stamps before doing anything else.
    await this.deps.skillRepo.clearMirrorSyncForIneligibleSkills();

    const eligible = await this.deps.skillRepo.findAllEligibleForMirror();
    logger.info({ count: eligible.length }, "reconcileAll: found eligible skills");

    // Build the desired full state in memory + name → guid/version index
    // so we can stamp `mirrorSync` on the skills that get touched.
    const desired = new Map<string, string>(); // path → content
    const skillByName = new Map<string, { guid: string; version: string }>();
    for (const skill of eligible) {
      skillByName.set(skill.name, { guid: skill.guid, version: skill.latestVersion });
      const folder = await this.buildSkillFolder(skill);
      for (const [relPath, content] of folder) {
        desired.set(`${skill.name}/${relPath}`, content);
      }
    }
    desired.set("README.md", await this.repoReadme());

    // Read current state of the mirror.
    const headCommit = await client.getDefaultBranchHead();
    const currentEntries: TreeEntry[] = headCommit
      ? await client
          .getRecursiveTree(await client.getCommitTreeSha(headCommit))
          .then((entries) => entries.filter((e) => e.type === "blob"))
      : [];
    const currentByPath = new Map<string, TreeEntry>();
    for (const e of currentEntries) currentByPath.set(e.path, e);

    // Diff.
    const result: ReconcileResult = { added: 0, updated: 0, removed: 0, unchanged: 0 };
    const changes: TreeEntry[] = [];
    const touchedSkillNames = new Set<string>();
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
      const newSha = await client.createBlob(content);
      changes.push({ path, mode: "100644", type: "blob", sha: newSha });
      const folderName = pathSkillFolder(path);
      if (folderName && skillByName.has(folderName)) touchedSkillNames.add(folderName);
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

    const commit = await this.writeCommitAndTag(client, {
      changes,
      parentCommit: headCommit,
      message: `mirror: reconcile (added=${result.added}, updated=${result.updated}, removed=${result.removed})`,
    });
    logger.info({ ...result }, "reconcileAll: committed");

    // Stamp every touched skill with the new commit. Single bulk write.
    if (touchedSkillNames.size > 0) {
      const updates = [...touchedSkillNames].map((name) => {
        const meta = skillByName.get(name)!;
        return {
          guid: meta.guid,
          state: {
            version: meta.version,
            syncedAt: commit.committedAt,
            commitSha: commit.sha,
          },
        };
      });
      await this.deps.skillRepo.setMirrorSyncStateBulk(updates);
    }

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
    out.set("README.md", await this.skillReadme(skill));
    return out;
  }

  /** `<owner>/<repo>` shorthand used in install snippets. Resolved at
   * call time from the platform-settings cache so an admin re-point
   * propagates into READMEs on the next sync. */
  private async getRepoSlug(): Promise<string> {
    const cfg = await this.deps.platformSettingsService.getGithubMirrorConfig();
    return `${cfg.owner}/${cfg.repo}`;
  }

  /** Mirror repo name on its own. Used as the H1 in the top-level
   * README (`# ornn-skills`). */
  private async getRepoName(): Promise<string> {
    const cfg = await this.deps.platformSettingsService.getGithubMirrorConfig();
    return cfg.repo;
  }

  private async skillReadme(skill: SkillDocument): Promise<string> {
    const url = `${this.deps.ornnPublicOrigin}/skills/${encodeURIComponent(skill.name)}`;
    const ts = new Date().toISOString();
    const slug = await this.getRepoSlug();
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
      `npx skills add ${slug}/${skill.name}`,
      "```",
      "",
      "## Use",
      "",
      "See `SKILL.md` in this folder for the full instructions an AI agent",
      "follows when this skill is loaded.",
      "",
    ].join("\n");
  }

  private async repoReadme(): Promise<string> {
    const slug = await this.getRepoSlug();
    const name = await this.getRepoName();
    return [
      `# ${name}`,
      "",
      "Auto-generated, **read-only** mirror of public + system skills from",
      `[Ornn](${this.deps.ornnPublicOrigin}).`,
      "",
      "## Install a skill",
      "",
      "```bash",
      `npx skills add ${slug}/<skill-name>`,
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
   *
   * Returns `{ sha, committedAt }` when a commit lands, or `null` when
   * the operation was a no-op (no diff) or got deferred to a full
   * reconcile (first-push bootstrap). Callers use the return value to
   * decide whether to stamp `mirrorSync` on the DB.
   */
  private async commitSkillFolderChange(
    client: GitHubMirrorClient,
    skillName: string,
    desired: Map<string, string> | null,
    op: "publish" | "remove",
  ): Promise<{ sha: string; committedAt: Date } | null> {
    const headCommit = await client.getDefaultBranchHead();
    if (!headCommit) {
      // First-ever push — bootstrap requires an initial commit. Defer
      // to reconcile so the bootstrap commit reflects the entire
      // current Ornn catalogue, not just one skill in isolation.
      // Reconcile stamps everything itself; we return null here so
      // the caller doesn't double-stamp.
      logger.warn(
        { skillName, op },
        "commitSkillFolderChange: mirror branch missing — running reconcileAll instead",
      );
      await this.reconcileAll();
      return null;
    }
    const currentTreeSha = await client.getCommitTreeSha(headCommit);
    const currentTree = await client.getRecursiveTree(currentTreeSha);
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
        const newSha = await client.createBlob(content);
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
        return null;
      }
      for (const e of currentInFolder) {
        changes.push({ path: e.path, mode: "100644", type: "blob", sha: null as unknown as string });
      }
    }

    if (changes.length === 0) {
      logger.info({ skillName, op }, "commitSkillFolderChange: no diff, skipping commit");
      return null;
    }

    const commit = await this.writeCommitAndTag(client, {
      changes,
      parentCommit: headCommit,
      message:
        op === "publish"
          ? `mirror: publish ${skillName}`
          : `mirror: remove ${skillName}`,
    });
    logger.info({ skillName, op, changes: changes.length }, "commitSkillFolderChange: committed");
    return commit;
  }

  private async writeCommitAndTag(
    client: GitHubMirrorClient,
    opts: {
      changes: TreeEntry[];
      parentCommit: string | null;
      message: string;
    },
  ): Promise<{ sha: string; committedAt: Date }> {
    const { changes, parentCommit, message } = opts;
    const baseTree = parentCommit
      ? await client.getCommitTreeSha(parentCommit)
      : null;
    const newTreeSha = await client.createTree(changes, baseTree);
    const commitSha = await client.createCommit({
      message,
      treeSha: newTreeSha,
      parents: parentCommit ? [parentCommit] : [],
    });
    if (parentCommit) {
      await client.updateDefaultBranch(commitSha);
    } else {
      await client.createBranchRef(commitSha);
    }
    const committedAt = new Date();
    const ts = committedAt.toISOString().replace(/[:.]/g, "-");
    await client.createAnnotatedTag({
      tagName: `sync-${ts}`,
      message: `${message}\n\nSynced from ornn-api at ${ts}`,
      objectSha: commitSha,
    });
    return { sha: commitSha, committedAt };
  }
}

/**
 * Stable hash over the credentials + repo coordinates so the cached
 * client is invalidated when an admin pastes new App creds. Hashing the
 * private key avoids holding raw key material in a string concat that
 * could end up in a log or stack trace.
 */
function fingerprintCfg(cfg: {
  appId: string;
  installationId: string;
  appPrivateKey: string;
  owner: string;
  repo: string;
  branch: string;
}): string {
  const keyHash = createHash("sha256").update(cfg.appPrivateKey).digest("hex").slice(0, 12);
  return `${cfg.appId}:${cfg.installationId}:${keyHash}:${cfg.owner}/${cfg.repo}@${cfg.branch}`;
}

/**
 * Tree paths shaped like `<skill-name>/SKILL.md` ⇒ "skill-name". Returns
 * null for top-level paths (e.g. `README.md`) which don't belong to any
 * skill and shouldn't trigger a `mirrorSync` stamp.
 */
function pathSkillFolder(path: string): string | null {
  const idx = path.indexOf("/");
  if (idx <= 0) return null;
  return path.slice(0, idx);
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
