/**
 * SkillsetService unit tests (#969).
 *
 * Hermetic, in-memory fakes for the skillset repos + a REAL `SkillService`
 * wired over in-memory skill fakes so `createVersionLoader` resolves member
 * refs exactly as production does. Pins:
 *   - create → publish → re-publish bumps version; prior version immutable
 *   - visibility transitions mirror skills (setPermissions)
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

function makeSkillsetDeps(skillService: SkillService) {
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
        latestVersion: data.latestVersion,
      };
      state.skillsets.set(data.guid, doc);
      state.byName.set(data.name, doc);
      return doc;
    },
    update: async (g: string, patch: Record<string, unknown>) => {
      const cur = state.skillsets.get(g)!;
      const next = { ...cur, ...patch, updatedOn: new Date() } as SkillsetDocument;
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
    deps: { skillsetRepo, skillsetVersionRepo, skillService },
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

describe("SkillsetService — visibility transitions (mirror skills)", () => {
  it("setPermissions flips public/private + persists shared lists", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
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
    const updated = await service.setPermissions(
      created.guid,
      { isPrivate: false, sharedWithUsers: ["u2"], sharedWithOrgs: [] },
      OWNER,
    );
    expect(updated.isPrivate).toBe(false);
    expect(updated.sharedWithUsers).toEqual(["u2"]);
  });

  it("setPermissions 403s a non-owner", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
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
    const stranger: ActorContext = {
      userId: "stranger",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };
    let code = "";
    try {
      await service.setPermissions(
        created.guid,
        { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: [] },
        stranger,
      );
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("forbidden");
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
    // Make the skillset public so the anon caller passes the entry gate.
    await service.setPermissions(
      created.guid,
      { isPrivate: false, sharedWithUsers: [], sharedWithOrgs: [] },
      OWNER,
    );

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

  it("404s an anonymous caller on a PRIVATE skillset (entry gate)", async () => {
    const { skills, versions } = twoMemberSkills();
    const skillService = makeSkillService(skills, versions);
    const { deps } = makeSkillsetDeps(skillService);
    const service = new SkillsetService(deps);
    await service.createSkillset(
      {
        name: "secret-set",
        description: "d",
        instructions: "p",
        kind: "generic",
        tags: [],
        members: ["pdf-tools@1.0", "csv-tools@1.0"],
        version: "1.0",
      },
      { userId: "owner-1" },
    ); // private by default
    let code = "";
    try {
      await service.resolveClosure("secret-set", ANON);
    } catch (err) {
      code = (err as AppError).code;
    }
    expect(code).toBe("skillset_not_found");
  });
});
