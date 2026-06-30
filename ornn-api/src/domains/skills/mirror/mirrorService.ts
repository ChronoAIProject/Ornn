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
import { createLogger } from "../../../shared/logger";
import { GitHubAppAuth } from "./githubAppAuth";
import { GitHubMirrorClient, type TreeEntry } from "./githubMirrorClient";
import type { SkillRepository } from "../crud/repository";
import type { SkillService } from "../crud/service";
import { SYSTEM_ACTOR } from "../crud/authorize";
import type { SkillDocument } from "../../../shared/types/index";
import type { MirrorSection } from "../../settings/sections/mirror";
import { SKILL_NAME_REGEX, SKILL_NAME_MAX } from "../../../shared/schemas/skillFrontmatter";
import {
  buildMarketplaceJson,
  buildPluginJson,
  MARKETPLACE_MANIFEST_PATH,
  PLUGIN_MANIFEST_RELPATH,
  type MarketplacePluginInput,
} from "./marketplaceManifest";
import {
  buildSkillsetPlugin,
  isSafeMemberName,
  skillsetMarketplaceInput,
  SKILLSET_FOLDER,
  type SkillsetPluginMember,
} from "./skillsetPlugin";
import { SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS } from "../../skillsets/types";
import type { SkillsetDocument } from "../../skillsets/types";

const logger = createLogger("mirrorService");

/**
 * Narrow surface MirrorService needs from SettingsService. Decouples
 * the dep from the full SettingsService interface so tests can stub
 * just this method.
 */
export interface MirrorSettingsReader {
  getMirror(): Promise<MirrorSection>;
}

/**
 * Narrow skillset-repo surface the mirror needs (#1155) — just the
 * plugin-export-eligible enumeration. Decoupled from `SkillsetRepository` so
 * tests inject a one-method fake.
 */
export interface MirrorSkillsetRepo {
  findAllEligibleForMirror(): Promise<SkillsetDocument[]>;
  /**
   * Export-eligible skillsets referencing the given member skill (#1159).
   * Drives the targeted re-export so a member content / dist-tag change
   * rebuilds only the affected `skillsets/<name>/` subtrees, not a full sweep.
   */
  findEligibleSkillsetsByMember(
    skillName: string,
    skillGuid: string,
  ): Promise<SkillsetDocument[]>;
}

/**
 * Narrow skillset-service surface the mirror needs (#1155) — the latest
 * version's member refs + master prompt for a skillset being exported.
 */
export interface MirrorSkillsetSource {
  getLatestForMirror(
    guid: string,
  ): Promise<{ members: string[]; instructions: string } | null>;
}

export interface MirrorServiceDeps {
  skillRepo: SkillRepository;
  skillService: SkillService;
  /**
   * Skillset plugin-export deps (#1155). OPTIONAL: when either is unset the
   * mirror simply exports no skillset plugins (graceful for tests / configs
   * that don't wire skillsets). Production bootstrap always passes both.
   */
  skillsetRepo?: MirrorSkillsetRepo;
  skillsetService?: MirrorSkillsetSource;
  /** `https://ornn.chrono-ai.fun` (no trailing slash). Used in the per-skill README footer. */
  ornnPublicOrigin: string;
  /**
   * Source of truth for the mirror config — kill switch, repo coords,
   * App credentials. Read on every sync so an admin patch via the admin
   * UI takes effect on the next operation without a redeploy. Cached
   * for 30s by SettingsService itself, so repeated reads inside one
   * sync are cheap.
   */
  settingsService: MirrorSettingsReader;
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
 * `SettingsService` for the current mirror config; if disabled or
 * missing any of the four App fields, the call no-ops. The active
 * `GitHubMirrorClient` is cached by credential fingerprint so admin-
 * pasted creds take effect on the next call without recreating the
 * client on every blob/tree request.
 */
export class MirrorService {
  private cachedClient: { fingerprint: string; client: GitHubMirrorClient } | null = null;
  /**
   * In-flight `reconcileAll` guard (#1155). Mutation-driven triggers
   * (skillset create/publish/delete, skill-visibility flips) now fire
   * reconciles fire-and-forget alongside the cron, so concurrent runs are
   * possible. Coalescing onto the running promise serializes them — a second
   * caller rides the in-flight sweep instead of racing a second commit against
   * the same branch head. The cron is the safety net for anything a coalesced
   * caller misses.
   */
  private reconcileInFlight: Promise<ReconcileResult> | null = null;

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
      const cfg = await this.deps.settingsService.getMirror();
      return cfg.enabled ? this.deps.githubClientForTest : null;
    }
    const cfg = await this.deps.settingsService.getMirror();
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
    const cfg = await this.deps.settingsService.getMirror();
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
   * Targeted re-export (#1159): rebuild ONLY the `skillsets/<name>/` subtrees
   * of the export-eligible skillsets that reference the given member skill, in
   * a SINGLE commit. Fired fire-and-forget from the skill content-change paths
   * (new-version publish, GitHub refresh, dist-tag move) so an exported
   * skillset referencing the skill via `@latest`/`@tag` reflects the change
   * immediately instead of waiting up to 24h for the cron reconcile.
   *
   * No-ops cleanly when the mirror is disabled, skillset deps are unwired, no
   * eligible skillset references the skill, or every affected skillset is
   * unresolvable. Deterministic: an unchanged subtree (e.g. a member ref pinned
   * to a fixed version, so the resolved-member fingerprint is unmoved) produces
   * no diff and therefore no commit.
   *
   * reconcileInFlight handling: when a full reconcile is already running it
   * rebuilds EVERY eligible skillset subtree anyway, so we defer to it rather
   * than racing a second commit against the same branch head. The cron remains
   * the backstop if that reconcile somehow misses this skill.
   */
  async syncSkillsetsForMember(skillGuid: string, skillName: string): Promise<void> {
    const client = await this.getActiveClient();
    if (!client) return;
    if (!this.deps.skillsetRepo || !this.deps.skillsetService) return;

    if (this.reconcileInFlight) {
      logger.info(
        { skillGuid, skillName },
        "syncSkillsetsForMember: reconcile in flight — deferring the targeted re-export to it",
      );
      return;
    }

    const affected = await this.deps.skillsetRepo.findEligibleSkillsetsByMember(
      skillName,
      skillGuid,
    );
    if (affected.length === 0) {
      logger.debug(
        { skillGuid, skillName },
        "syncSkillsetsForMember: no eligible skillset references this skill",
      );
      return;
    }

    // Build every affected subtree, then commit them all in one shot. A subtree
    // that no longer exports (now <2 public members, #1161) still gets its
    // folder prefix added — with NO desired paths — so the shared commit core
    // deletes its stale `skillsets/<name>/` blobs (the plugin is un-exported).
    const desired = new Map<string, string>();
    const folderPrefixes: string[] = [];
    const rebuilt: string[] = [];
    const removed: string[] = [];
    for (const ss of affected) {
      // An unsafe name can't form a prefix safely and should never have been
      // published — skip it entirely (neither rebuild nor remove).
      if (!isSafeSkillFolderName(ss.name)) continue;
      folderPrefixes.push(`${SKILLSET_FOLDER}/${ss.name}/`);
      const subtree = await this.buildOneSkillsetSubtree(ss);
      if (subtree) {
        for (const [path, content] of subtree.files) desired.set(path, content);
        rebuilt.push(ss.name);
      } else {
        removed.push(ss.name);
      }
    }
    if (folderPrefixes.length === 0) {
      logger.debug(
        { skillGuid, skillName, affected: affected.length },
        "syncSkillsetsForMember: affected skillsets have unsafe names — nothing to do",
      );
      return;
    }

    const commit = await this.commitFolderSubtrees(client, {
      folderPrefixes,
      desired,
      op: "skillset-sync",
      message: `mirror: re-export skillsets for ${skillName}`,
    });
    logger.info(
      { skillGuid, skillName, rebuilt, removed, committed: !!commit },
      "syncSkillsetsForMember: targeted re-export complete",
    );
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
    // Coalesce concurrent reconciles onto the in-flight run (#1155).
    if (this.reconcileInFlight) {
      logger.info("reconcileAll: a sweep is already running — coalescing");
      return this.reconcileInFlight;
    }
    this.reconcileInFlight = this.runReconcile().finally(() => {
      this.reconcileInFlight = null;
    });
    return this.reconcileInFlight;
  }

  private async runReconcile(): Promise<ReconcileResult> {
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
    // Collected in lockstep with the folders we publish so the root
    // marketplace.json (#1153) lists exactly the skills we mirror.
    const manifestInputs: MarketplacePluginInput[] = [];
    for (const skill of eligible) {
      // #807 (CWE-22): skip — do NOT abort — a row whose name would
      // escape its `<name>/` subtree. One poisoned row must not stop the
      // whole sweep from mirroring every other (safe) skill.
      if (!SKILL_NAME_REGEX.test(skill.name) || skill.name.length > SKILL_NAME_MAX) {
        logger.error(
          { guid: skill.guid, name: skill.name },
          "reconcileAll: skipping skill with unsafe folder name",
        );
        continue;
      }
      skillByName.set(skill.name, { guid: skill.guid, version: skill.latestVersion });
      manifestInputs.push(toMarketplaceInput(skill));
      const folder = await this.buildSkillFolder(skill);
      for (const [relPath, content] of folder) {
        desired.set(`${skill.name}/${relPath}`, content);
      }
    }
    desired.set("README.md", await this.repoReadme());
    const mirrorCfg = await this.deps.settingsService.getMirror();

    // #1155/#1161 — second export layer: each opted-in skillset with ≥2 public
    // members becomes ONE curated multi-skill plugin (of its public subset)
    // under `skillsets/<name>/`, and adds its own entry to the SAME root
    // marketplace.json alongside the per-skill ones.
    const skillsetPluginInputs = await this.buildEligibleSkillsetSubtrees(desired);

    desired.set(
      MARKETPLACE_MANIFEST_PATH,
      buildMarketplaceJson([...manifestInputs, ...skillsetPluginInputs], {
        name: mirrorCfg.repo,
        owner: { name: mirrorCfg.owner },
      }),
    );
    logger.debug(
      { skills: manifestInputs.length, skillsets: skillsetPluginInputs.length },
      "reconcileAll: regenerated Claude Code marketplace.json",
    );

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
    // duplicate ZIP logic. Pulls latest version. Mirror is a trusted
    // server job, so it reads with SYSTEM_ACTOR (#806) — the eligibility
    // filter already guarantees only fully-public skills reach here.
    const json = await this.deps.skillService.getSkillJson(skill.guid, SYSTEM_ACTOR);
    const out = new Map<string, string>();
    for (const [path, content] of Object.entries(json.files)) {
      // Drop README.md from the package if any, since we're writing
      // our own auto-generated one. (Frontend's per-skill README
      // is rare; SKILL.md is the canonical doc.)
      if (path.toLowerCase() === "readme.md") continue;
      out.set(path, content);
    }
    out.set("README.md", await this.skillReadme(skill));
    // Per-skill plugin manifest so this folder is a valid one-skill
    // Claude Code plugin (#1153). Rides every publish + reconcile path.
    out.set(PLUGIN_MANIFEST_RELPATH, buildPluginJson(toMarketplaceInput(skill)));
    return out;
  }

  /** `<owner>/<repo>` shorthand used in install snippets. Resolved at
   * call time from the platform-settings cache so an admin re-point
   * propagates into READMEs on the next sync. */
  private async getRepoSlug(): Promise<string> {
    const cfg = await this.deps.settingsService.getMirror();
    return `${cfg.owner}/${cfg.repo}`;
  }

  /** Mirror repo name on its own. Used as the H1 in the top-level
   * README (`# ornn-skills`). */
  private async getRepoName(): Promise<string> {
    const cfg = await this.deps.settingsService.getMirror();
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
  /**
   * Defense-in-depth (#807, CWE-22): the create/import path already
   * rejects non-kebab-case names, but a row that predates that fix (or
   * one written by some future path) could still carry a name like
   * `../evil` or `a/b`. Every site that interpolates `skill.name` into a
   * mirror blob path runs this guard first so a poisoned name can never
   * escape its own `<name>/` subtree in the public mirror repo.
   */
  private assertSafeSkillFolder(name: string): void {
    if (!SKILL_NAME_REGEX.test(name) || name.length > SKILL_NAME_MAX) {
      logger.error({ name }, "mirror: refusing unsafe skill folder name");
      throw new Error(`Unsafe mirror skill folder name: ${name}`);
    }
  }

  private async commitSkillFolderChange(
    client: GitHubMirrorClient,
    skillName: string,
    desired: Map<string, string> | null,
    op: "publish" | "remove",
  ): Promise<{ sha: string; committedAt: Date } | null> {
    // Guard before any path interpolation. Throwing is correct here: the
    // call is scoped to a single skill (publishSkill / removeSkill), so a
    // bad name fails just that operation, never a batch.
    this.assertSafeSkillFolder(skillName);
    const folderPrefix = `${skillName}/`;
    // Re-key the per-skill RELATIVE paths to full mirror paths so the shared
    // subtree-commit core can diff them against the current tree.
    const desiredFull = desired
      ? new Map<string, string>(
          [...desired].map(([rel, content]) => [`${folderPrefix}${rel}`, content]),
        )
      : null;
    return this.commitFolderSubtrees(client, {
      folderPrefixes: [folderPrefix],
      desired: desiredFull,
      op,
      message: op === "publish" ? `mirror: publish ${skillName}` : `mirror: remove ${skillName}`,
    });
  }

  /**
   * Shared incremental-commit core (#1153/#1159). Diffs a combined
   * `fullPath → content` desired map against the current mirror tree,
   * RESTRICTED to `folderPrefixes`, and writes ONE commit with the add /
   * update / delete deltas. Generalizes the original per-skill `<name>/` commit
   * to an arbitrary set of subtrees, so a single member change can re-export
   * every affected `skillsets/<name>/` subtree in one commit.
   *
   *   - `desired === null` removes every blob under the prefixes (the per-skill
   *     remove case). Otherwise each prefix is fully reconciled to `desired`: a
   *     current blob under a prefix that isn't in `desired` is deleted.
   *   - The root marketplace.json (#1153) is refreshed in the SAME commit, but
   *     stages a blob ONLY when its content actually changed — a content-only
   *     member bump leaves the plain catalogue entry unmoved → no manifest
   *     churn.
   *   - No diff (and no manifest change) ⇒ no commit (deterministic).
   *   - First-ever push (no branch head) defers to `reconcileAll` so the
   *     bootstrap commit reflects the whole catalogue; returns null so the
   *     caller doesn't double-stamp.
   */
  private async commitFolderSubtrees(
    client: GitHubMirrorClient,
    opts: {
      folderPrefixes: string[];
      desired: Map<string, string> | null;
      op: string;
      message: string;
    },
  ): Promise<{ sha: string; committedAt: Date } | null> {
    const { folderPrefixes, desired, op, message } = opts;
    const headCommit = await client.getDefaultBranchHead();
    if (!headCommit) {
      logger.warn({ op }, "commitFolderSubtrees: mirror branch missing — running reconcileAll instead");
      await this.reconcileAll();
      return null;
    }
    const currentTree = await client.getRecursiveTree(await client.getCommitTreeSha(headCommit));
    const currentInFolders = currentTree
      .filter((e) => e.type === "blob" && folderPrefixes.some((p) => e.path.startsWith(p)))
      .map((e) => ({ path: e.path, sha: e.sha }));

    const changes: TreeEntry[] = [];
    if (desired) {
      const desiredPaths = new Set<string>();
      for (const [fullPath, content] of desired) {
        desiredPaths.add(fullPath);
        const existing = currentInFolders.find((e) => e.path === fullPath);
        const desiredSha = computeGitBlobSha(content);
        if (existing?.sha === desiredSha) continue;
        const newSha = await client.createBlob(content);
        changes.push({ path: fullPath, mode: "100644", type: "blob", sha: newSha });
      }
      for (const e of currentInFolders) {
        if (!desiredPaths.has(e.path)) {
          changes.push({ path: e.path, mode: "100644", type: "blob", sha: null as unknown as string });
        }
      }
    } else {
      for (const e of currentInFolders) {
        changes.push({ path: e.path, mode: "100644", type: "blob", sha: null as unknown as string });
      }
    }

    // The root marketplace.json is a function of the WHOLE public set, so a
    // targeted commit refreshes it too — but only when its content changed.
    await this.appendMarketplaceManifestChange(client, currentTree, changes);

    if (changes.length === 0) {
      logger.info({ op, prefixes: folderPrefixes.length }, "commitFolderSubtrees: no diff, skipping commit");
      return null;
    }

    const commit = await this.writeCommitAndTag(client, {
      changes,
      parentCommit: headCommit,
      message,
    });
    logger.info({ op, changes: changes.length }, "commitFolderSubtrees: committed");
    return commit;
  }

  /**
   * Regenerate the root marketplace.json from the current public set
   * and stage a blob change when it differs from the mirror. Shared by
   * the incremental publish/remove paths (#1153).
   */
  private async appendMarketplaceManifestChange(
    client: GitHubMirrorClient,
    currentTree: TreeEntry[],
    changes: TreeEntry[],
  ): Promise<void> {
    const eligible = await this.deps.skillRepo.findAllEligibleForMirror();
    const cfg = await this.deps.settingsService.getMirror();
    // #1155 — the catalogue is the union of per-skill AND skillset plugins.
    // A skill edit must never drop the skillset entries, so include them here
    // (lightweight: no member-file resolution, just the catalogue rows).
    const skillsetInputs = await this.eligibleSkillsetMarketplaceInputs();
    const content = buildMarketplaceJson([...toManifestInputs(eligible), ...skillsetInputs], {
      name: cfg.repo,
      owner: { name: cfg.owner },
    });
    const existing = currentTree.find(
      (e) => e.type === "blob" && e.path === MARKETPLACE_MANIFEST_PATH,
    );
    if (existing?.sha === computeGitBlobSha(content)) return;
    const sha = await client.createBlob(content);
    changes.push({ path: MARKETPLACE_MANIFEST_PATH, mode: "100644", type: "blob", sha });
  }

  /**
   * Marketplace catalogue rows for every skillset that ACTUALLY exports (#1155,
   * #1161) — opted-in, safe-named, AND carrying ≥2 public members (so a subtree
   * is built). The public-member check resolves members under SYSTEM (no file
   * fetch), which keeps the shared marketplace.json in lockstep with the
   * subtrees the reconcile path writes: a skillset dropped for too few public
   * members must not linger as a dangling `./skillsets/<name>` catalogue row.
   * Returns `[]` when skillset deps aren't wired.
   */
  private async eligibleSkillsetMarketplaceInputs(): Promise<MarketplacePluginInput[]> {
    if (!this.deps.skillsetRepo) return [];
    const eligible = await this.deps.skillsetRepo.findAllEligibleForMirror();
    const inputs: MarketplacePluginInput[] = [];
    for (const ss of eligible) {
      if (!isSafeSkillFolderName(ss.name)) continue;
      if ((await this.countSkillsetPublicMembers(ss)) < SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS) continue;
      // #1157 — owner overrides win over the skillset defaults, matching the
      // full-reconcile subtree path so the shared marketplace.json never drifts.
      inputs.push(
        skillsetMarketplaceInput({
          name: ss.name,
          description: ss.pluginConfig?.description ?? ss.description,
          version: ss.latestVersion,
          keywords: ss.pluginConfig?.keywords ?? ss.tags,
        }),
      );
    }
    return inputs;
  }

  /**
   * For every plugin-export-eligible skillset (#1155/#1161): resolve its
   * members to concrete skill packages, assemble the public-subset
   * `skills/<member>/…` + plugin.json + README subtree via
   * {@link buildSkillsetPlugin}, and stage it into `desired` under
   * `skillsets/<name>/…`. Returns the marketplace catalogue rows so the caller
   * can merge them into the shared root marketplace.json.
   *
   * A skillset that can't be exported (no version, or fewer than 2 public
   * members remaining) is skipped — its stale subtree, if any, is removed by the
   * reconcile-wide diff. One bad skillset never aborts the sweep.
   */
  private async buildEligibleSkillsetSubtrees(
    desired: Map<string, string>,
  ): Promise<MarketplacePluginInput[]> {
    if (!this.deps.skillsetRepo || !this.deps.skillsetService) return [];
    const eligible = await this.deps.skillsetRepo.findAllEligibleForMirror();
    logger.info({ count: eligible.length }, "reconcileAll: found plugin-export-eligible skillsets");

    const marketplaceInputs: MarketplacePluginInput[] = [];
    for (const ss of eligible) {
      const subtree = await this.buildOneSkillsetSubtree(ss);
      if (!subtree) continue;
      for (const [path, content] of subtree.files) desired.set(path, content);
      marketplaceInputs.push(subtree.marketplace);
    }
    return marketplaceInputs;
  }

  /**
   * Assemble ONE skillset's `skillsets/<name>/…` subtree (#1155/#1159/#1161):
   * resolve its latest-version members under SYSTEM, bundle ONLY the public,
   * resolvable members (dropping private / unresolvable ones), build the
   * multi-skill plugin via {@link buildSkillsetPlugin}, and return the file map
   * already prefixed under `skillsets/<name>/` plus the marketplace catalogue
   * row. The dropped members are listed in the README; nothing private is ever
   * bundled.
   *
   * Returns `null` — so the caller removes / skips the subtree — when the
   * skillset can't be exported: unsafe name, no published version, skillset deps
   * unwired, or FEWER THAN {@link SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS} public
   * members remain (#1161). Shared by the full reconcile sweep and the targeted
   * per-member re-export.
   */
  private async buildOneSkillsetSubtree(
    ss: SkillsetDocument,
  ): Promise<{ files: Map<string, string>; marketplace: MarketplacePluginInput } | null> {
    if (!this.deps.skillsetService) return null;
    // #807 — skip (don't abort) a skillset whose name would escape its subtree.
    if (!isSafeSkillFolderName(ss.name)) {
      logger.error({ guid: ss.guid, name: ss.name }, "mirror: skipping unsafe skillset name");
      return null;
    }
    const latest = await this.deps.skillsetService.getLatestForMirror(ss.guid);
    if (!latest) {
      logger.warn({ guid: ss.guid, name: ss.name }, "mirror: skillset has no version; skipping");
      return null;
    }
    const cfg = await this.deps.settingsService.getMirror();
    const pluginCfg = {
      ornnPublicOrigin: this.deps.ornnPublicOrigin,
      repoSlug: `${cfg.owner}/${cfg.repo}`,
      repoName: cfg.repo,
    };

    // Resolve each member under SYSTEM and partition into public-resolvable
    // (bundled) vs private/unresolvable (excluded → README note only). Only the
    // public subset's files are ever fetched, so a private member's content can
    // never leak into the public mirror (#1161).
    const load = this.deps.skillService.createVersionLoader(SYSTEM_ACTOR);
    const members: SkillsetPluginMember[] = [];
    const includedNames = new Set<string>();
    const excludedMembers: string[] = [];
    for (const ref of latest.members) {
      const node = await load(ref);
      if (!node) {
        excludedMembers.push(memberRefName(ref));
        logger.warn({ skillset: ss.name, ref }, "mirror: skillset member unresolvable; excluding");
        continue;
      }
      if (node.isPrivate !== false || !isSafeMemberName(node.name)) {
        excludedMembers.push(node.name);
        logger.info(
          { skillset: ss.name, member: node.name },
          "mirror: skillset member private/unsafe; excluding from public plugin",
        );
        continue;
      }
      if (includedNames.has(node.name)) continue; // de-dupe (mirrors normalizeMembers)
      includedNames.add(node.name);
      const json = await this.deps.skillService.getSkillJson(
        node.guid ?? node.name,
        SYSTEM_ACTOR,
        node.version,
      );
      const files: Record<string, string> = {};
      for (const [path, content] of Object.entries(json.files)) files[path] = content;
      members.push({ name: node.name, version: node.version, description: json.description, files });
    }

    // Guard: keep exporting only while ≥2 public members remain. Below the
    // floor the subtree is null → the reconcile / targeted path removes any
    // existing `skillsets/<name>/` (the plugin is un-exported).
    if (includedNames.size < SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS) {
      logger.info(
        { guid: ss.guid, name: ss.name, publicMembers: includedNames.size, excluded: excludedMembers.length },
        "mirror: skillset has too few public members; not exporting",
      );
      return null;
    }

    const { files, marketplace } = buildSkillsetPlugin(
      {
        name: ss.name,
        description: ss.description,
        version: ss.latestVersion,
        tags: ss.tags,
        instructions: latest.instructions,
        members,
        // #1161 — dropped members surfaced in the README (public-subset note).
        excludedMembers,
        // #1157 — owner listing overrides; the builder resolves the fallbacks.
        pluginConfig: ss.pluginConfig,
      },
      pluginCfg,
    );
    const prefixed = new Map<string, string>();
    for (const [relPath, content] of files) {
      prefixed.set(`${SKILLSET_FOLDER}/${ss.name}/${relPath}`, content);
    }
    return { files: prefixed, marketplace };
  }

  /**
   * Count a skillset's PUBLIC, resolvable members of its latest version (#1161)
   * — resolved under SYSTEM, de-duped by skill name. Cheap relative to
   * {@link buildOneSkillsetSubtree}: it loads each member's version node (for
   * the `isPrivate` flag) WITHOUT fetching package files. Drives the
   * marketplace-catalogue eligibility so the shared marketplace.json never lists
   * a skillset whose subtree was dropped for having too few public members.
   */
  private async countSkillsetPublicMembers(ss: SkillsetDocument): Promise<number> {
    if (!this.deps.skillsetService) return 0;
    const latest = await this.deps.skillsetService.getLatestForMirror(ss.guid);
    if (!latest) return 0;
    const load = this.deps.skillService.createVersionLoader(SYSTEM_ACTOR);
    const publicNames = new Set<string>();
    for (const ref of latest.members) {
      const node = await load(ref);
      if (node && node.isPrivate === false && isSafeMemberName(node.name)) {
        publicNames.add(node.name);
      }
    }
    return publicNames.size;
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
 * Map a skill doc to the minimal shape the marketplace generators need
 * (#1153). Source is the sibling per-skill folder `./<name>` (#1155 made
 * `source` explicit so skillset plugins can diverge to `./skillsets/<name>`).
 */
function toMarketplaceInput(skill: SkillDocument): MarketplacePluginInput {
  return {
    name: skill.name,
    source: `./${skill.name}`,
    description: skill.description,
    version: skill.latestVersion,
    keywords: skill.metadata.tags ?? [],
  };
}

/** Mirror folder-name safety (#807) — also gates manifest membership. */
function isSafeSkillFolderName(name: string): boolean {
  return SKILL_NAME_REGEX.test(name) && name.length <= SKILL_NAME_MAX;
}

/**
 * The skill-name part of a member ref (`<name-or-guid>@<version>`), for the
 * README excluded-members note when the ref is otherwise unresolvable (#1161).
 * Falls back to the raw ref when it carries no `@`.
 */
function memberRefName(ref: string): string {
  const at = ref.lastIndexOf("@");
  return at > 0 ? ref.slice(0, at) : ref;
}

/**
 * Filter to safely-named skills and map to manifest inputs. Keeps a
 * poisoned `../escape` name out of the public marketplace.json source
 * paths, mirroring the reconcile sweep's per-folder guard.
 */
function toManifestInputs(skills: SkillDocument[]): MarketplacePluginInput[] {
  return skills.filter((s) => isSafeSkillFolderName(s.name)).map(toMarketplaceInput);
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
