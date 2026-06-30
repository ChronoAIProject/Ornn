/**
 * SkillsetService unit tests (#969).
 *
 * Hermetic, in-memory fakes for the skillset repos + a REAL `SkillService`
 * wired over in-memory skill fakes so `createVersionLoader` resolves member
 * refs exactly as production does. Pins:
 *   - create → publish → re-publish bumps version; prior version immutable
 *   - visibility is derived from members (#1136) — no owner-set permissions
 *   - publish member validation: missing member → skill_dependency_not_found
 *   - conflicting member dep-closures → dependency_conflict
 *   - resolveClosure: members + their #968 dep closures topo-sorted
 *   - anon on public skillset w/ private member dep → skill_dependency_not_found
 *
 * @module domains/skillsets/service.test
 */

import { describe, expect, it } from "bun:test";
import { AppError } from "../../shared/types/index";
import type { IStorageClient } from "../../clients/storageClient";
import { SkillService } from "../skills/crud/service";
import type { SkillRepository } from "../skills/crud/repository";
import type { SkillVersionRepository } from "../skills/crud/skillVersionRepository";
import { SYSTEM_ACTOR, type ActorContext } from "../skills/crud/authorize";
import type {
  SkillDocument,
  SkillVersionDocument,
} from "../../shared/types/index";
import { SkillsetService } from "./service";
import type { SkillsetDocument, SkillsetVersionDocument } from "./types";

const ANON: ActorContext = {
  userId: "",
  memberships: [],
  isPlatformAdmin: false,
  membershipsResolved: true,
};
const OWNER: ActorContext = {
  userId: "owner-1",
  memberships: [],
  isPlatformAdmin: false,
  membershipsResolved: true,
};

// ---- Skill graph fakes (for the injected real SkillService) ----------

function skillDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    guid: "g",
    name: "n",
    description: "d",
    license: null,
    compatibility: null,
    metadata: { category: "plain" },
    skillHash: "h",
    storageKey: "k",
    createdBy: "owner-1",
    createdOn: now,
    updatedBy: "owner-1",
    updatedOn: now,
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  } as SkillDocument;
}

function skillVersion(overrides: Partial<SkillVersionDocument> = {}): SkillVersionDocument {
  return {
    _id: "g@1.0",
    skillGuid: "g",
    version: "1.0",
    majorVersion: 1,
    minorVersion: 0,
    storageKey: "k",
    skillHash: "h",
    metadata: { category: "plain" },
    license: null,
    compatibility: null,
    createdBy: "owner-1",
    createdOn: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as SkillVersionDocument;
}

/** Build a SkillService over fixed in-memory skill + version maps. */
function makeSkillService(
  skills: SkillDocument[],
  versions: SkillVersionDocument[],
): SkillService {
  const byGuid = new Map(skills.map((s) => [s.guid, s]));
  const byName = new Map(skills.map((s) => [s.name, s]));
  const skillRepo = {
    findByGuid: async (g: string) => byGuid.get(g) ?? null,
    findByName: async (n: string) => byName.get(n) ?? null,
  } as unknown as SkillRepository;
  const skillVersionRepo = {
    findBySkillAndVersion: async (g: string, v: string) =>
      versions.find((x) => x.skillGuid === g && x.version === v) ?? null,
  } as unknown as SkillVersionRepository;
  return new SkillService({
    skillRepo,
    skillVersionRepo,
    storageClient: {} as unknown as IStorageClient,
    storageBucketResolver: async () => "bucket",
  });
}

// ---- Skillset repo fakes ---------------------------------------------

interface SkillsetState {
  skillsets: Map<string, SkillsetDocument>;
  byName: Map<string, SkillsetDocument>;
  versions: SkillsetVersionDocument[];
}

function makeSkillsetDeps(
  skillService: SkillService,
  resolveUser?: (
    userId: string,
  ) => Promise<{ userId: string; email: string; displayName: string } | null>,
) {
  const state: SkillsetState = {
    skillsets: new Map(),
    byName: new Map(),
    versions: [],
  };
  const skillsetRepo = {
    findByGuid: async (g: string) => state.skillsets.get(g) ?? null,
    findByName: async (n: string) => state.byName.get(n) ?? null,
    create: async (data: {
      guid: string;
      name: string;
      description: string;
      kind: SkillsetDocument["kind"];
      tags: string[];
      createdBy: string;
      isPrivate?: boolean;
      latestVersion: string;
      exportAsPlugin?: boolean;
      pluginConfig?: SkillsetDocument["pluginConfig"];
    }) => {
      const now = new Date();
      const doc: SkillsetDocument = {
        guid: data.guid,
        name: data.name,
        description: data.description,
        kind: data.kind,
        tags: data.tags,
        createdBy: data.createdBy,
        createdOn: now,
        updatedBy: data.createdBy,
        updatedOn: now,
        isPrivate: data.isPrivate ?? true,
        sharedWithUsers: [],
        sharedWithOrgs: [],
        // #1155 — persist the plugin-export opt-in (default OFF).
        exportAsPlugin: data.exportAsPlugin ?? false,
        // #1157 — optional listing overrides.
        ...(data.pluginConfig ? { pluginConfig: data.pluginConfig } : {}),
        latestVersion: data.latestVersion,
      };
      state.skillsets.set(data.guid, doc);
      state.byName.set(data.name, doc);
      return doc;
    },
    update: async (g: string, patch: Record<string, unknown>) => {
      const cur = state.skillsets.get(g)!;
      const next = { ...cur, ...patch, updatedOn: new Date() } as SkillsetDocument;
      // #1157 — mirror the repo's three-state `pluginConfig`: `null` clears.
      if (patch.pluginConfig === null) delete next.pluginConfig;
      state.skillsets.set(g, next);
      state.byName.set(next.name, next);
      return next;
    },
    setDerivedVisibility: async (
      g: string,
      derived: {
        membersAllPublic: boolean;
        memberVisibilityState: SkillsetDocument["memberVisibilityState"];
      },
    ) => {
      const cur = state.skillsets.get(g);
      if (!cur) return;
      // Mirror the real method: only the derived fields, no audit bump.
      const next = { ...cur, ...derived } as SkillsetDocument;
      state.skillsets.set(g, next);
      state.byName.set(next.name, next);
    },
    transferOwnership: async (
      g: string,
      data: {
        newOwnerId: string;
        newOwnerEmail: string | null;
        newOwnerDisplayName: string | null;
        grants: SkillsetDocument["grants"];
      },
    ) => {
      const cur = state.skillsets.get(g)!;
      const next = {
        ...cur,
        createdBy: data.newOwnerId,
        createdByEmail: data.newOwnerEmail ?? undefined,
        createdByDisplayName: data.newOwnerDisplayName ?? undefined,
        grants: data.grants,
        updatedOn: new Date(),
      } as SkillsetDocument;
      state.skillsets.set(g, next);
      state.byName.set(next.name, next);
      return next;
    },
    hardDelete: async (g: string) => {
      const doc = state.skillsets.get(g);
      if (doc) state.byName.delete(doc.name);
      state.skillsets.delete(g);
    },
  } as unknown as import("./repository").SkillsetRepository;

  const skillsetVersionRepo = {
    create: async (data: {
      skillsetGuid: string;
      version: string;
      majorVersion: number;
      minorVersion: number;
      kind: SkillsetDocument["kind"];
      description: string;
      instructions: string;
      tags: string[];
      members: string[];
      createdBy: string;
    }) => {
      const id = `${data.skillsetGuid}@${data.version}`;
      if (state.versions.some((v) => v._id === id)) {
        throw AppError.conflict("skillset_version_exists", `dup ${id}`);
      }
      const doc: SkillsetVersionDocument = {
        _id: id,
        skillsetGuid: data.skillsetGuid,
        version: data.version,
        majorVersion: data.majorVersion,
        minorVersion: data.minorVersion,
        kind: data.kind,
        description: data.description,
        instructions: data.instructions,
        tags: data.tags,
        members: data.members,
        createdBy: data.createdBy,
        createdOn: new Date(),
      };
      state.versions.push(doc);
      return doc;
    },
    findBySkillsetAndVersion: async (g: string, v: string) =>
      state.versions.find((x) => x.skillsetGuid === g && x.version === v) ?? null,
    findSkillsetGuidsByMember: async (skillName: string, skillGuid: string) => {
      const guids = new Set<string>();
      for (const v of state.versions) {
        if (v.members.some((m) => m.startsWith(`${skillName}@`) || m.startsWith(`${skillGuid}@`))) {
          guids.add(v.skillsetGuid);
        }
      }
      return [...guids];
    },
    findLatestBySkillset: async (g: string) =>
      state.versions
        .filter((x) => x.skillsetGuid === g)
        .sort((a, b) => b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion)[0] ??
      null,
    listBySkillset: async (g: string) =>
      state.versions
        .filter((x) => x.skillsetGuid === g)
        .sort((a, b) => b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion),
    deleteAllBySkillset: async (g: string) => {
      const before = state.versions.length;
      state.versions = state.versions.filter((x) => x.skillsetGuid !== g);
      return before - state.versions.length;
    },
  } as unknown as import("./skillsetVersionRepository").SkillsetVersionRepository;

  return {
    deps: { skillsetRepo, skillsetVersionRepo, skillService, ...(resolveUser ? { resolveUser } : {}) },
    state,
  };
}

/** Two public member skills, no deps. */
function twoMemberSkills(): { skills: SkillDocument[]; versions: SkillVersionDocument[] } {
  const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0" });
  const b = skillDoc({ guid: "g-b", name: "csv-tools", latestVersion: "1.0" });
  return {
    skills: [a, b],
    versions: [
      skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
      skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
    ],
  };
}

describe("SkillsetService — getSkillsetForRead (member-derived read gate, #1136)", () => {
  const STRANGER: ActorContext = {
    userId: "stranger",
    memberships: [],
    isPlatformAdmin: false,
    membershipsResolved: true,
  };

  /** pdf-tools (public) + secret-tools (private, owned by other-user). */
  function mixedMembers(): { skills: SkillDocument[]; versions: SkillVersionDocument[] } {
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const b = skillDoc({
      guid: "g-b",
      name: "secret-tools",
      latestVersion: "1.0",
      isPrivate: true,
      createdBy: "other-user",
    });
    return {
      skills: [a, b],
      versions: [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
      ],
    };
  }

  async function seedMixedSkillset() {
    const { skills, versions } = mixedMembers();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    const created = await service.createSkillset(
      {
        name: "mixed-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "secret-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    return { service, guid: created.guid };
  }

  it("owner sees the detail WITH unreadableMembers listed (for repair)", async () => {
    // owner-1 owns the skillset but NOT the private member secret-tools, so
    // the owner can no longer read it — surfaced so they can repair access.
    const { service } = await seedMixedSkillset();
    const detail = await service.getSkillsetForRead("mixed-set", OWNER);
    expect(detail.unreadableMembers).toEqual(["secret-tools@1.0"]);
    expect(detail.members).toEqual(["pdf-tools@1.0", "secret-tools@1.0"]);
  });

  it("non-owner who can't read every member gets a flat 404 (no leak)", async () => {
    const { service } = await seedMixedSkillset();
    let code = "";
    try {
      await service.getSkillsetForRead("mixed-set", STRANGER);
    } catch (err) {
      code = (err as AppError).code;
    }
    // skillset_not_found — identical to a missing skillset; never reveals
    // which member is private or that it even exists.
    expect(code).toBe("skillset_not_found");
  });

  it("anon caller reading an all-public skillset succeeds with empty unreadableMembers", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    await service.createSkillset(
      {
        name: "open-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    const detail = await service.getSkillsetForRead("open-set", ANON);
    expect(detail.unreadableMembers).toEqual([]);
    expect(detail.memberVisibilityState).toBe("all-public");
  });
});

describe("SkillsetService — recomputeForChangedSkill cascade (#1136)", () => {
  interface NotifyCall {
    ownerUserId: string;
    skillsetGuid: string;
    skillsetName: string;
    unreadableMembers: string[];
  }

  function spyNotifier() {
    const calls: NotifyCall[] = [];
    return {
      calls,
      notifySkillsetMemberUnreadable: async (params: NotifyCall) => {
        calls.push(params);
      },
    };
  }

  it("recomputes dependent skillsets + notifies the owner when a member goes private", async () => {
    // secret-tools starts PUBLIC and is owned by other-user; owner-1 bundles it.
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const secret = skillDoc({
      guid: "g-b",
      name: "secret-tools",
      latestVersion: "1.0",
      isPrivate: false,
      createdBy: "other-user",
    });
    const skillService = makeSkillService(
      [a, secret],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
      ],
    );
    const { deps, state } = makeSkillsetDeps(skillService);
    const notifier = spyNotifier();
    const service = new SkillsetService({ ...deps, notificationService: notifier });

    const created = await service.createSkillset(
      {
        name: "bundle",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "secret-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    // Initially all-public, no notification.
    expect(state.skillsets.get(created.guid)!.memberVisibilityState).toBe("all-public");

    // The skill's owner flips it private — owner-1 (skillset owner) loses access.
    secret.isPrivate = true;
    await service.recomputeForChangedSkill({ guid: "g-b", name: "secret-tools" });

    // Derived cache recomputed to restricted...
    expect(state.skillsets.get(created.guid)!.memberVisibilityState).toBe("restricted");
    // ...and the skillset owner was notified about the now-unreadable member.
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]!.ownerUserId).toBe("owner-1");
    expect(notifier.calls[0]!.skillsetGuid).toBe(created.guid);
    expect(notifier.calls[0]!.unreadableMembers).toEqual(["secret-tools@1.0"]);
  });

  it("does NOT notify when the skillset owner authors the skill (still readable)", async () => {
    // owner-1 owns BOTH the skillset and the member skill — flipping it
    // private never costs the owner access (author always reads own skill).
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const own = skillDoc({ guid: "g-b", name: "my-tools", latestVersion: "1.0", isPrivate: false, createdBy: "owner-1" });
    const skillService = makeSkillService(
      [a, own],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
      ],
    );
    const { deps, state } = makeSkillsetDeps(skillService);
    const notifier = spyNotifier();
    const service = new SkillsetService({ ...deps, notificationService: notifier });

    const created = await service.createSkillset(
      {
        name: "bundle",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "my-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    own.isPrivate = true;
    await service.recomputeForChangedSkill({ guid: "g-b", name: "my-tools" });

    // Derived state still reflects a private member (restricted)...
    expect(state.skillsets.get(created.guid)!.memberVisibilityState).toBe("restricted");
    // ...but no notification — the owner still reads their own skill.
    expect(notifier.calls).toHaveLength(0);
  });

  it("does not notify on an unrelated skill that no skillset references", async () => {
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const b = skillDoc({ guid: "g-b", name: "csv-tools", latestVersion: "1.0", isPrivate: false });
    const skillService = makeSkillService(
      [a, b],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
      ],
    );
    const { deps } = makeSkillsetDeps(skillService);
    const notifier = spyNotifier();
    const service = new SkillsetService({ ...deps, notificationService: notifier });
    await service.createSkillset(
      {
        name: "bundle",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    // A skill that no skillset references — no recompute, no notification.
    await service.recomputeForChangedSkill({ guid: "g-z", name: "orphan-tools" });
    expect(notifier.calls).toHaveLength(0);
  });
});

describe("SkillsetService — derived visibility on create/publish (#1136)", () => {
  it("create with all-public members → all-public", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);

    const created = await service.createSkillset(
      {
        name: "open-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    const doc = state.skillsets.get(created.guid)!;
    expect(doc.memberVisibilityState).toBe("all-public");
    expect(doc.membersAllPublic).toBe(true);
  });

  it("create with a private member → restricted (overrides the seeded all-public)", async () => {
    // One member skill is private — the skillset cannot advertise public reach.
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const b = skillDoc({ guid: "g-b", name: "secret-tools", latestVersion: "1.0", isPrivate: true });
    const skillService = makeSkillService(
      [a, b],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
      ],
    );
    const { deps, state } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);

    const created = await service.createSkillset(
      {
        name: "mixed-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "secret-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    const doc = state.skillsets.get(created.guid)!;
    expect(doc.memberVisibilityState).toBe("restricted");
    expect(doc.membersAllPublic).toBe(false);
  });

  it("publish rederives against the new version's members", async () => {
    // v1.0 is all-public; v1.1 swaps in a private member → restricted.
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const b = skillDoc({ guid: "g-b", name: "csv-tools", latestVersion: "1.0", isPrivate: false });
    const c = skillDoc({ guid: "g-c", name: "secret-tools", latestVersion: "1.0", isPrivate: true });
    const skillService = makeSkillService(
      [a, b, c],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
        skillVersion({ _id: "g-c@1.0", skillGuid: "g-c", version: "1.0" }),
      ],
    );
    const { deps, state } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);

    const created = await service.createSkillset(
      {
        name: "evolving-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    expect(state.skillsets.get(created.guid)!.memberVisibilityState).toBe("all-public");

    await service.publishVersion(
      created.guid,
      {
        instructions: "p",
        members: ["pdf-tools@1.0", "secret-tools@1.0"],
        version: "1.1",
      },
      OWNER,
    );
    expect(state.skillsets.get(created.guid)!.memberVisibilityState).toBe("restricted");
    expect(state.skillsets.get(created.guid)!.membersAllPublic).toBe(false);
  });
});

describe("SkillsetService — create / publish (immutable versioning)", () => {
  it("create → publish bumps version; prior version stays immutable", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);

    const created = await service.createSkillset(
      {
        name: "review-set",
        description: "v1",
        instructions: "prompt-v1: run pdf-tools then csv-tools",
        kind: "generic",
        tags: ["t"],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    expect(created.version).toBe("1.0");
    expect(created.isPrivate).toBe(true);
    expect(created.instructions).toBe("prompt-v1: run pdf-tools then csv-tools");

    const guid = created.guid;
    await service.publishVersion(
      guid,
      {
        description: "v2",
        instructions: "prompt-v2: csv-tools first this time",
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.1",
      },
      OWNER,
    );

    // Identity doc advanced to the new version.
    const latest = await service.getSkillset(guid);
    expect(latest.version).toBe("1.1");
    expect(latest.latestVersion).toBe("1.1");
    expect(latest.description).toBe("v2");
    // Master prompt comes straight from THIS publish (no carry-forward).
    expect(latest.instructions).toBe("prompt-v2: csv-tools first this time");

    // The prior 1.0 version still reads back unchanged (immutable) — its
    // own prompt is untouched by the v1.1 publish (per-version immutability).
    const v1 = await service.getSkillset(guid, "1.0");
    expect(v1.version).toBe("1.0");
    expect(v1.description).toBe("v1");
    expect(v1.instructions).toBe("prompt-v1: run pdf-tools then csv-tools");
    expect(state.versions).toHaveLength(2);
  });

  it("re-publishing the current version is rejected (non-incrementing)", async () => {
    // Republishing the SAME version is a non-incrementing publish — the
    // strict-increment guard catches it (mirrors the skill publish path,
    // where `!isGreater` rejects equal versions before the storage-level
    // duplicate `_id` check is ever reached).
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    const created = await service.createSkillset(
      {
        name: "review-set",
        description: "v1",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    let code = "";
    try {
      await service.publishVersion(
        created.guid,
        { instructions: "p", members: ["pdf-tools@1.0", "csv-tools@1.0"], version: "1.0" },
        OWNER,
      );
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("VERSION_NOT_INCREMENTED");
  });

  it("rejects a lower version without regressing latestVersion (#969)", async () => {
    // latestVersion advanced to 2.0; publishing a never-used LOWER 1.5 must
    // be rejected (VERSION_NOT_INCREMENTED) AND must not regress the pointer
    // or leak a stale version row into "latest".
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    const members = ["pdf-tools@1.0", "csv-tools@1.0"];

    const created = await service.createSkillset(
      {
        name: "review-set",
        description: "v1",
        instructions: "p",
        kind: "generic",
        tags: [],
        members,
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    const guid = created.guid;
    await service.publishVersion(guid, { instructions: "p", members, version: "1.1" }, OWNER);
    await service.publishVersion(guid, { instructions: "p", members, version: "2.0" }, OWNER);
    expect((await service.getSkillset(guid)).latestVersion).toBe("2.0");

    // (a) lower version is rejected with the version-not-incremented code.
    let code = "";
    try {
      await service.publishVersion(guid, { instructions: "p", members, version: "1.5" }, OWNER);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("VERSION_NOT_INCREMENTED");

    // (b) the pointer did NOT regress and no stale 1.5 row leaked into latest.
    expect((await service.getSkillset(guid)).latestVersion).toBe("2.0");
    expect(state.versions.some((v) => v.version === "1.5")).toBe(false);
  });

  it("create rejects a duplicate skillset name", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    const input = {
      name: "dup-set",
      description: "d",
      instructions: "p",
      kind: "generic" as const,
      tags: [],
      members: ["pdf-tools@1.0", "csv-tools@1.0"],
      version: "1.0",
    };
    await service.createSkillset(input, { userId: "owner-1" });
    let code = "";
    try {
      await service.createSkillset(input, { userId: "owner-1" });
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("skillset_name_exists");
  });
});

describe("SkillsetService — plugin-export opt-in (#1155)", () => {
  function service() {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService);
    return { svc: new SkillsetService(deps), state };
  }

  const base = {
    description: "d",
    instructions: "p",
    kind: "generic" as const,
    tags: [],
    members: ["pdf-tools@1.0", "csv-tools@1.0"],
  };

  it("create always defaults exportAsPlugin to false (no create-time opt-in, #1157)", async () => {
    const { svc } = service();
    const created = await svc.createSkillset(
      { ...base, name: "noexp-set", version: "1.0" },
      { userId: "owner-1" },
    );
    expect(created.exportAsPlugin).toBe(false);
    expect(created.pluginConfig).toBeUndefined();
  });

  it("getLatestForMirror returns the latest version's members + master prompt", async () => {
    const { svc } = service();
    const created = await svc.createSkillset(
      { ...base, instructions: "Run pdf then csv.", name: "mir-set", version: "1.0" },
      { userId: "owner-1" },
    );
    const latest = await svc.getLatestForMirror(created.guid);
    expect(latest).toEqual({
      members: ["pdf-tools@1.0", "csv-tools@1.0"],
      instructions: "Run pdf then csv.",
    });
  });

  it("getLatestForMirror returns null for an unknown skillset", async () => {
    const { svc } = service();
    expect(await svc.getLatestForMirror("nope")).toBeNull();
  });
});

describe("SkillsetService.setPluginExport (#1157)", () => {
  const STRANGER: ActorContext = {
    userId: "stranger",
    memberships: [],
    isPlatformAdmin: false,
    membershipsResolved: true,
  };

  const base = {
    description: "A research bundle",
    instructions: "p",
    kind: "generic" as const,
    tags: ["research"],
    members: ["pdf-tools@1.0", "csv-tools@1.0"],
  };

  /** All-public skillset (two public members), owned by owner-1. */
  async function seedPublic() {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService);
    const svc = new SkillsetService(deps);
    const created = await svc.createSkillset(
      { ...base, name: "pub-set", version: "1.0" },
      { userId: "owner-1" },
    );
    return { svc, state, guid: created.guid };
  }

  /** Restricted skillset (one private member owned by another user). */
  async function seedRestricted() {
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const b = skillDoc({
      guid: "g-b",
      name: "secret-tools",
      latestVersion: "1.0",
      isPrivate: true,
      createdBy: "other-user",
    });
    const skillService = makeSkillService(
      [a, b],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
      ],
    );
    const { deps } = makeSkillsetDeps(skillService);
    const svc = new SkillsetService(deps);
    const created = await svc.createSkillset(
      { ...base, name: "restr-set", version: "1.0", members: ["pdf-tools@1.0", "secret-tools@1.0"] },
      { userId: "owner-1" },
    );
    return { svc, guid: created.guid };
  }

  it("enabling persists exportAsPlugin + the listing overrides", async () => {
    const { svc, guid } = await seedPublic();
    const updated = await svc.setPluginExport(
      guid,
      {
        enabled: true,
        displayName: "Research Bundle",
        description: "A curated set",
        keywords: ["rag", "search"],
      },
      OWNER,
    );
    expect(updated.exportAsPlugin).toBe(true);
    expect(updated.pluginConfig).toEqual({
      displayName: "Research Bundle",
      description: "A curated set",
      keywords: ["rag", "search"],
    });
  });

  it("enabling with no overrides stores none (mirror falls back to skillset fields)", async () => {
    const { svc, guid } = await seedPublic();
    const updated = await svc.setPluginExport(guid, { enabled: true }, OWNER);
    expect(updated.exportAsPlugin).toBe(true);
    expect(updated.pluginConfig).toBeUndefined();
  });

  it("rejects a non-owner with forbidden", async () => {
    const { svc, guid } = await seedPublic();
    let code = "";
    try {
      await svc.setPluginExport(guid, { enabled: true }, STRANGER);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("forbidden");
  });

  it("rejects enabling when fewer than 2 public members remain (#1161)", async () => {
    // restr-set has one public (pdf-tools) + one private (secret-tools) member,
    // so only one public member remains — below the export floor.
    const { svc, guid } = await seedRestricted();
    let code = "";
    try {
      await svc.setPluginExport(guid, { enabled: true }, OWNER);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("skillset_too_few_public_members");
  });

  it("allows enabling a restricted skillset that still has ≥2 public members (#1161)", async () => {
    // Two public members + one private: the export bundles the public subset, so
    // the opt-in is allowed even though the skillset is restricted on Ornn.
    const a = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const b = skillDoc({ guid: "g-b", name: "csv-tools", latestVersion: "1.0", isPrivate: false });
    const c = skillDoc({
      guid: "g-c",
      name: "secret-tools",
      latestVersion: "1.0",
      isPrivate: true,
      createdBy: "other-user",
    });
    const skillService = makeSkillService(
      [a, b, c],
      [
        skillVersion({ _id: "g-a@1.0", skillGuid: "g-a", version: "1.0" }),
        skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
        skillVersion({ _id: "g-c@1.0", skillGuid: "g-c", version: "1.0" }),
      ],
    );
    const { deps } = makeSkillsetDeps(skillService);
    const svc = new SkillsetService(deps);
    const created = await svc.createSkillset(
      {
        ...base,
        name: "two-public-set",
        version: "1.0",
        members: ["pdf-tools@1.0", "csv-tools@1.0", "secret-tools@1.0"],
      },
      { userId: "owner-1" },
    );
    const updated = await svc.setPluginExport(created.guid, { enabled: true }, OWNER);
    expect(updated.exportAsPlugin).toBe(true);
    expect(updated.publicMemberCount).toBe(2);
  });

  it("detail surfaces the public-member count (#1161)", async () => {
    const { svc, guid } = await seedPublic();
    const detail = await svc.getSkillset(guid);
    expect(detail.publicMemberCount).toBe(2);
  });

  it("disabling clears the opt-in + any stored overrides", async () => {
    const { svc, guid } = await seedPublic();
    await svc.setPluginExport(
      guid,
      { enabled: true, displayName: "Research Bundle" },
      OWNER,
    );
    const off = await svc.setPluginExport(guid, { enabled: false }, OWNER);
    expect(off.exportAsPlugin).toBe(false);
    expect(off.pluginConfig).toBeUndefined();
  });

  it("404s for an unknown skillset", async () => {
    const { svc } = await seedPublic();
    let code = "";
    try {
      await svc.setPluginExport("nope", { enabled: true }, OWNER);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("skillset_not_found");
  });
});

describe("SkillsetService.transferOwnership (#1123)", () => {
  const ALICE = { userId: "alice", email: "alice@x.io", displayName: "Alice" };

  async function seedSkillset(
    resolveUser?: (
      userId: string,
    ) => Promise<{ userId: string; email: string; displayName: string } | null>,
  ) {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService, resolveUser);
    const service = new SkillsetService(deps);
    const created = await service.createSkillset(
      {
        name: "review-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    return { service, state, guid: created.guid };
  }

  it("reassigns the owner and keeps the prior owner as a read grantee", async () => {
    const { service, guid } = await seedSkillset(async () => ALICE);
    const updated = await service.transferOwnership(guid, "alice", OWNER);
    expect(updated.createdBy).toBe("alice");
    expect(updated.grants).toContainEqual({ type: "user", id: "owner-1", level: "read" });
  });

  it("403s a non-owner", async () => {
    const { service, guid } = await seedSkillset(async () => ALICE);
    const stranger: ActorContext = {
      userId: "stranger",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };
    let code = "";
    try {
      await service.transferOwnership(guid, "alice", stranger);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("forbidden");
  });

  it("409s a no-op transfer to the current owner", async () => {
    const { service, guid } = await seedSkillset(async () => ALICE);
    let code = "";
    try {
      await service.transferOwnership(guid, "owner-1", OWNER);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("ownership_conflict");
  });

  it("400s an unresolvable transfer target", async () => {
    const { service, guid } = await seedSkillset(async () => null);
    let code = "";
    try {
      await service.transferOwnership(guid, "ghost", OWNER);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("invalid_transfer_target");
  });
});

describe("SkillsetService — publish member validation (#969)", () => {
  it("rejects a non-existent member with skill_dependency_not_found", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps, state } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    let code = "";
    try {
      await service.createSkillset(
        {
          name: "review-set",
          description: "d",
          instructions: "p",
          kind: "generic",
          tags: [],
          members: ["pdf-tools@1.0", "ghost-tools@1.0"],
          version: "1.0",
        },
        { userId: "owner-1" },
      );
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("skill_dependency_not_found");
    // Failed before any persistence.
    expect(state.skillsets.size).toBe(0);
    expect(state.versions).toHaveLength(0);
  });

  it("rejects conflicting member dep-closures with dependency_conflict", async () => {
    // member-a depends on shared@1.0; member-b depends on shared@2.0 → the
    // union closure pins `shared` to two versions → dependency_conflict.
    const shared1 = skillDoc({ guid: "g-s", name: "shared", latestVersion: "2.0" });
    const memberA = skillDoc({ guid: "g-a", name: "member-a", latestVersion: "1.0" });
    const memberB = skillDoc({ guid: "g-b", name: "member-b", latestVersion: "1.0" });
    const skills = [shared1, memberA, memberB];
    const versions = [
      skillVersion({ _id: "g-s@1.0", skillGuid: "g-s", version: "1.0", majorVersion: 1 }),
      skillVersion({ _id: "g-s@2.0", skillGuid: "g-s", version: "2.0", majorVersion: 2 }),
      skillVersion({
        _id: "g-a@1.0",
        skillGuid: "g-a",
        version: "1.0",
        metadata: { category: "plain", dependsOn: ["shared@1.0"] },
      }),
      skillVersion({
        _id: "g-b@1.0",
        skillGuid: "g-b",
        version: "1.0",
        metadata: { category: "plain", dependsOn: ["shared@2.0"] },
      }),
    ];
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    let err: AppError | null = null;
    try {
      await service.createSkillset(
        {
          name: "conflict-set",
          description: "d",
          instructions: "p",
          kind: "consensus-supported",
          tags: [],
          members: ["member-a@1.0", "member-b@1.0"],
          version: "1.0",
        },
        { userId: "owner-1" },
      );
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.code).toBe("dependency_conflict");
    expect(err?.statusCode).toBe(409);
  });
});

describe("SkillsetService — resolveClosure (roots = members)", () => {
  it("returns members + their #968 dep closures, topo-sorted", async () => {
    // pdf-tools depends on leaf-d; csv-tools has no deps. Closure =
    // [leaf-d, pdf-tools, csv-tools] (deps before dependents).
    const leaf = skillDoc({ guid: "g-d", name: "leaf-d", latestVersion: "1.0" });
    const pdf = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0" });
    const csv = skillDoc({ guid: "g-b", name: "csv-tools", latestVersion: "1.0" });
    const skills = [leaf, pdf, csv];
    const versions = [
      skillVersion({ _id: "g-d@1.0", skillGuid: "g-d", version: "1.0" }),
      skillVersion({
        _id: "g-a@1.0",
        skillGuid: "g-a",
        version: "1.0",
        metadata: { category: "plain", dependsOn: ["leaf-d@1.0"] },
      }),
      skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
    ];
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    await service.createSkillset(
      {
        name: "review-set",
        description: "d",
        instructions: "closure-master-prompt: orchestrate the set",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    const closure = await service.resolveClosure("review-set", SYSTEM_ACTOR);
    const names = closure.items.map((n) => n.name);
    // leaf-d must precede pdf-tools (its dependent).
    expect(names).toContain("leaf-d");
    expect(names).toContain("pdf-tools");
    expect(names).toContain("csv-tools");
    expect(names.indexOf("leaf-d")).toBeLessThan(names.indexOf("pdf-tools"));
    // The master prompt (#978) rides alongside items as a root sibling,
    // sourced from the resolved version (no extra read).
    expect(closure.instructions).toBe("closure-master-prompt: orchestrate the set");
  });

  it("hides a private member dep from an anonymous caller (no leak)", async () => {
    // PUBLIC skillset → PUBLIC member pdf-tools → PRIVATE dep secret-lib.
    // An anon caller resolving the closure must get skill_dependency_not_found
    // for the private node, never a leak.
    const secret = skillDoc({ guid: "g-x", name: "secret-lib", latestVersion: "1.0", isPrivate: true });
    const pdf = skillDoc({ guid: "g-a", name: "pdf-tools", latestVersion: "1.0", isPrivate: false });
    const csv = skillDoc({ guid: "g-b", name: "csv-tools", latestVersion: "1.0", isPrivate: false });
    const skills = [secret, pdf, csv];
    const versions = [
      skillVersion({ _id: "g-x@1.0", skillGuid: "g-x", version: "1.0" }),
      skillVersion({
        _id: "g-a@1.0",
        skillGuid: "g-a",
        version: "1.0",
        metadata: { category: "plain", dependsOn: ["secret-lib@1.0"] },
      }),
      skillVersion({ _id: "g-b@1.0", skillGuid: "g-b", version: "1.0" }),
    ];
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    // Author creates it (publish validates as SYSTEM, so the private dep is fine).
    await service.createSkillset(
      {
        name: "review-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    );
    // No owner-set visibility (#1136): the skillset has no entry gate. An
    // anon caller resolving it walks each member under their own actor — the
    // transitively-private `secret-lib` dep is what blocks them.

    let code = "";
    try {
      await service.resolveClosure("review-set", ANON);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("skill_dependency_not_found");

    // SYSTEM (and the owner) CAN see it — the gate keys on identity.
    const sys = await service.resolveClosure("review-set", SYSTEM_ACTOR);
    expect(sys.items.map((n) => n.name)).toContain("secret-lib");
  });

  it("anon CAN resolve a skillset whose members are all public (#1136 — no entry gate)", async () => {
    // Pre-#1136 a skillset carried its own `isPrivate`, and an anon caller
    // was blocked by a standalone entry gate. That gate is gone: a skillset
    // is bounded only by its members, so an anon caller resolves it whenever
    // every member is public — the inert legacy `isPrivate` no longer blocks.
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    await service.createSkillset(
      {
        name: "open-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    ); // legacy isPrivate defaults true — but it is inert now

    const closure = await service.resolveClosure("open-set", ANON);
    expect(closure.items.map((n) => n.name).sort()).toEqual(["csv-tools", "pdf-tools"]);
  });
});
