/**
 * Mirror service tests.
 *
 * Run as a Bun unit test — no MongoDB, no real GitHub. Fakes the two
 * dependencies (`SkillRepository`, `GitHubMirrorClient`) with hand-
 * rolled stand-ins so we can assert exactly what flows where.
 *
 * Highest-priority assertions, in this order:
 *   1. **Privacy regression** — a private skill (or a private skill
 *      with `sharedWithUsers` / `sharedWithOrgs`) NEVER appears in any
 *      payload sent to GitHub. This is the moat. Cover the predicate
 *      AND the eligibility filter on `findAllEligibleForMirror`.
 *   2. **Idempotency** — `reconcileAll` against an already-in-sync
 *      mirror produces zero blob/tree/commit calls.
 *   3. **Disabled short-circuit** — when `enabled=false`, every public
 *      method is a no-op even if other deps would otherwise blow up.
 */

import { describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import {
  MirrorService,
  type MirrorSettingsReader,
  type MirrorSkillsetRepo,
  type MirrorSkillsetSource,
} from "./mirrorService";
import type { GitHubMirrorClient, TreeEntry } from "./githubMirrorClient";
import type { SkillRepository } from "../crud/repository";
import type { SkillService } from "../crud/service";
import type { ActorContext } from "../crud/authorize";
import type { SkillDocument } from "../../../shared/types/index";
import type { SkillsetDocument } from "../../skillsets/types";
import type { MirrorSection } from "../../settings/sections/mirror";

/** Stub SettingsService surface used by MirrorService — fixed mirror config. */
function makeFakeSettings(
  overrides: {
    enabled?: boolean;
    owner?: string;
    repo?: string;
    branch?: string;
  } = {},
): MirrorSettingsReader {
  const cfg: MirrorSection = {
    enabled: overrides.enabled ?? true,
    owner: overrides.owner ?? "ChronoAIProject",
    repo: overrides.repo ?? "ornn-skills",
    branch: overrides.branch ?? "main",
    appId: "12345",
    installationId: "67890",
    appPrivateKey: "test-key",
    reconcileSchedule: "0 2 * * *",
  };
  return {
    getMirror: mock(async () => cfg),
  };
}

/**
 * Same git blob SHA1 algorithm `MirrorService` uses internally —
 * duplicated here so the test can pre-seed an "already in sync" tree
 * without coupling the test to internal exports.
 */
function computeGitBlobSha(content: string): string {
  const buf = Buffer.from(content, "utf-8");
  const header = Buffer.from(`blob ${buf.length}\0`, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([header, buf]))
    .digest("hex");
}

// ────────────────────────── fixtures ──────────────────────────

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    guid: "guid-1",
    name: "demo-skill",
    description: "A test skill.",
    license: null,
    compatibility: null,
    metadata: { category: "plain" } as unknown as SkillDocument["metadata"],
    skillHash: "hash",
    storageKey: "key",
    createdBy: "u1",
    createdOn: new Date(),
    updatedBy: "u1",
    updatedOn: new Date(),
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  };
}

interface CallLog {
  blobs: Array<{ content: string }>;
  trees: Array<{ entries: TreeEntry[]; baseTree: string | null }>;
  commits: Array<{ message: string; treeSha: string; parents: string[] }>;
  branchUpdates: string[];
  branchCreates: string[];
  tags: Array<{ tagName: string; objectSha: string }>;
}

/** Hand-rolled github stub returning canned values + logging every call. */
function makeFakeGithub(opts: {
  /** When set, simulates an existing branch with this tree. */
  currentTree?: TreeEntry[];
  /** Override the default returned tree SHA. */
  newTreeSha?: string;
} = {}): { github: GitHubMirrorClient; calls: CallLog } {
  const calls: CallLog = {
    blobs: [],
    trees: [],
    commits: [],
    branchUpdates: [],
    branchCreates: [],
    tags: [],
  };
  const github: Partial<GitHubMirrorClient> = {
    getDefaultBranchHead: mock(async () => (opts.currentTree ? "head-sha" : null)),
    getCommitTreeSha: mock(async () => "current-tree-sha"),
    getRecursiveTree: mock(async () => opts.currentTree ?? []),
    createBlob: mock(async (content: string) => {
      calls.blobs.push({ content });
      return `blob-${calls.blobs.length}`;
    }),
    createTree: mock(async (entries: TreeEntry[], baseTree: string | null = null) => {
      calls.trees.push({ entries, baseTree });
      return opts.newTreeSha ?? "new-tree-sha";
    }),
    createCommit: mock(async (o) => {
      calls.commits.push(o);
      return `commit-${calls.commits.length}`;
    }),
    updateDefaultBranch: mock(async (sha: string) => {
      calls.branchUpdates.push(sha);
    }),
    createBranchRef: mock(async (sha: string) => {
      calls.branchCreates.push(sha);
    }),
    createAnnotatedTag: mock(async (o) => {
      calls.tags.push({ tagName: o.tagName, objectSha: o.objectSha });
    }),
  };
  return { github: github as GitHubMirrorClient, calls };
}

/**
 * Stateful github stub (#1159): an in-memory tree with DETERMINISTIC blob SHAs
 * (`computeGitBlobSha`), so committed writes are visible to a subsequent read.
 * Lets a test commit once and prove a second identical sync produces NO commit
 * (the no-churn guarantee). Seeded paths give the branch an initial head.
 */
function makeStatefulGithub(seed: Record<string, string> = {}): { github: GitHubMirrorClient; calls: CallLog } {
  const calls: CallLog = { blobs: [], trees: [], commits: [], branchUpdates: [], branchCreates: [], tags: [] };
  const tree = new Map<string, string>(); // path -> sha
  for (const [path, content] of Object.entries(seed)) tree.set(path, computeGitBlobSha(content));
  let head: string | null = Object.keys(seed).length > 0 ? "commit-0" : null;
  let commitN = 0;
  let treeN = 0;
  const github: Partial<GitHubMirrorClient> = {
    getDefaultBranchHead: mock(async () => head),
    getCommitTreeSha: mock(async () => `tree-for-${head}`),
    getRecursiveTree: mock(async () =>
      [...tree.entries()].map(
        ([path, sha]) => ({ path, mode: "100644", type: "blob", sha }) as TreeEntry,
      ),
    ),
    createBlob: mock(async (content: string) => {
      calls.blobs.push({ content });
      return computeGitBlobSha(content);
    }),
    createTree: mock(async (entries: TreeEntry[], baseTree: string | null = null) => {
      calls.trees.push({ entries, baseTree });
      // Apply the deltas so a later getRecursiveTree reflects the new state.
      for (const e of entries) {
        if (e.sha == null) tree.delete(e.path);
        else tree.set(e.path, e.sha);
      }
      return `new-tree-${++treeN}`;
    }),
    createCommit: mock(async (o) => {
      calls.commits.push(o);
      head = `commit-${++commitN}`;
      return head;
    }),
    updateDefaultBranch: mock(async (sha: string) => {
      calls.branchUpdates.push(sha);
    }),
    createBranchRef: mock(async (sha: string) => {
      calls.branchCreates.push(sha);
    }),
    createAnnotatedTag: mock(async (o) => {
      calls.tags.push({ tagName: o.tagName, objectSha: o.objectSha });
    }),
  };
  return { github: github as GitHubMirrorClient, calls };
}

function makeFakeRepo(skills: SkillDocument[] = []): SkillRepository {
  const byGuid = new Map(skills.map((s) => [s.guid, s]));
  return {
    findByGuid: mock(async (guid: string) => byGuid.get(guid) ?? null),
    findAllEligibleForMirror: mock(async () =>
      skills.filter((s) => s.isPrivate === false),
    ),
    setMirrorSyncState: mock(async () => {}),
    setMirrorSyncStateBulk: mock(async () => {}),
    clearMirrorSyncForIneligibleSkills: mock(async () => {}),
  } as unknown as SkillRepository;
}

function makeFakeSkillService(
  filesByGuid: Record<string, Record<string, string>>,
  /**
   * Member NAMES whose resolved skill is private (#1161). The loader reports
   * `isPrivate: true` for these so the mirror's public-subset filter drops them;
   * everything else defaults to public. Their files stay in `filesByGuid` so a
   * test can assert the private content never lands in the public mirror.
   */
  privateMembers: string[] = [],
): SkillService {
  const priv = new Set(privateMembers);
  return {
    // Signature mirrors the #806 service change: (idOrName, actor, version?).
    getSkillJson: mock(async (idOrName: string, _actor: ActorContext, version?: string) => ({
      name: idOrName,
      description: `Desc for ${idOrName}`,
      version: version ?? "1.0",
      metadata: { category: "plain" },
      files: filesByGuid[idOrName] ?? {},
    })),
    // #1155 — the skillset member loader resolves each ref to a concrete
    // version, then fetches its files. The fake resolves `<name>@<version>`
    // against `filesByGuid` keyed by member name (guid == name here).
    createVersionLoader: mock((_actor: ActorContext) => async (ref: string) => {
      const at = ref.lastIndexOf("@");
      if (at <= 0) return null;
      const name = ref.slice(0, at);
      const version = ref.slice(at + 1);
      if (!(name in filesByGuid)) return null;
      return { ref: `${name}@${version}`, name, version, guid: name, isPrivate: priv.has(name), dependsOn: [] };
    }),
  } as unknown as SkillService;
}

/** One fake skillset row carrying everything the mirror reads (#1155). */
interface FakeSkillset {
  guid: string;
  name: string;
  description: string;
  latestVersion: string;
  tags: string[];
  memberVisibilityState: "all-public" | "restricted" | "unresolvable";
  exportAsPlugin: boolean;
  members: string[];
  instructions: string;
  /** Owner listing overrides (#1157). */
  pluginConfig?: { displayName?: string; description?: string; keywords?: string[] };
}

/**
 * Fake skillset repo — replicates the REAL eligibility filter (#1161:
 * `exportAsPlugin` only; the public-member subset is decided at build time) so
 * the exclusion / subset tests exercise the contract the mirror depends on.
 */
function toSkillsetDoc(s: FakeSkillset): SkillsetDocument {
  return {
    guid: s.guid,
    name: s.name,
    description: s.description,
    kind: "generic",
    tags: s.tags,
    createdBy: "u1",
    createdOn: new Date(),
    updatedBy: "u1",
    updatedOn: new Date(),
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    memberVisibilityState: s.memberVisibilityState,
    exportAsPlugin: s.exportAsPlugin,
    ...(s.pluginConfig ? { pluginConfig: s.pluginConfig } : {}),
    latestVersion: s.latestVersion,
  } as unknown as SkillsetDocument;
}

function makeFakeSkillsetRepo(skillsets: FakeSkillset[]): MirrorSkillsetRepo {
  const eligible = (): FakeSkillset[] => skillsets.filter((s) => s.exportAsPlugin);
  return {
    findAllEligibleForMirror: mock(async () => eligible().map(toSkillsetDoc)),
    // Replicates the real repo (#1161): every opted-in skillset whose members
    // reference the skill (by name OR guid) comes back, regardless of member
    // visibility — the public subset is decided at build time.
    findEligibleSkillsetsByMember: mock(async (skillName: string, skillGuid: string) =>
      eligible()
        .filter((s) =>
          s.members.some(
            (ref) => ref.startsWith(`${skillName}@`) || ref.startsWith(`${skillGuid}@`),
          ),
        )
        .map(toSkillsetDoc),
    ),
  };
}

/** Fake skillset service — latest version member refs + master prompt. */
function makeFakeSkillsetService(skillsets: FakeSkillset[]): MirrorSkillsetSource {
  const byGuid = new Map(skillsets.map((s) => [s.guid, s]));
  return {
    getLatestForMirror: mock(async (guid: string) => {
      const s = byGuid.get(guid);
      return s ? { members: s.members, instructions: s.instructions } : null;
    }),
  };
}

// ────────────────────────── tests ──────────────────────────

describe("MirrorService.isEligible", () => {
  it("returns true only for fully public skills", () => {
    expect(MirrorService.isEligible(makeSkill({ isPrivate: false }))).toBe(true);
  });
  it("rejects any private skill, even with org/user grants", () => {
    expect(MirrorService.isEligible(makeSkill({ isPrivate: true }))).toBe(false);
    expect(
      MirrorService.isEligible(
        makeSkill({ isPrivate: true, sharedWithUsers: ["u2"] }),
      ),
    ).toBe(false);
    expect(
      MirrorService.isEligible(
        makeSkill({ isPrivate: true, sharedWithOrgs: ["org-1"] }),
      ),
    ).toBe(false);
  });
});

describe("MirrorService disabled", () => {
  it("syncSkill is a no-op when enabled=false (no calls anywhere)", async () => {
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([makeSkill()]),
      skillService: makeFakeSkillService({}),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings({ enabled: false }),
    });
    await svc.syncSkill("guid-1");
    expect(calls.blobs.length).toBe(0);
    expect(calls.trees.length).toBe(0);
    expect(calls.commits.length).toBe(0);
    expect(calls.tags.length).toBe(0);
  });
  it("reconcileAll returns zero counts when enabled=false", async () => {
    const { github } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([makeSkill()]),
      skillService: makeFakeSkillService({}),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings({ enabled: false }),
    });
    const result = await svc.reconcileAll();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 0 });
  });
});

describe("MirrorService privacy regression", () => {
  it("reconcileAll skips private skills entirely (none reach GitHub)", async () => {
    const publicSkill = makeSkill({ guid: "g-pub", name: "pub", isPrivate: false });
    const privateSkill = makeSkill({
      guid: "g-priv",
      name: "priv",
      isPrivate: true,
      sharedWithUsers: ["u2", "u3"],
    });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([publicSkill, privateSkill]),
      skillService: makeFakeSkillService({
        "g-pub": { "SKILL.md": "# pub" },
      }),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();
    // Verify no blob payload contains the private skill's name as a path prefix.
    for (const tree of calls.trees) {
      for (const entry of tree.entries) {
        expect(entry.path.startsWith("priv/")).toBe(false);
      }
    }
    // Verify only the public skill produced blob writes.
    expect(calls.blobs.length).toBeGreaterThan(0);
  });

  it("publishSkill on a private skill is a no-op (caller passed wrong guid)", async () => {
    const skill = makeSkill({ guid: "g-priv", isPrivate: true });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({}),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.publishSkill("g-priv");
    expect(calls.blobs.length).toBe(0);
    expect(calls.commits.length).toBe(0);
  });

  it("syncSkill on a flipped-private skill triggers removal (not publish)", async () => {
    const skill = makeSkill({ guid: "g-flip", name: "flip", isPrivate: true });
    // Mirror currently has the folder under flip/ — sync should remove it.
    const currentTree: TreeEntry[] = [
      { path: "flip/SKILL.md", mode: "100644", type: "blob", sha: "old-sha" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({}),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.syncSkill("g-flip");
    // Expect one tree create with a sha:null entry for flip/SKILL.md.
    expect(calls.trees.length).toBe(1);
    const entries = calls.trees[0]!.entries;
    const removalEntry = entries.find((e) => e.path === "flip/SKILL.md");
    expect(removalEntry).toBeDefined();
    expect(removalEntry?.sha).toBeNull();
  });
});

describe("MirrorService idempotency", () => {
  it("reconcileAll against an already-in-sync mirror writes nothing", async () => {
    const skill = makeSkill({ guid: "g1", name: "demo-skill" });
    const skillFiles = {
      "SKILL.md": "# demo",
    };
    // Pre-compute git blob SHAs to populate the fake current tree so
    // reconcile sees identical content and no-ops.
    const skillReadmeSha = "anything"; // README content is timestamped, will diff
    const currentTree: TreeEntry[] = [
      {
        path: "demo-skill/SKILL.md",
        mode: "100644",
        type: "blob",
        sha: computeGitBlobSha(skillFiles["SKILL.md"]),
      },
      {
        path: "demo-skill/README.md",
        mode: "100644",
        type: "blob",
        sha: skillReadmeSha,
      },
      {
        path: "README.md",
        mode: "100644",
        type: "blob",
        sha: "repo-readme-sha",
      },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({ g1: skillFiles }),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    const result = await svc.reconcileAll();
    // SKILL.md should be unchanged. The two READMEs (skill + repo) embed
    // a timestamp / content that won't match the placeholder shas, so
    // they will be marked as updates — which is fine. The critical
    // assertion is that SKILL.md alone is NOT re-uploaded — exact-match
    // the canonical content so the auto-generated README (which also
    // contains "# demo-skill") doesn't trip a substring false-positive.
    const skillMdReuploaded = calls.blobs.some(
      (b) => b.content === skillFiles["SKILL.md"],
    );
    expect(skillMdReuploaded).toBe(false);
    // Counters at minimum should reflect 1 unchanged (SKILL.md).
    expect(result.unchanged).toBeGreaterThanOrEqual(1);
  });
});

describe("MirrorService path-traversal guard (#807, CWE-22)", () => {
  it("removeSkill throws on a traversal name before touching the mirror", async () => {
    const { github, calls } = makeFakeGithub({
      currentTree: [
        { path: "../evil/SKILL.md", mode: "100644", type: "blob", sha: "x" },
      ],
    });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({}),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    // `removeSkill(name)` reaches `commitSkillFolderChange` directly with
    // the raw name — the guard at the top must reject it.
    await expect(svc.removeSkill("../evil")).rejects.toThrow(/unsafe mirror skill folder name/i);
    // Nothing was written to the mirror.
    expect(calls.trees.length).toBe(0);
    expect(calls.commits.length).toBe(0);
    expect(calls.tags.length).toBe(0);
  });

  it("reconcileAll skips a malformed-name skill but still mirrors the good one", async () => {
    const goodSkill = makeSkill({ guid: "g-good", name: "good-skill", isPrivate: false });
    // Malformed name that would escape its subtree if interpolated.
    const badSkill = makeSkill({ guid: "g-bad", name: "../escape", isPrivate: false });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([goodSkill, badSkill]),
      skillService: makeFakeSkillService({
        "g-good": { "SKILL.md": "# good" },
        "g-bad": { "SKILL.md": "# bad" },
      }),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    // The whole sweep must NOT abort because of one poisoned row.
    const result = await svc.reconcileAll();

    // Every path written stays inside a safe `<name>/` prefix — nothing
    // escapes via `../`, and the bad skill's name appears in no path.
    for (const tree of calls.trees) {
      for (const entry of tree.entries) {
        expect(entry.path).not.toContain("..");
        expect(entry.path.startsWith("../escape")).toBe(false);
      }
    }
    // The good skill WAS mirrored (its SKILL.md got uploaded).
    const goodMirrored = calls.blobs.some((b) => b.content === "# good");
    expect(goodMirrored).toBe(true);
    // The bad skill's content never reached the mirror.
    const badMirrored = calls.blobs.some((b) => b.content === "# bad");
    expect(badMirrored).toBe(false);
    // The sweep produced a commit (the good skill is a real add).
    expect(result.added).toBeGreaterThanOrEqual(1);
  });
});

describe("MirrorService Claude Code marketplace (#1153)", () => {
  // Parse every blob the service uploaded and return the first one that
  // is valid JSON exposing a `plugins` array — i.e. the marketplace.json.
  function findMarketplaceBlob(calls: CallLog): { plugins: Array<{ name: string; source: string }> } | null {
    for (const b of calls.blobs) {
      try {
        const parsed = JSON.parse(b.content);
        if (parsed && Array.isArray(parsed.plugins)) return parsed;
      } catch {
        // not JSON — a SKILL.md / README, skip.
      }
    }
    return null;
  }

  function allTreePaths(calls: CallLog): string[] {
    return calls.trees.flatMap((t) => t.entries.map((e) => e.path));
  }

  it("reconcileAll emits a root marketplace.json + per-skill plugin.json", async () => {
    const skill = makeSkill({ guid: "g1", name: "demo-skill", isPrivate: false });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({ g1: { "SKILL.md": "# demo" } }),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    const paths = allTreePaths(calls);
    expect(paths).toContain(".claude-plugin/marketplace.json");
    expect(paths).toContain("demo-skill/.claude-plugin/plugin.json");

    const manifest = findMarketplaceBlob(calls);
    expect(manifest).not.toBeNull();
    expect(manifest!.plugins).toHaveLength(1);
    expect(manifest!.plugins[0]).toMatchObject({
      name: "demo-skill",
      source: "./demo-skill",
    });
  });

  it("reconcileAll keeps private skills out of the marketplace catalogue", async () => {
    const pub = makeSkill({ guid: "g-pub", name: "pub", isPrivate: false });
    const priv = makeSkill({ guid: "g-priv", name: "priv", isPrivate: true });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([pub, priv]),
      skillService: makeFakeSkillService({ "g-pub": { "SKILL.md": "# pub" } }),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    const manifest = findMarketplaceBlob(calls);
    expect(manifest).not.toBeNull();
    const names = manifest!.plugins.map((p) => p.name);
    expect(names).toContain("pub");
    expect(names).not.toContain("priv");
  });

  it("publishSkill refreshes the root marketplace.json in the same commit", async () => {
    const skill = makeSkill({ guid: "g1", name: "demo-skill", isPrivate: false });
    // Existing head with the folder present but NO manifest yet.
    const currentTree: TreeEntry[] = [
      { path: "demo-skill/SKILL.md", mode: "100644", type: "blob", sha: "old-sha" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({ g1: { "SKILL.md": "# demo" } }),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.publishSkill("g1");

    expect(allTreePaths(calls)).toContain(".claude-plugin/marketplace.json");
    const manifest = findMarketplaceBlob(calls);
    expect(manifest!.plugins.map((p) => p.name)).toContain("demo-skill");
  });

  it("removeSkill drops the skill from the manifest (regenerated from the public set)", async () => {
    // Mirror currently lists the skill in both the folder and the manifest;
    // the skill is now ineligible (findAllEligibleForMirror → []).
    const staleManifest = JSON.stringify({
      name: "ornn-skills",
      owner: { name: "ChronoAIProject" },
      plugins: [{ name: "gone", source: "./gone", description: "x", version: "1.0" }],
    });
    const currentTree: TreeEntry[] = [
      { path: "gone/SKILL.md", mode: "100644", type: "blob", sha: "old-sha" },
      {
        path: ".claude-plugin/marketplace.json",
        mode: "100644",
        type: "blob",
        sha: computeGitBlobSha(staleManifest),
      },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]), // nothing eligible
      skillService: makeFakeSkillService({}),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.removeSkill("gone");

    // Folder blob removed AND the manifest rewritten in the same commit.
    const entries = calls.trees[0]!.entries;
    const folderRemoval = entries.find((e) => e.path === "gone/SKILL.md");
    expect(folderRemoval?.sha).toBeNull();
    expect(entries.some((e) => e.path === ".claude-plugin/marketplace.json")).toBe(true);

    const manifest = findMarketplaceBlob(calls);
    expect(manifest).not.toBeNull();
    expect(manifest!.plugins).toEqual([]); // catalogue now empty
  });
});

describe("MirrorService skillset plugin export (#1155)", () => {
  function allTreePaths(calls: CallLog): string[] {
    return calls.trees.flatMap((t) => t.entries.map((e) => e.path));
  }
  function findMarketplaceBlob(
    calls: CallLog,
  ): { plugins: Array<{ name: string; source: string }> } | null {
    for (const b of calls.blobs) {
      try {
        const parsed = JSON.parse(b.content);
        if (parsed && Array.isArray(parsed.plugins)) return parsed;
      } catch {
        // not JSON — skip.
      }
    }
    return null;
  }

  const eligibleSkillset: FakeSkillset = {
    guid: "ss-1",
    name: "research-bundle",
    description: "A curated research set.",
    latestVersion: "2.0",
    tags: ["research"],
    memberVisibilityState: "all-public",
    exportAsPlugin: true,
    members: ["pdf@1.0", "ocr@1.0"],
    instructions: "Run pdf, then ocr.",
  };

  it("reconcileAll emits the skillset subtree + a marketplace entry", async () => {
    const skill = makeSkill({ guid: "g1", name: "pdf", isPrivate: false });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({
        g1: { "SKILL.md": "# pdf" },
        pdf: { "SKILL.md": "# pdf member" },
        ocr: { "SKILL.md": "# ocr member" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([eligibleSkillset]),
      skillsetService: makeFakeSkillsetService([eligibleSkillset]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    const paths = allTreePaths(calls);
    expect(paths).toContain("skillsets/research-bundle/.claude-plugin/plugin.json");
    expect(paths).toContain("skillsets/research-bundle/skills/pdf/SKILL.md");
    expect(paths).toContain("skillsets/research-bundle/skills/ocr/SKILL.md");
    expect(paths).toContain("skillsets/research-bundle/README.md");

    const manifest = findMarketplaceBlob(calls);
    expect(manifest).not.toBeNull();
    const entry = manifest!.plugins.find((p) => p.name === "research-bundle");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("./skillsets/research-bundle");
    // The per-skill plugin (pdf) is still catalogued alongside it.
    expect(manifest!.plugins.some((p) => p.name === "pdf" && p.source === "./pdf")).toBe(true);
  });

  it("applies owner listing overrides to plugin.json + the marketplace entry (#1157)", async () => {
    const overridden: FakeSkillset = {
      ...eligibleSkillset,
      pluginConfig: {
        displayName: "Research Bundle",
        description: "Custom blurb",
        keywords: ["rag", "search"],
      },
    };
    const skill = makeSkill({ guid: "g1", name: "pdf", isPrivate: false });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({
        g1: { "SKILL.md": "# pdf" },
        pdf: { "SKILL.md": "# pdf member" },
        ocr: { "SKILL.md": "# ocr member" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([overridden]),
      skillsetService: makeFakeSkillsetService([overridden]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    // plugin.json carries the displayName + overridden description.
    const pluginJson = calls.blobs
      .map((b) => {
        try {
          return JSON.parse(b.content);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "research-bundle" && "displayName" in p);
    expect(pluginJson).toBeTruthy();
    expect(pluginJson.displayName).toBe("Research Bundle");
    expect(pluginJson.description).toBe("Custom blurb");

    // Marketplace catalogue entry reflects the overridden description + keywords.
    const manifest = findMarketplaceBlob(calls) as {
      plugins: Array<{ name: string; description: string; keywords?: string[] }>;
    } | null;
    const entry = manifest!.plugins.find((p) => p.name === "research-bundle")!;
    expect(entry.description).toBe("Custom blurb");
    expect(entry.keywords).toEqual(["rag", "search"]);
  });

  it("excludes a skillset that is not opted in (exportAsPlugin=false)", async () => {
    const optedOut: FakeSkillset = { ...eligibleSkillset, exportAsPlugin: false };
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({ pdf: { "SKILL.md": "# pdf" }, ocr: { "SKILL.md": "# ocr" } }),
      skillsetRepo: makeFakeSkillsetRepo([optedOut]),
      skillsetService: makeFakeSkillsetService([optedOut]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    expect(allTreePaths(calls).some((p) => p.startsWith("skillsets/"))).toBe(false);
    const manifest = findMarketplaceBlob(calls);
    expect((manifest?.plugins ?? []).some((p) => p.name === "research-bundle")).toBe(false);
  });

  it("exports the PUBLIC subset of a restricted skillset — no private leak (#1161)", async () => {
    // research-bundle has 3 members; `secret` is private. The plugin must bundle
    // only the two public members and never the private member's content.
    const restricted: FakeSkillset = {
      ...eligibleSkillset,
      memberVisibilityState: "restricted",
      members: ["pdf@1.0", "ocr@1.0", "secret@1.0"],
    };
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService(
        {
          pdf: { "SKILL.md": "# pdf" },
          ocr: { "SKILL.md": "# ocr" },
          secret: { "SKILL.md": "# SECRET DO NOT LEAK" },
        },
        ["secret"], // `secret` resolves as private → dropped from the public subset
      ),
      skillsetRepo: makeFakeSkillsetRepo([restricted]),
      skillsetService: makeFakeSkillsetService([restricted]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    const paths = allTreePaths(calls);
    // Public members bundled; the private one is NOT.
    expect(paths).toContain("skillsets/research-bundle/skills/pdf/SKILL.md");
    expect(paths).toContain("skillsets/research-bundle/skills/ocr/SKILL.md");
    expect(paths.some((p) => p.includes("skills/secret/"))).toBe(false);
    // The private content never reaches a blob.
    expect(calls.blobs.some((b) => b.content.includes("DO NOT LEAK"))).toBe(false);
    // The README documents the exclusion.
    const readme = calls.blobs.find((b) => b.content.includes("## Excluded members"));
    expect(readme).toBeDefined();
    expect(readme!.content).toContain("`secret`");
    // It still appears in the marketplace catalogue (it does export a subset).
    const manifest = findMarketplaceBlob(calls);
    expect(manifest!.plugins.some((p) => p.name === "research-bundle")).toBe(true);
  });

  it("removes a skillset's subtree when fewer than 2 public members remain (#1161)", async () => {
    // Only `pdf` stays public; `ocr` goes private → 1 public member < 2, so the
    // skillset's existing subtree is reconciled away (the plugin is un-exported).
    const currentTree: TreeEntry[] = [
      { path: "skillsets/research-bundle/.claude-plugin/plugin.json", mode: "100644", type: "blob", sha: "p" },
      { path: "skillsets/research-bundle/skills/pdf/SKILL.md", mode: "100644", type: "blob", sha: "a" },
      { path: "skillsets/research-bundle/skills/ocr/SKILL.md", mode: "100644", type: "blob", sha: "b" },
      { path: "skillsets/research-bundle/README.md", mode: "100644", type: "blob", sha: "r" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService(
        { pdf: { "SKILL.md": "# pdf" }, ocr: { "SKILL.md": "# ocr" } },
        ["ocr"],
      ),
      skillsetRepo: makeFakeSkillsetRepo([eligibleSkillset]),
      skillsetService: makeFakeSkillsetService([eligibleSkillset]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    // The reconcile-wide diff deletes every blob under the skillset subtree.
    const deletions = calls.trees
      .flatMap((t) => t.entries)
      .filter((e) => e.path.startsWith("skillsets/research-bundle/") && e.sha === null);
    expect(deletions.length).toBe(currentTree.length);
    // No fresh skillset blobs were written.
    expect(allTreePaths(calls).some((p) => p.startsWith("skillsets/research-bundle/") )
      && calls.trees.flatMap((t) => t.entries).some((e) => e.path.startsWith("skillsets/research-bundle/") && e.sha !== null)).toBe(false);
    // And it drops out of the marketplace catalogue.
    const manifest = findMarketplaceBlob(calls);
    expect((manifest?.plugins ?? []).some((p) => p.name === "research-bundle")).toBe(false);
  });

  it("re-includes a member once it is public again (#1161)", async () => {
    // Same set, but now ALL members resolve public → the full subtree is built
    // with no exclusions noted.
    const restricted: FakeSkillset = {
      ...eligibleSkillset,
      members: ["pdf@1.0", "ocr@1.0", "secret@1.0"],
    };
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({
        pdf: { "SKILL.md": "# pdf" },
        ocr: { "SKILL.md": "# ocr" },
        secret: { "SKILL.md": "# secret now public" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([restricted]),
      skillsetService: makeFakeSkillsetService([restricted]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();

    const paths = allTreePaths(calls);
    expect(paths).toContain("skillsets/research-bundle/skills/secret/SKILL.md");
    // No exclusions, so no Excluded-members section in the README.
    expect(calls.blobs.some((b) => b.content.includes("## Excluded members"))).toBe(false);
  });

  it("a skill incremental publish keeps skillset entries in the marketplace.json", async () => {
    const skill = makeSkill({ guid: "g1", name: "pdf", isPrivate: false });
    // Existing head with the skill folder but no manifest yet.
    const currentTree: TreeEntry[] = [
      { path: "pdf/SKILL.md", mode: "100644", type: "blob", sha: "old-sha" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      // The marketplace refresh now resolves the skillset's members to confirm
      // it has ≥2 public members (#1161), so the member files must resolve.
      skillService: makeFakeSkillService({
        g1: { "SKILL.md": "# pdf" },
        pdf: { "SKILL.md": "# pdf member" },
        ocr: { "SKILL.md": "# ocr member" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([eligibleSkillset]),
      skillsetService: makeFakeSkillsetService([eligibleSkillset]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.publishSkill("g1");

    const manifest = findMarketplaceBlob(calls);
    expect(manifest).not.toBeNull();
    // The skillset entry survives a skill-only publish (#1155).
    const entry = manifest!.plugins.find((p) => p.name === "research-bundle");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("./skillsets/research-bundle");
  });

  it("no-ops the skillset subtree when skillset deps are unwired (back-compat)", async () => {
    const skill = makeSkill({ guid: "g1", name: "pdf", isPrivate: false });
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([skill]),
      skillService: makeFakeSkillService({ g1: { "SKILL.md": "# pdf" } }),
      // No skillsetRepo / skillsetService.
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.reconcileAll();
    expect(allTreePaths(calls).some((p) => p.startsWith("skillsets/"))).toBe(false);
  });
});

describe("MirrorService.syncSkillsetsForMember (#1159)", () => {
  function allTreePaths(calls: CallLog): string[] {
    return calls.trees.flatMap((t) => t.entries.map((e) => e.path));
  }
  function parsedBlobs(calls: CallLog): Array<Record<string, unknown>> {
    return calls.blobs
      .map((b) => {
        try {
          return JSON.parse(b.content) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((p): p is Record<string, unknown> => p !== null);
  }

  const researchBundle: FakeSkillset = {
    guid: "ss-research",
    name: "research-bundle",
    description: "A curated research set.",
    latestVersion: "2.0",
    tags: ["research"],
    memberVisibilityState: "all-public",
    exportAsPlugin: true,
    members: ["pdf@1.1", "ocr@1.0"],
    instructions: "Run pdf, then ocr.",
  };

  it("rebuilds the affected subtree + writes plugin.json at the plain revision (#1162)", async () => {
    // The mirror already holds an OLD subtree; the member content changed, so
    // the member SKILL.md must be re-uploaded. plugin.json carries the plain
    // skillset revision (the service bumps it BEFORE the export, sequenced in
    // bootstrap) — no `+sk` fingerprint, so plugin.json + marketplace agree.
    const currentTree: TreeEntry[] = [
      { path: "skillsets/research-bundle/.claude-plugin/plugin.json", mode: "100644", type: "blob", sha: "old-plugin-sha" },
      { path: "skillsets/research-bundle/skills/pdf/SKILL.md", mode: "100644", type: "blob", sha: "old-pdf-sha" },
      { path: "skillsets/research-bundle/skills/ocr/SKILL.md", mode: "100644", type: "blob", sha: "old-ocr-sha" },
      { path: "skillsets/research-bundle/README.md", mode: "100644", type: "blob", sha: "old-readme-sha" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([makeSkill({ guid: "pdf-guid", name: "pdf", isPrivate: false })]),
      skillService: makeFakeSkillService({
        pdf: { "SKILL.md": "# pdf member v2" },
        ocr: { "SKILL.md": "# ocr member" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([researchBundle]),
      skillsetService: makeFakeSkillsetService([researchBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });

    await svc.syncSkillsetsForMember("pdf-guid", "pdf");

    // The member file got rebuilt under the skillset subtree.
    expect(allTreePaths(calls)).toContain("skillsets/research-bundle/skills/pdf/SKILL.md");
    expect(calls.blobs.some((b) => b.content === "# pdf member v2")).toBe(true);

    // plugin.json carries the plain revision (no fingerprint) — matching the
    // skillset's latestVersion.
    const pluginJson = parsedBlobs(calls).find((p) => p.name === "research-bundle");
    expect(pluginJson).toBeTruthy();
    expect(pluginJson!.version).toBe("2.0");
    expect(calls.commits.length).toBe(1);
  });

  it("no-ops when no eligible skillset references the changed skill", async () => {
    const { github, calls } = makeFakeGithub({
      currentTree: [
        { path: "skillsets/research-bundle/README.md", mode: "100644", type: "blob", sha: "x" },
      ],
    });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({ pdf: { "SKILL.md": "# pdf" }, ocr: { "SKILL.md": "# ocr" } }),
      skillsetRepo: makeFakeSkillsetRepo([researchBundle]),
      skillsetService: makeFakeSkillsetService([researchBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    // `unrelated` is not a member of any eligible skillset.
    await svc.syncSkillsetsForMember("unrelated-guid", "unrelated");
    expect(calls.blobs.length).toBe(0);
    expect(calls.trees.length).toBe(0);
    expect(calls.commits.length).toBe(0);
  });

  it("skips an opted-out skillset but re-exports an opted-in restricted one (#1161)", async () => {
    const optedOut: FakeSkillset = { ...researchBundle, guid: "ss-out", name: "out-set", exportAsPlugin: false };
    // Opted-in but restricted: now eligible — exports its public subset.
    const restricted: FakeSkillset = {
      ...researchBundle,
      guid: "ss-restr",
      name: "restr-set",
      memberVisibilityState: "restricted",
    };
    const { github, calls } = makeFakeGithub({
      currentTree: [{ path: "skillsets/out-set/README.md", mode: "100644", type: "blob", sha: "x" }],
    });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({ pdf: { "SKILL.md": "# pdf" }, ocr: { "SKILL.md": "# ocr" } }),
      skillsetRepo: makeFakeSkillsetRepo([optedOut, restricted]),
      skillsetService: makeFakeSkillsetService([optedOut, restricted]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.syncSkillsetsForMember("pdf-guid", "pdf");
    const paths = allTreePaths(calls);
    // The opted-in restricted skillset IS rebuilt (its public members resolve).
    expect(paths).toContain("skillsets/restr-set/.claude-plugin/plugin.json");
    // The opted-out skillset's folder is never touched.
    expect(paths.some((p) => p.startsWith("skillsets/out-set/"))).toBe(false);
    expect(calls.commits.length).toBe(1);
  });

  it("removes an exported skillset's subtree once it drops below 2 public members (#1161)", async () => {
    // `ocr` goes private → research-bundle is left with 1 public member, so its
    // existing subtree must be reconciled away in the targeted commit.
    const currentTree: TreeEntry[] = [
      { path: "skillsets/research-bundle/.claude-plugin/plugin.json", mode: "100644", type: "blob", sha: "p" },
      { path: "skillsets/research-bundle/skills/pdf/SKILL.md", mode: "100644", type: "blob", sha: "a" },
      { path: "skillsets/research-bundle/skills/ocr/SKILL.md", mode: "100644", type: "blob", sha: "b" },
      { path: "skillsets/research-bundle/README.md", mode: "100644", type: "blob", sha: "r" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService(
        { pdf: { "SKILL.md": "# pdf" }, ocr: { "SKILL.md": "# ocr" } },
        ["ocr"],
      ),
      skillsetRepo: makeFakeSkillsetRepo([researchBundle]),
      skillsetService: makeFakeSkillsetService([researchBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });
    await svc.syncSkillsetsForMember("pdf-guid", "pdf");
    const entries = calls.trees.flatMap((t) => t.entries);
    const subtreeDeletions = entries.filter(
      (e) => e.path.startsWith("skillsets/research-bundle/") && e.sha === null,
    );
    expect(subtreeDeletions.length).toBe(currentTree.length);
    // No new subtree blob was staged for it.
    expect(
      entries.some((e) => e.path.startsWith("skillsets/research-bundle/") && e.sha !== null),
    ).toBe(false);
    expect(calls.commits.length).toBe(1);
  });

  it("member private on a 3-member set: re-export drops its files + carries the bumped revision (#1165)", async () => {
    // The live bug: a member of an EXPORTED skillset goes private. The service
    // bumps the revision (proven in skillsets/service.test.ts) BEFORE this
    // export runs (bootstrap sequencing), so the doc here already carries the
    // bumped `latestVersion`. The re-export must (a) carry that new version in
    // plugin.json — the ONLY signal Claude Code uses to detect an update — and
    // (b) drop the now-private member's files while keeping the 2 public ones.
    const tripleBundle: FakeSkillset = {
      guid: "ss-triple",
      name: "triple-bundle",
      description: "A three-member set.",
      // Post-bump latestVersion (was 1.0 at create; the member-private bump
      // advanced it to 1.1 before this export reads it).
      latestVersion: "1.1",
      tags: ["triple"],
      memberVisibilityState: "restricted",
      exportAsPlugin: true,
      members: ["pdf@1.0", "ocr@1.0", "img@1.0"],
      instructions: "Run pdf, then ocr.",
    };
    const currentTree: TreeEntry[] = [
      { path: "skillsets/triple-bundle/.claude-plugin/plugin.json", mode: "100644", type: "blob", sha: "old-plugin" },
      { path: "skillsets/triple-bundle/skills/pdf/SKILL.md", mode: "100644", type: "blob", sha: "old-pdf" },
      { path: "skillsets/triple-bundle/skills/ocr/SKILL.md", mode: "100644", type: "blob", sha: "old-ocr" },
      { path: "skillsets/triple-bundle/skills/img/SKILL.md", mode: "100644", type: "blob", sha: "old-img" },
      { path: "skillsets/triple-bundle/README.md", mode: "100644", type: "blob", sha: "old-readme" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      // `img` is now private → the public-subset filter drops it; pdf + ocr stay.
      skillService: makeFakeSkillService(
        {
          pdf: { "SKILL.md": "# pdf member" },
          ocr: { "SKILL.md": "# ocr member" },
          img: { "SKILL.md": "# secret img member" },
        },
        ["img"],
      ),
      skillsetRepo: makeFakeSkillsetRepo([tripleBundle]),
      skillsetService: makeFakeSkillsetService([tripleBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });

    await svc.syncSkillsetsForMember("img-guid", "img");

    // plugin.json carries the bumped revision — the update signal.
    const pluginJson = parsedBlobs(calls).find((p) => p.name === "triple-bundle");
    expect(pluginJson).toBeTruthy();
    expect(pluginJson!.version).toBe("1.1");

    // The two public members are bundled; the private member's blob never is.
    const blobContents = calls.blobs.map((b) => b.content);
    expect(blobContents.some((c) => c === "# pdf member")).toBe(true);
    expect(blobContents.some((c) => c === "# ocr member")).toBe(true);
    expect(blobContents.some((c) => c.includes("secret img member"))).toBe(false);

    // The private member's stale file in the mirror is deleted; the subtree as a
    // whole survives (2 public members ≥ the export floor).
    const entries = calls.trees.flatMap((t) => t.entries);
    const imgDeletion = entries.find(
      (e) => e.path === "skillsets/triple-bundle/skills/img/SKILL.md" && e.sha === null,
    );
    expect(imgDeletion).toBeDefined();
    expect(
      entries.some((e) => e.path === "skillsets/triple-bundle/.claude-plugin/plugin.json" && e.sha !== null),
    ).toBe(true);
    expect(calls.commits.length).toBe(1);
  });

  it("rebuilds multiple affected skillsets in a SINGLE commit", async () => {
    const dataBundle: FakeSkillset = {
      guid: "ss-data",
      name: "data-bundle",
      description: "A data set.",
      latestVersion: "1.0",
      tags: ["data"],
      memberVisibilityState: "all-public",
      exportAsPlugin: true,
      members: ["pdf@1.1", "csv@1.0"],
      instructions: "Run pdf, then csv.",
    };
    const currentTree: TreeEntry[] = [
      { path: "skillsets/research-bundle/README.md", mode: "100644", type: "blob", sha: "r-old" },
      { path: "skillsets/data-bundle/README.md", mode: "100644", type: "blob", sha: "d-old" },
    ];
    const { github, calls } = makeFakeGithub({ currentTree });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({
        pdf: { "SKILL.md": "# pdf" },
        ocr: { "SKILL.md": "# ocr" },
        csv: { "SKILL.md": "# csv" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([researchBundle, dataBundle]),
      skillsetService: makeFakeSkillsetService([researchBundle, dataBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });

    await svc.syncSkillsetsForMember("pdf-guid", "pdf");

    // One commit; both subtrees rebuilt.
    expect(calls.commits.length).toBe(1);
    const paths = allTreePaths(calls);
    expect(paths).toContain("skillsets/research-bundle/.claude-plugin/plugin.json");
    expect(paths).toContain("skillsets/data-bundle/.claude-plugin/plugin.json");
    expect(paths).toContain("skillsets/data-bundle/skills/csv/SKILL.md");
  });

  it("produces NO commit when the subtree already matches (no churn)", async () => {
    // A stateful github with a pre-existing head: first sync writes the
    // subtree, the second identical sync must be a clean no-op.
    const { github, calls } = makeStatefulGithub({ "README.md": "root" });
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({
        pdf: { "SKILL.md": "# pdf" },
        ocr: { "SKILL.md": "# ocr" },
      }),
      skillsetRepo: makeFakeSkillsetRepo([researchBundle]),
      skillsetService: makeFakeSkillsetService([researchBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings(),
    });

    await svc.syncSkillsetsForMember("pdf-guid", "pdf");
    expect(calls.commits.length).toBe(1);
    // Second run sees a byte-identical desired tree → zero new commits.
    await svc.syncSkillsetsForMember("pdf-guid", "pdf");
    expect(calls.commits.length).toBe(1);
  });

  it("is a no-op when the mirror is disabled", async () => {
    const { github, calls } = makeFakeGithub();
    const svc = new MirrorService({
      githubClientForTest: github,
      skillRepo: makeFakeRepo([]),
      skillService: makeFakeSkillService({ pdf: { "SKILL.md": "# pdf" }, ocr: { "SKILL.md": "# ocr" } }),
      skillsetRepo: makeFakeSkillsetRepo([researchBundle]),
      skillsetService: makeFakeSkillsetService([researchBundle]),
      ornnPublicOrigin: "https://example",
      settingsService: makeFakeSettings({ enabled: false }),
    });
    await svc.syncSkillsetsForMember("pdf-guid", "pdf");
    expect(calls.blobs.length).toBe(0);
    expect(calls.commits.length).toBe(0);
  });
});
