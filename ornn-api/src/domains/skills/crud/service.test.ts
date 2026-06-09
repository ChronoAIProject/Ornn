/**
 * #806 — object-level authorization (BOLA / OWASP API1) for
 * `SkillService.getSkillJson`.
 *
 * The package-contents path used to download + return any skill's full
 * source (incl. embedded secrets) with no visibility check. These tests
 * lock the gate in at the service layer so every caller — playground,
 * mirror, the `/json` route — is protected by one policy:
 *
 *   - private skill + stranger actor → `skill_not_found`, NO download
 *   - SYSTEM_ACTOR / owner / platform admin → succeed
 *   - public skill → succeeds for any actor
 *
 * Run as a Bun unit test: the only repo method reached before the
 * visibility gate is `findByGuid`, so the deny cases need no storage.
 * The allow cases use an in-memory zip served via a `data:` URL so the
 * download + extraction runs hermetically (no MinIO, no network).
 */

import { afterEach, describe, expect, it } from "bun:test";
import JSZip from "jszip";
import { SkillService, resolveDistTag, isValidTagName, type SkillServiceDeps } from "./service";
import { SYSTEM_ACTOR, canReadSkill, type ActorContext } from "./authorize";
import type { SkillRepository } from "./repository";
import type { SkillVersionRepository } from "./skillVersionRepository";
import type { IStorageClient } from "../../../clients/storageClient";
import type { SkillDocument, SkillVersionDocument } from "../../../shared/types/index";
import { AppError } from "../../../shared/types/index";

const SECRET_BODY = "SECRET_FROM_PACKAGE_b91c";

/** Build a one-file zip and hand it back as a fetchable `data:` URL. */
async function zipDataUrl(): Promise<string> {
  const zip = new JSZip();
  zip.file("SKILL.md", `# demo\n${SECRET_BODY}`);
  const buf = await zip.generateAsync({ type: "uint8array" });
  return `data:application/zip;base64,${Buffer.from(buf).toString("base64")}`;
}

/** Minimal SkillDocument carrying just the fields getSkillJson reads. */
function makeSkillDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    guid: "guid-1",
    name: "demo-skill",
    description: "A demo skill.",
    metadata: {} as SkillDocument["metadata"],
    storageKey: "skills/guid-1/1.0.zip",
    latestVersion: "1.0",
    createdBy: "owner-1",
    isPrivate: true,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    ...overrides,
  } as SkillDocument;
}

function makeService(skill: SkillDocument, presignedUrl: string): SkillService {
  const skillRepo = {
    findByGuid: async (guid: string) => (guid === skill.guid ? skill : null),
    findByName: async (name: string) => (name === skill.name ? skill : null),
  } as unknown as SkillRepository;
  const skillVersionRepo = {} as unknown as SkillVersionRepository;
  const storageClient = {
    getPresignedUrl: async () => ({ presignedUrl, expiresAt: new Date().toISOString() }),
  } as unknown as IStorageClient;
  return new SkillService({
    skillRepo,
    skillVersionRepo,
    storageClient,
    storageBucketResolver: async () => "test-bucket",
  });
}

const STRANGER: ActorContext = { userId: "stranger", memberships: [], isPlatformAdmin: false, membershipsResolved: true };
const OWNER: ActorContext = { userId: "owner-1", memberships: [], isPlatformAdmin: false, membershipsResolved: true };
const ADMIN: ActorContext = { userId: "admin-1", memberships: [], isPlatformAdmin: true, membershipsResolved: true };

describe("SkillService.getSkillJson — object-level authorization (#806)", () => {
  it("private skill + stranger actor throws skill_not_found before any download", async () => {
    let downloaded = false;
    const storageClient = {
      getPresignedUrl: async () => {
        downloaded = true;
        return { presignedUrl: "http://unused", expiresAt: "" };
      },
    } as unknown as IStorageClient;
    const skill = makeSkillDoc({ isPrivate: true });
    const service = new SkillService({
      skillRepo: {
        findByGuid: async () => skill,
        findByName: async () => null,
      } as unknown as SkillRepository,
      skillVersionRepo: {} as unknown as SkillVersionRepository,
      storageClient,
      storageBucketResolver: async () => "test-bucket",
    });

    let thrown: unknown;
    try {
      await service.getSkillJson("guid-1", STRANGER);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("skill_not_found");
    // Gate runs before storage — no presigned URL was ever requested.
    expect(downloaded).toBe(false);
  });

  it("private skill succeeds for SYSTEM_ACTOR and returns package contents", async () => {
    const service = makeService(makeSkillDoc({ isPrivate: true }), await zipDataUrl());
    const result = await service.getSkillJson("guid-1", SYSTEM_ACTOR);
    expect(result.files["SKILL.md"]).toContain(SECRET_BODY);
  });

  it("private skill succeeds for the author", async () => {
    const service = makeService(makeSkillDoc({ isPrivate: true, createdBy: "owner-1" }), await zipDataUrl());
    const result = await service.getSkillJson("guid-1", OWNER);
    expect(result.files["SKILL.md"]).toContain(SECRET_BODY);
  });

  it("private skill succeeds for a platform admin", async () => {
    const service = makeService(makeSkillDoc({ isPrivate: true }), await zipDataUrl());
    const result = await service.getSkillJson("guid-1", ADMIN);
    expect(result.files["SKILL.md"]).toContain(SECRET_BODY);
  });

  it("public skill succeeds for any actor (including a stranger)", async () => {
    const service = makeService(makeSkillDoc({ isPrivate: false }), await zipDataUrl());
    const result = await service.getSkillJson("guid-1", STRANGER);
    expect(result.files["SKILL.md"]).toContain(SECRET_BODY);
  });
});

/**
 * #807 (CWE-22) — `extractSkillInfoLenient` is the `skip_validation=true`
 * import path. It used to accept ANY non-empty `name`, including
 * `../evil` / `/etc/passwd` / `..`, which then flowed into the public-
 * mirror blob paths and could escape the skill's own `<name>/` subtree.
 * The lenient path must now enforce the SAME kebab-case rule the strict
 * Zod schema enforces.
 *
 * The method is private; we reach it via a cast (the file already casts
 * deps to stubs elsewhere). It's a pure transform — no storage / repo
 * call happens before the name guard — so empty stubs are sufficient.
 */
describe("SkillService.extractSkillInfoLenient — kebab-case name guard (#807)", () => {
  function makeLenientService(): SkillService {
    return new SkillService({
      skillRepo: {} as unknown as SkillRepository,
      skillVersionRepo: {} as unknown as SkillVersionRepository,
      storageClient: {} as unknown as IStorageClient,
      storageBucketResolver: async () => "test-bucket",
    });
  }

  /** Call the private method through a typed cast. */
  function callLenient(raw: Record<string, unknown>): { name: string } {
    const svc = makeLenientService() as unknown as {
      extractSkillInfoLenient: (r: Record<string, unknown>) => { name: string };
    };
    return svc.extractSkillInfoLenient(raw);
  }

  const TRAVERSAL_NAMES = [
    "../evil",
    "/etc/passwd",
    "..",
    "a/b",
    "a\\b",
    "Foo",
    "a.b",
    "-lead",
    "a".repeat(65),
  ];

  for (const name of TRAVERSAL_NAMES) {
    it(`rejects ${JSON.stringify(name)} with frontmatter_validation_failed`, () => {
      let thrown: unknown;
      try {
        callLenient({ name });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("frontmatter_validation_failed");
      expect((thrown as AppError).statusCode).toBe(400);
    });
  }

  it("accepts a valid kebab-case name and returns it unchanged", () => {
    const result = callLenient({ name: "valid-skill-1" });
    expect(result.name).toBe("valid-skill-1");
  });
});

/**
 * #815 (CWE-862) — `setSkillPermissions` org-membership gate.
 *
 * `PUT /skills/:id/permissions` let an owner share a skill into any org id,
 * including ones they're not a member of. The service now intersects every
 * deduped `sharedWithOrgs` id against the caller's memberships and rejects
 * non-member ids with `not_org_member` (403), before the persistence write.
 * Platform admins are exempt.
 *
 * The repo `update` stub echoes the patched doc so the success path resolves
 * through `buildDetailResponse`. A capture flag on `update` proves the deny
 * case short-circuits before any write.
 */
describe("SkillService.setSkillPermissions — org-membership gate (#815)", () => {
  /**
   * Build a service whose repo `findByGuid` returns a fixed skill doc and
   * whose `update` echoes the patched fields back onto that doc while
   * recording that it was called (via the returned `state.updateCalled`).
   * `skillVersionRepo.findLatestBySkill` returns null so `buildDetailResponse`
   * stays on the no-overlay path; storage just mints a dummy presigned URL.
   */
  function makePermissionsService(skill: SkillDocument): {
    service: SkillService;
    state: { updateCalled: boolean };
  } {
    const state = { updateCalled: false };
    const skillRepo = {
      findByGuid: async (guid: string) => (guid === skill.guid ? skill : null),
      findByName: async () => null,
      update: async (_guid: string, patch: Partial<SkillDocument>) => {
        state.updateCalled = true;
        return { ...skill, ...patch } as SkillDocument;
      },
    } as unknown as SkillRepository;
    const skillVersionRepo = {
      findLatestBySkill: async () => null,
    } as unknown as SkillVersionRepository;
    const storageClient = {
      getPresignedUrl: async () => ({ presignedUrl: "http://unused", expiresAt: "" }),
    } as unknown as IStorageClient;
    const service = new SkillService({
      skillRepo,
      skillVersionRepo,
      storageClient,
      storageBucketResolver: async () => "test-bucket",
    });
    return { service, state };
  }

  it("rejects sharing into an org the caller is not a member of", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    // Caller owns the skill (passes the route gate) but is a member of no org.
    const actor: ActorContext = { userId: "owner-1", memberships: [], isPlatformAdmin: false, membershipsResolved: true };

    let thrown: unknown;
    try {
      await service.setSkillPermissions(
        "guid-1",
        "owner-1",
        { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: ["org-X"] },
        actor,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("not_org_member");
    expect((thrown as AppError).statusCode).toBe(403);
    // Rejection happens before persistence — the write was never attempted.
    expect(state.updateCalled).toBe(false);
  });

  it("allows sharing into an org the caller belongs to", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    const actor: ActorContext = {
      userId: "owner-1",
      memberships: [{ userId: "org-A", role: "member", displayName: "" }],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };

    const result = await service.setSkillPermissions(
      "guid-1",
      "owner-1",
      { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: ["org-A"] },
      actor,
    );
    expect(state.updateCalled).toBe(true);
    expect(result.sharedWithOrgs).toContain("org-A");
  });

  it("platform admin may share into any org", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    // Admin has zero memberships but the bypass lets them share into org-A.
    const actor: ActorContext = { userId: "admin-1", memberships: [], isPlatformAdmin: true, membershipsResolved: true };

    const result = await service.setSkillPermissions(
      "guid-1",
      "admin-1",
      { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: ["org-A"] },
      actor,
    );
    expect(state.updateCalled).toBe(true);
    expect(result.sharedWithOrgs).toContain("org-A");
  });

  it("a rejected share does not leak read access (AC#2)", () => {
    // The rejected org id was never persisted, so the stored ACL has an
    // empty `sharedWithOrgs`. A member of that org must still be denied
    // read — proving the failed share leaked nothing into the read gate.
    const skill = {
      createdBy: "owner-1",
      isPrivate: true,
      sharedWithUsers: [],
      sharedWithOrgs: [],
    };
    const orgMember: ActorContext = {
      userId: "u2",
      memberships: [{ userId: "org-X", role: "member", displayName: "" }],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };
    expect(canReadSkill(skill, orgMember)).toBe(false);
  });

  /**
   * #842 — unresolved org-membership read.
   *
   * The #815 gate above intersects `sharedWithOrgs` against the caller's
   * `memberships`. When the org-membership lookup is UNRESOLVED (forwarded
   * token absent or NyxID unreachable) `memberships` is empty for a
   * non-membership reason — so the #815 intersection would 403 a legitimate
   * member. `setSkillPermissions` instead fails closed with a retryable 503
   * `org_membership_unavailable`, but only when the caller actually shares
   * into an org. A public / user-only change needs no membership data and
   * succeeds even while the lookup is unresolved. A resolved-not-member share
   * still gets the #815 403, naming only the offending org id(s).
   */
  it("(a) unresolved lookup + sharing into an org → 503 org_membership_unavailable, no write", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    // Owner passes the route gate, but the org lookup never resolved — empty
    // memberships here means "couldn't ask", not "member of nothing".
    const actor: ActorContext = {
      userId: "owner-1",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: false,
    };

    let thrown: unknown;
    try {
      await service.setSkillPermissions(
        "guid-1",
        "owner-1",
        { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: ["org-X"] },
        actor,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("org_membership_unavailable");
    expect((thrown as AppError).statusCode).toBe(503);
    // Fails closed before persistence — nothing was written.
    expect(state.updateCalled).toBe(false);
  });

  it("(b) unresolved lookup + NOT sharing into any org → succeeds", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    // Lookup unresolved, but the caller only flips visibility / shares with a
    // user — no org data is needed, so the write proceeds.
    const actor: ActorContext = {
      userId: "owner-1",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: false,
    };

    const result = await service.setSkillPermissions(
      "guid-1",
      "owner-1",
      { isPrivate: false, sharedWithUsers: ["friend-1"], sharedWithOrgs: [] },
      actor,
    );
    expect(state.updateCalled).toBe(true);
    expect(result.isPrivate).toBe(false);
    expect(result.sharedWithOrgs).toEqual([]);
  });

  it("(c) resolved-not-member + sharing into an org → 403 not_org_member naming the org", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    // Lookup resolved authoritatively: caller belongs to no org. Sharing into
    // org-X is a genuine non-membership → the #815 403, not a 503.
    const actor: ActorContext = {
      userId: "owner-1",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };

    let thrown: unknown;
    try {
      await service.setSkillPermissions(
        "guid-1",
        "owner-1",
        { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: ["org-X"] },
        actor,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("not_org_member");
    expect((thrown as AppError).statusCode).toBe(403);
    expect((thrown as AppError).message).toContain("org-X");
    expect(state.updateCalled).toBe(false);
  });

  it("(d) resolved partial membership → atomic 403 naming ONLY the non-member org", async () => {
    const { service, state } = makePermissionsService(
      makeSkillDoc({ guid: "guid-1", createdBy: "owner-1", isPrivate: true }),
    );
    // Member of org-A only; tries to share into [org-A, org-B]. The whole
    // write is rejected atomically (org-A is NOT persisted) and the message
    // names only the offending org-B, not org-A.
    const actor: ActorContext = {
      userId: "owner-1",
      memberships: [{ userId: "org-A", role: "member", displayName: "" }],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };

    let thrown: unknown;
    try {
      await service.setSkillPermissions(
        "guid-1",
        "owner-1",
        { isPrivate: true, sharedWithUsers: [], sharedWithOrgs: ["org-A", "org-B"] },
        actor,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("not_org_member");
    expect((thrown as AppError).statusCode).toBe(403);
    const msg = (thrown as AppError).message;
    expect(msg).toContain("org-B");
    expect(msg).not.toContain("org-A");
    // Atomic — no partial persistence of the member org.
    expect(state.updateCalled).toBe(false);
  });
});

// ======================================================================
// #874 — broad SkillService coverage via DI fakes (no memory-server).
//
// A `makeService(overrides)` builder hands back a service whose repo /
// version-repo / storage are fully stubbable; un-stubbed methods are
// either irrelevant to the path under test or supplied per-test. All
// fakes are in-memory and hermetic.
// ======================================================================

interface FakeState {
  skills: Map<string, SkillDocument>;
  byName: Map<string, SkillDocument>;
  versions: SkillVersionDocument[];
  distTags: Map<string, Record<string, string>>;
  uploads: Array<{ key: string; bytes: number }>;
  deletes: string[];
}

function versionDoc(overrides: Partial<SkillVersionDocument> = {}): SkillVersionDocument {
  return {
    _id: "guid-1@1.0",
    skillGuid: "guid-1",
    version: "1.0",
    majorVersion: 1,
    minorVersion: 0,
    storageKey: "skills/guid-1/1.0.zip",
    skillHash: "hash-1",
    metadata: { category: "plain" },
    license: null,
    compatibility: null,
    createdBy: "owner-1",
    createdOn: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as SkillVersionDocument;
}

/** Build a valid SKILL.md ZIP as raw bytes (for createSkill / updateSkill). */
async function validSkillZip(
  opts: { name?: string; version?: string; dependsOn?: string[] } = {},
): Promise<Uint8Array> {
  const { name = "demo-skill", version = "1.0", dependsOn } = opts;
  const zip = new JSZip();
  const folder = zip.folder(name)!;
  const metaLines = ["metadata:", "  category: plain"];
  if (dependsOn && dependsOn.length > 0) {
    metaLines.push("  depends-on:");
    for (const dep of dependsOn) metaLines.push(`    - ${dep}`);
  }
  folder.file(
    "SKILL.md",
    [
      "---",
      `name: ${name}`,
      "description: A demo skill used by service tests.",
      ...metaLines,
      `version: "${version}"`,
      "---",
      `# ${name}`,
    ].join("\n"),
  );
  return zip.generateAsync({ type: "uint8array" });
}

function makeFakeDeps(seed?: Partial<FakeState>): { deps: SkillServiceDeps; state: FakeState } {
  const state: FakeState = {
    skills: seed?.skills ?? new Map(),
    byName: seed?.byName ?? new Map(),
    versions: seed?.versions ?? [],
    distTags: seed?.distTags ?? new Map(),
    uploads: [],
    deletes: [],
  };

  const skillRepo = {
    findByGuid: async (guid: string) => state.skills.get(guid) ?? null,
    findByName: async (name: string) => state.byName.get(name) ?? null,
    create: async (data: { guid: string; name: string; latestVersion: string }) => {
      const doc = makeSkillDoc({
        guid: data.guid,
        name: data.name,
        latestVersion: data.latestVersion,
        isPrivate: true,
      });
      state.skills.set(data.guid, doc);
      state.byName.set(data.name, doc);
      return doc;
    },
    update: async (guid: string, patch: Record<string, unknown>) => {
      const cur = state.skills.get(guid)!;
      const next = { ...cur, ...patch } as SkillDocument;
      state.skills.set(guid, next);
      state.byName.set(next.name, next);
      return next;
    },
    setDistTag: async (guid: string, tag: string, version: string) => {
      const tags = state.distTags.get(guid) ?? {};
      tags[tag] = version;
      state.distTags.set(guid, tags);
      // Reflect on the stored doc so getDistTags (which re-reads the skill)
      // sees the change — mirrors the real dotted-path $set.
      const cur = state.skills.get(guid);
      if (cur) state.skills.set(guid, { ...cur, distTags: { ...tags } } as SkillDocument);
    },
    deleteDistTag: async (guid: string, tag: string) => {
      const tags = state.distTags.get(guid) ?? {};
      delete tags[tag];
      state.distTags.set(guid, tags);
      const cur = state.skills.get(guid);
      if (cur) state.skills.set(guid, { ...cur, distTags: { ...tags } } as SkillDocument);
    },
    clearSource: async (guid: string) => {
      const cur = state.skills.get(guid);
      if (!cur) return null;
      const next = { ...cur, source: undefined } as SkillDocument;
      state.skills.set(guid, next);
      state.byName.set(next.name, next);
      return next;
    },
    setNyxidService: async (guid: string, data: Record<string, unknown>) => {
      const cur = state.skills.get(guid)!;
      const next = { ...cur, ...data } as SkillDocument;
      state.skills.set(guid, next);
      return next;
    },
    hardDelete: async (guid: string) => {
      const doc = state.skills.get(guid);
      if (doc) state.byName.delete(doc.name);
      state.skills.delete(guid);
    },
  } as unknown as SkillRepository;

  const skillVersionRepo = {
    create: async (data: {
      skillGuid?: string;
      version: string;
      majorVersion: number;
      minorVersion: number;
      metadata?: SkillVersionDocument["metadata"];
    }) => {
      const v = versionDoc({
        _id: `${data.skillGuid ?? "guid-1"}@${data.version}`,
        ...(data.skillGuid ? { skillGuid: data.skillGuid } : {}),
        version: data.version,
        majorVersion: data.majorVersion,
        minorVersion: data.minorVersion,
        // Capture the metadata the service passed so dependsOn round-trips
        // (#968) — the previous fake discarded it.
        ...(data.metadata ? { metadata: data.metadata } : {}),
      });
      state.versions.push(v);
      return v;
    },
    findBySkillAndVersion: async (guid: string, version: string) =>
      state.versions.find((v) => v.skillGuid === guid && v.version === version) ?? null,
    findLatestBySkill: async (guid: string) => {
      const list = state.versions
        .filter((v) => v.skillGuid === guid)
        .sort((a, b) => b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion);
      return list[0] ?? null;
    },
    listBySkill: async (guid: string) =>
      state.versions
        .filter((v) => v.skillGuid === guid)
        .sort((a, b) => b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion),
    deleteOne: async () => true,
    deleteAllBySkill: async (guid: string) => {
      const before = state.versions.length;
      state.versions = state.versions.filter((v) => v.skillGuid !== guid);
      return before - state.versions.length;
    },
    setDeprecation: async (
      guid: string,
      version: string,
      isDeprecated: boolean,
      note?: string | null,
    ) => {
      const v = state.versions.find((x) => x.skillGuid === guid && x.version === version);
      if (!v) throw AppError.notFound("skill_version_not_found", "missing");
      v.isDeprecated = isDeprecated;
      v.deprecationNote = isDeprecated ? note ?? null : null;
      return v;
    },
  } as unknown as SkillVersionRepository;

  const storageClient = {
    upload: async (_bucket: string, key: string, data: Uint8Array) => {
      state.uploads.push({ key, bytes: data.byteLength });
      return { url: `https://storage.test/${key}` };
    },
    delete: async (_bucket: string, key: string) => {
      state.deletes.push(key);
    },
    getPresignedUrl: async () => ({ presignedUrl: "http://unused", expiresAt: "" }),
  } as unknown as IStorageClient;

  return {
    deps: { skillRepo, skillVersionRepo, storageClient, storageBucketResolver: async () => "test-bucket" },
    state,
  };
}

describe("resolveDistTag / isValidTagName (#463)", () => {
  it("isValidTagName accepts npm-style tags and rejects bad shapes", () => {
    expect(isValidTagName("beta")).toBe(true);
    expect(isValidTagName("rc-1")).toBe(true);
    expect(isValidTagName("1beta")).toBe(false); // must start with a letter
    expect(isValidTagName("Beta")).toBe(false); // uppercase
    expect(isValidTagName("")).toBe(false);
  });

  it("returns undefined for empty input", () => {
    expect(resolveDistTag(makeSkillDoc(), "")).toBeUndefined();
  });

  it("returns a literal version verbatim", () => {
    expect(resolveDistTag(makeSkillDoc(), "1.2")).toBe("1.2");
  });

  it("resolves a known dist-tag", () => {
    const skill = makeSkillDoc({ distTags: { beta: "1.1" } });
    expect(resolveDistTag(skill, "@beta")).toBe("1.1");
  });

  it("falls back to latestVersion for @latest on a legacy skill", () => {
    const skill = makeSkillDoc({ latestVersion: "2.0", distTags: undefined });
    expect(resolveDistTag(skill, "@latest")).toBe("2.0");
  });

  it("throws 400 for an empty @-tag", () => {
    let thrown: unknown;
    try {
      resolveDistTag(makeSkillDoc(), "@");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("invalid_dist_tag");
  });

  it("throws 404 for an unknown tag", () => {
    let thrown: unknown;
    try {
      resolveDistTag(makeSkillDoc(), "@nope");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("skill_version_not_found");
  });
});

describe("SkillService.createSkill", () => {
  it("validates, uploads, persists, version-creates and seeds latest dist-tag", async () => {
    const { deps, state } = makeFakeDeps();
    const service = new SkillService(deps);
    const { guid } = await service.createSkill(await validSkillZip(), "owner-1");
    expect(guid).toBeTruthy();
    // Uploaded a versioned blob + created a version row + latest tag.
    expect(state.uploads).toHaveLength(1);
    expect(state.versions).toHaveLength(1);
    const created = [...state.skills.values()][0]!;
    expect(state.distTags.get(created.guid)?.latest).toBe("1.0");
  });

  it("rejects a reserved-verb name", async () => {
    const { deps } = makeFakeDeps();
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.createSkill(await validSkillZip({ name: "search" }), "owner-1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("reserved_name");
  });

  it("rejects a name conflict", async () => {
    const existing = makeSkillDoc({ guid: "other", name: "demo-skill" });
    const { deps } = makeFakeDeps({ byName: new Map([["demo-skill", existing]]) });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.createSkill(await validSkillZip(), "owner-1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("skill_name_exists");
  });
});

describe("SkillService.updateSkill", () => {
  it("JSON visibility-only update touches the doc, not storage", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", isPrivate: true });
    const { deps, state } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
    });
    const service = new SkillService(deps);
    const updated = await service.updateSkill("guid-1", "owner-1", { isPrivate: false });
    expect(updated.isPrivate).toBe(false);
    expect(state.uploads).toHaveLength(0);
  });

  it("ZIP republish uploads a new version + bumps latest", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", isPrivate: false, latestVersion: "1.0" });
    const { deps, state } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 })],
    });
    const service = new SkillService(deps);
    await service.updateSkill("guid-1", "owner-1", { zipBuffer: await validSkillZip({ version: "1.1" }) });
    expect(state.uploads).toHaveLength(1);
    expect(state.versions.map((v) => v.version)).toContain("1.1");
    expect(state.distTags.get("guid-1")?.latest).toBe("1.1");
  });

  it("rejects a non-incrementing version", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", latestVersion: "2.0" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "2.0", majorVersion: 2, minorVersion: 0 })],
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.updateSkill("guid-1", "owner-1", { zipBuffer: await validSkillZip({ version: "1.1" }) });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("VERSION_NOT_INCREMENTED");
  });

  it("404 when the skill is unknown", async () => {
    const { deps } = makeFakeDeps();
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.updateSkill("nope", "owner-1", { isPrivate: false });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("skill_not_found");
  });
});

describe("SkillService skill dependencies — persistence + publish validation (#968)", () => {
  /**
   * Seed an already-published dependency skill `pdf-tools@1.0` so the
   * closure loader can resolve refs against it. Returns the seed maps for
   * `makeFakeDeps`.
   */
  function seedDep(opts: { dependsOn?: string[]; isPrivate?: boolean } = {}) {
    const depSkill = makeSkillDoc({
      guid: "dep-guid",
      name: "pdf-tools",
      latestVersion: "1.0",
      isPrivate: opts.isPrivate ?? false,
    });
    const depVersion = versionDoc({
      _id: "dep-guid@1.0",
      skillGuid: "dep-guid",
      version: "1.0",
      majorVersion: 1,
      minorVersion: 0,
      metadata: { category: "plain", ...(opts.dependsOn ? { dependsOn: opts.dependsOn } : {}) },
    });
    return {
      skills: new Map([["dep-guid", depSkill]]),
      byName: new Map([["pdf-tools", depSkill]]),
      versions: [depVersion],
    };
  }

  it("round-trips depends-on from frontmatter into the persisted version metadata", async () => {
    const { deps, state } = makeFakeDeps(seedDep());
    const service = new SkillService(deps);
    await service.createSkill(
      await validSkillZip({ name: "report-gen", dependsOn: ["pdf-tools@1.0"] }),
      "owner-1",
    );
    const created = state.versions.find((v) => v.skillGuid !== "dep-guid");
    expect(created?.metadata.dependsOn).toEqual(["pdf-tools@1.0"]);
  });

  it("a version published without deps reads back with dependsOn absent (legacy-clean)", async () => {
    const { deps, state } = makeFakeDeps();
    const service = new SkillService(deps);
    await service.createSkill(await validSkillZip({ name: "no-deps" }), "owner-1");
    const created = state.versions[0]!;
    expect(created.metadata.dependsOn).toBeUndefined();
  });

  it("createSkill succeeds for a valid single dependency", async () => {
    const { deps } = makeFakeDeps(seedDep());
    const service = new SkillService(deps);
    const { guid } = await service.createSkill(
      await validSkillZip({ name: "report-gen", dependsOn: ["pdf-tools@1.0"] }),
      "owner-1",
    );
    expect(guid).toBeTruthy();
  });

  it("createSkill throws skill_dependency_not_found for a missing dependency", async () => {
    const { deps, state } = makeFakeDeps();
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.createSkill(
        await validSkillZip({ name: "report-gen", dependsOn: ["ghost-skill@1.0"] }),
        "owner-1",
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("skill_dependency_not_found");
    // Failed before any storage write.
    expect(state.uploads).toHaveLength(0);
  });

  it("createSkill throws dependency_cycle when a transitive dep loops back", async () => {
    // The seeded dependency `pdf-tools@1.0` itself depends on
    // `report-gen@1.0`. report-gen isn't published yet, but the closure
    // resolver walks pdf-tools' declared deps and `report-gen@1.0` can't
    // be loaded — so this actually surfaces as skill_dependency_not_found,
    // NOT a cycle, because report-gen has no published version yet.
    //
    // To exercise a real cycle we seed two mutually-dependent PUBLISHED
    // skills and resolve a NEW skill that depends on one of them.
    const aSkill = makeSkillDoc({ guid: "a-guid", name: "skill-a", latestVersion: "1.0" });
    const bSkill = makeSkillDoc({ guid: "b-guid", name: "skill-b", latestVersion: "1.0" });
    const aVersion = versionDoc({
      _id: "a-guid@1.0",
      skillGuid: "a-guid",
      version: "1.0",
      metadata: { category: "plain", dependsOn: ["skill-b@1.0"] },
    });
    const bVersion = versionDoc({
      _id: "b-guid@1.0",
      skillGuid: "b-guid",
      version: "1.0",
      metadata: { category: "plain", dependsOn: ["skill-a@1.0"] },
    });
    const { deps } = makeFakeDeps({
      skills: new Map([
        ["a-guid", aSkill],
        ["b-guid", bSkill],
      ]),
      byName: new Map([
        ["skill-a", aSkill],
        ["skill-b", bSkill],
      ]),
      versions: [aVersion, bVersion],
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.createSkill(
        await validSkillZip({ name: "consumer", dependsOn: ["skill-a@1.0"] }),
        "owner-1",
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("dependency_cycle");
    expect((thrown as AppError).statusCode).toBe(409);
  });

  it("createSkill succeeds for a valid diamond closure", async () => {
    // d (leaf) ← b, c ← consumer(root via b@1.0, c@1.0).
    const dSkill = makeSkillDoc({ guid: "d-guid", name: "leaf-d", latestVersion: "1.0" });
    const bSkill = makeSkillDoc({ guid: "b-guid", name: "mid-b", latestVersion: "1.0" });
    const cSkill = makeSkillDoc({ guid: "c-guid", name: "mid-c", latestVersion: "1.0" });
    const dVersion = versionDoc({
      _id: "d-guid@1.0",
      skillGuid: "d-guid",
      version: "1.0",
      metadata: { category: "plain" },
    });
    const bVersion = versionDoc({
      _id: "b-guid@1.0",
      skillGuid: "b-guid",
      version: "1.0",
      metadata: { category: "plain", dependsOn: ["leaf-d@1.0"] },
    });
    const cVersion = versionDoc({
      _id: "c-guid@1.0",
      skillGuid: "c-guid",
      version: "1.0",
      metadata: { category: "plain", dependsOn: ["leaf-d@1.0"] },
    });
    const { deps } = makeFakeDeps({
      skills: new Map([
        ["d-guid", dSkill],
        ["b-guid", bSkill],
        ["c-guid", cSkill],
      ]),
      byName: new Map([
        ["leaf-d", dSkill],
        ["mid-b", bSkill],
        ["mid-c", cSkill],
      ]),
      versions: [dVersion, bVersion, cVersion],
    });
    const service = new SkillService(deps);
    const { guid } = await service.createSkill(
      await validSkillZip({ name: "diamond-root", dependsOn: ["mid-b@1.0", "mid-c@1.0"] }),
      "owner-1",
    );
    expect(guid).toBeTruthy();
  });

  it("resolveSkillClosure returns the topo-ordered closure for a published skill", async () => {
    const { deps } = makeFakeDeps(seedDep());
    const service = new SkillService(deps);
    await service.createSkill(
      await validSkillZip({ name: "report-gen", dependsOn: ["pdf-tools@1.0"] }),
      "owner-1",
    );
    const closure = await service.resolveSkillClosure("report-gen", SYSTEM_ACTOR);
    expect(closure.map((n) => n.name)).toEqual(["pdf-tools"]);
    // The closure excludes the skill itself; its direct dependencies are
    // the roots of the walk → depth 0.
    expect(closure[0]!.depth).toBe(0);
    expect(closure[0]!.guid).toBe("dep-guid");
  });

  // ==========================================================================
  // Per-node visibility gate in buildVersionLoader (#806/#968).
  //
  // A PUBLIC skill may transitively depend on a PRIVATE skill. When an
  // anonymous / under-privileged caller resolves the public root's closure,
  // the private node MUST NOT leak. The loader (service.ts buildVersionLoader)
  // returns `null` for an unreadable node; the resolver (closure/resolver.ts
  // `resolve()`) turns a null load into a hard `skill_dependency_not_found`
  // (404) — existence is never disclosed. These two tests lock that branch:
  // an unauthorized caller hits the error, an authorized caller still sees
  // the node. Delete the `canReadSkill` guard and the negative test breaks
  // (the closure would resolve successfully and leak the private dep).
  // ==========================================================================

  /**
   * Seed a PUBLIC root `report-gen@1.0` that depends on a PRIVATE
   * `pdf-tools@1.0`, both already published. Returns the seed maps for
   * `makeFakeDeps` so the closure loader resolves real docs (no createSkill
   * round-trip — the root must be public, which the fake's create() isn't).
   */
  function seedPublicRootPrivateDep() {
    const rootSkill = makeSkillDoc({
      guid: "root-guid",
      name: "report-gen",
      latestVersion: "1.0",
      isPrivate: false,
      createdBy: "owner-1",
    });
    const privateDep = makeSkillDoc({
      guid: "dep-guid",
      name: "pdf-tools",
      latestVersion: "1.0",
      isPrivate: true,
      createdBy: "owner-1",
    });
    const rootVersion = versionDoc({
      _id: "root-guid@1.0",
      skillGuid: "root-guid",
      version: "1.0",
      metadata: { category: "plain", dependsOn: ["pdf-tools@1.0"] },
    });
    const depVersion = versionDoc({
      _id: "dep-guid@1.0",
      skillGuid: "dep-guid",
      version: "1.0",
      metadata: { category: "plain" },
    });
    return {
      skills: new Map([
        ["root-guid", rootSkill],
        ["dep-guid", privateDep],
      ]),
      byName: new Map([
        ["report-gen", rootSkill],
        ["pdf-tools", privateDep],
      ]),
      versions: [rootVersion, depVersion],
    };
  }

  // Anonymous caller: a logged-out request. `userId: ""` matches neither the
  // private dep's `createdBy` ("owner-1") nor its (empty) ACLs, and is not a
  // platform admin → cannot read pdf-tools.
  const ANON: ActorContext = {
    userId: "",
    memberships: [],
    isPlatformAdmin: false,
    membershipsResolved: true,
  };

  it("resolveSkillClosure hides a private transitive dep from an anonymous caller (skill_dependency_not_found)", async () => {
    const { deps } = makeFakeDeps(seedPublicRootPrivateDep());
    const service = new SkillService(deps);
    // The PUBLIC root passes resolveSkillClosure's own entry gate; the walk
    // then reaches the PRIVATE pdf-tools, whose loader returns null for an
    // unreadable node → resolver throws skill_dependency_not_found. The
    // private skill's existence is never disclosed.
    let thrown: unknown;
    try {
      await service.resolveSkillClosure("report-gen", ANON);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("skill_dependency_not_found");
    expect((thrown as AppError).statusCode).toBe(404);
  });

  it("resolveSkillClosure hides a private transitive dep from a non-owner non-admin caller", async () => {
    const { deps } = makeFakeDeps(seedPublicRootPrivateDep());
    const service = new SkillService(deps);
    // A different authenticated user who is neither the author, on the ACL,
    // nor a platform admin — same outcome as anonymous.
    const stranger: ActorContext = {
      userId: "intruder-9",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };
    let thrown: unknown;
    try {
      await service.resolveSkillClosure("report-gen", stranger);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("skill_dependency_not_found");
    expect((thrown as AppError).statusCode).toBe(404);
  });

  it("resolveSkillClosure exposes the same private transitive dep to an authorized caller", async () => {
    const { deps } = makeFakeDeps(seedPublicRootPrivateDep());
    const service = new SkillService(deps);
    // SYSTEM_ACTOR (and equivalently the owner / platform admin) CAN read the
    // private dep, so the gate hides it only from unauthorized callers — no
    // over-correction. The closure resolves and includes pdf-tools.
    const closure = await service.resolveSkillClosure("report-gen", SYSTEM_ACTOR);
    expect(closure.map((n) => n.name)).toEqual(["pdf-tools"]);
    expect(closure[0]!.guid).toBe("dep-guid");

    // The owning author sees it too (the gate keys on identity, not just the
    // SYSTEM bypass).
    const owner: ActorContext = {
      userId: "owner-1",
      memberships: [],
      isPlatformAdmin: false,
      membershipsResolved: true,
    };
    const ownerClosure = await service.resolveSkillClosure("report-gen", owner);
    expect(ownerClosure.map((n) => n.name)).toEqual(["pdf-tools"]);
  });
});

describe("SkillService.getSkill / dist-tags / versions", () => {
  function seededService() {
    const skill = makeSkillDoc({ guid: "guid-1", latestVersion: "1.0", distTags: { beta: "1.0" } });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 })],
    });
    return new SkillService(deps);
  }

  it("getSkill (latest) returns a detail response", async () => {
    const res = await seededService().getSkill("guid-1");
    expect(res.guid).toBe("guid-1");
    expect(res.version).toBe("1.0");
  });

  it("getSkill (specific version) overlays that version", async () => {
    const res = await seededService().getSkill("guid-1", "1.0");
    expect(res.version).toBe("1.0");
  });

  it("getSkill 404 for an unknown version", async () => {
    let thrown: unknown;
    try {
      await seededService().getSkill("guid-1", "9.9");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("skill_version_not_found");
  });

  it("getDistTags always synthesizes latest", async () => {
    const tags = await seededService().getDistTags("guid-1");
    expect(tags.latest).toBe("1.0");
    expect(tags.beta).toBe("1.0");
  });

  it("setDistTag rejects the immutable `latest`", async () => {
    let thrown: unknown;
    try {
      await seededService().setDistTag("guid-1", "latest", "1.0");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("dist_tag_immutable");
  });

  it("setDistTag rejects an invalid tag name", async () => {
    let thrown: unknown;
    try {
      await seededService().setDistTag("guid-1", "Bad Tag", "1.0");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("invalid_dist_tag");
  });

  it("setDistTag 404 when the target version is unknown", async () => {
    let thrown: unknown;
    try {
      await seededService().setDistTag("guid-1", "beta", "9.9");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("skill_version_not_found");
  });

  it("setDistTag persists a valid tag", async () => {
    const svc = seededService();
    const tags = await svc.setDistTag("guid-1", "stable", "1.0");
    expect(tags.stable).toBe("1.0");
  });

  it("deleteDistTag rejects the immutable `latest`", async () => {
    let thrown: unknown;
    try {
      await seededService().deleteDistTag("guid-1", "latest");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("dist_tag_immutable");
  });

  it("listSkillVersions returns the integrity-augmented list", async () => {
    const list = await seededService().listSkillVersions("guid-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.version).toBe("1.0");
    expect(list[0]!.integrity.startsWith("sha256-")).toBe(true);
  });

  it("setVersionDeprecation toggles the flag", async () => {
    const res = await seededService().setVersionDeprecation("guid-1", "1.0", true, "deprecated");
    expect(res.isDeprecated).toBe(true);
    expect(res.deprecationNote).toBe("deprecated");
  });
});

describe("SkillService.deleteVersion / deleteSkill", () => {
  it("deleteSkill cascades version rows + storage cleanup", async () => {
    const skill = makeSkillDoc({ guid: "guid-1" });
    const { deps, state } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 })],
    });
    const service = new SkillService(deps);
    await service.deleteSkill("guid-1");
    expect(state.skills.has("guid-1")).toBe(false);
    expect(state.versions).toHaveLength(0);
    expect(state.deletes.length).toBeGreaterThan(0);
  });

  it("deleteVersion refuses the only remaining version", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", latestVersion: "1.0" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 })],
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.deleteVersion("guid-1", "1.0");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("SKILL_VERSION_LAST");
  });

  it("deleteVersion refuses the current latest", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", latestVersion: "1.1" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [
        versionDoc({ version: "1.1", majorVersion: 1, minorVersion: 1 }),
        versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 }),
      ],
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.deleteVersion("guid-1", "1.1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("SKILL_VERSION_LATEST");
  });

  it("deleteVersion removes a non-latest version", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", latestVersion: "1.1" });
    const { deps, state } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [
        versionDoc({ version: "1.1", majorVersion: 1, minorVersion: 1 }),
        versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 }),
      ],
    });
    const service = new SkillService(deps);
    await service.deleteVersion("guid-1", "1.0");
    expect(state.deletes.length).toBeGreaterThan(0);
  });
});

describe("SkillService.tieToNyxidService", () => {
  function tieService() {
    const skill = makeSkillDoc({ guid: "guid-1", isPrivate: true });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc()],
    });
    return new SkillService(deps);
  }

  it("untie (serviceId=null) clears the tie", async () => {
    const res = await tieService().tieToNyxidService("guid-1", null, { userId: "owner-1", isPlatformAdmin: false }, async () => null);
    expect(res.nyxidServiceId).toBeNull();
  });

  it("404 when the service lookup returns null", async () => {
    let thrown: unknown;
    try {
      await tieService().tieToNyxidService("guid-1", "svc-1", { userId: "owner-1", isPlatformAdmin: false }, async () => null);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("NYXID_SERVICE_NOT_FOUND");
  });

  it("ties to an admin service and forces public", async () => {
    const res = await tieService().tieToNyxidService(
      "guid-1",
      "svc-1",
      { userId: "owner-1", isPlatformAdmin: false },
      async () => ({ id: "svc-1", slug: "svc-1", label: "Service 1", visibility: "public", createdBy: "x" }),
    );
    expect(res.isSystemSkill).toBe(true);
    expect(res.isPrivate).toBe(false);
  });

  it("rejects tying to another user's personal service", async () => {
    let thrown: unknown;
    try {
      await tieService().tieToNyxidService(
        "guid-1",
        "svc-1",
        { userId: "owner-1", isPlatformAdmin: false },
        async () => ({ id: "svc-1", slug: "svc-1", label: "Service 1", visibility: "private", createdBy: "other-user" }),
      );
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("NYXID_SERVICE_NOT_ELIGIBLE");
  });
});

describe("SkillService.diffVersions", () => {
  it("rejects identical from/to versions", async () => {
    const skill = makeSkillDoc({ guid: "guid-1" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.diffVersions("guid-1", "1.0", "1.0");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("same_version");
  });

  it("404 when a version is unknown", async () => {
    const skill = makeSkillDoc({ guid: "guid-1" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 })],
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.diffVersions("guid-1", "1.0", "9.9");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("skill_version_not_found");
  });
});

describe("SkillService.setSkillSource / refresh / preview (globalThis.fetch swap)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("setSkillSource(null) clears the source", async () => {
    const skill = makeSkillDoc({
      guid: "guid-1",
      source: { type: "github", repo: "o/r", ref: "main", path: "" },
    });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc()],
    });
    const service = new SkillService(deps);
    const res = await service.setSkillSource("guid-1", null, "owner-1");
    expect(res.source).toBeUndefined();
  });

  it("setSkillSource parses a GitHub URL and stores the pointer", async () => {
    const skill = makeSkillDoc({ guid: "guid-1" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc()],
    });
    const service = new SkillService(deps);
    const res = await service.setSkillSource("guid-1", "https://github.com/owner/repo", "owner-1");
    expect(res.source?.repo).toBe("owner/repo");
  });

  it("setSkillSource rejects a malformed GitHub URL", async () => {
    const skill = makeSkillDoc({ guid: "guid-1" });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.setSkillSource("guid-1", "not-a-github-url", "owner-1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("invalid_github_url");
  });

  it("refreshSkillFromSource rejects a skill with no source", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", source: undefined });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.refreshSkillFromSource("guid-1", "owner-1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("NO_SOURCE");
  });

  it("previewRefreshFromSource rejects a skill with no source", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", source: undefined });
    const { deps } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.previewRefreshFromSource("guid-1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("NO_SOURCE");
  });
});

// ======================================================================
// #632 — zip-bomb guard is enforced at the SkillService ingestion
// chokepoint (`createSkill` / `updateSkill`), NOT only at the route
// layer. The GitHub pull path (`createSkillFromGitHub` → `createSkill`)
// and refresh path (`refreshSkillFromSource` → `updateSkill`) used to
// bypass the route-layer guard entirely. These seam-lock tests prove
// the bypass is closed by hammering the service methods directly.
//
// The guard is a DoS defense, not format validation, so it MUST fire
// even when `skipValidation: true` (the "import as-is" toggle). The
// tests assert exactly that — skipValidation does NOT disarm the guard.
//
// A >1000-entry ZIP trips `too_many_files` against the baked-in default
// file-count cap (the fake deps pass no caps, so defaults apply). Tiny
// entries keep the fixture fast and deterministic — no multi-MiB
// allocation needed to exercise the seam.
// ======================================================================

/** Build a ZIP whose entry count exceeds the default 1000-file cap. */
async function buildTooManyFilesZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  const folder = zip.folder("demo-skill")!;
  folder.file("SKILL.md", "---\nname: demo-skill\n---\nbody");
  for (let i = 0; i < 1001; i++) {
    folder.file(`assets/f${i}.txt`, `c${i}`);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("SkillService zip-bomb chokepoint (#632)", () => {
  it("createSkill throws 413 too_many_files even with skipValidation=true", async () => {
    const { deps, state } = makeFakeDeps();
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.createSkill(await buildTooManyFilesZip(), "owner-1", {
        skipValidation: true,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(413);
    expect((thrown as AppError).code).toBe("too_many_files");
    // Guard fires BEFORE storage upload — nothing was persisted.
    expect(state.uploads).toHaveLength(0);
    expect(state.versions).toHaveLength(0);
  });

  it("updateSkill (refresh seam) throws 413 too_many_files even with skipValidation=true", async () => {
    const skill = makeSkillDoc({ guid: "guid-1", isPrivate: false, latestVersion: "1.0" });
    const { deps, state } = makeFakeDeps({
      skills: new Map([["guid-1", skill]]),
      byName: new Map([["demo-skill", skill]]),
      versions: [versionDoc({ version: "1.0", majorVersion: 1, minorVersion: 0 })],
    });
    const service = new SkillService(deps);
    let thrown: unknown;
    try {
      await service.updateSkill("guid-1", "owner-1", {
        zipBuffer: await buildTooManyFilesZip(),
        skipValidation: true,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(413);
    expect((thrown as AppError).code).toBe("too_many_files");
    // No new version blob uploaded — the guard short-circuited the seam.
    expect(state.uploads).toHaveLength(0);
  });

  it("env-driven caps override the defaults at the chokepoint", async () => {
    // Wire a tight 5-file cap through the deps (mirrors what bootstrap
    // threads from config). A 6-entry ZIP that would pass the default
    // 1000-file cap now trips — proving the deps are honored.
    const { deps } = makeFakeDeps();
    const service = new SkillService({ ...deps, maxPackageFileCount: 5 });
    const zip = new JSZip();
    const folder = zip.folder("demo-skill")!;
    folder.file("SKILL.md", "---\nname: demo-skill\n---\nbody");
    for (let i = 0; i < 6; i++) folder.file(`assets/f${i}.txt`, `c${i}`);
    let thrown: unknown;
    try {
      await service.createSkill(await zip.generateAsync({ type: "uint8array" }), "owner-1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AppError).code).toBe("too_many_files");
    expect((thrown as AppError).message).toContain("limit is 5");
  });
});

describe("SkillService.validateZipFormat", () => {
  it("flags a non-ZIP buffer", async () => {
    const { deps } = makeFakeDeps();
    const service = new SkillService(deps);
    const violations = await service.validateZipFormat(new Uint8Array([1, 2, 3, 4]));
    expect(violations.some((v) => v.rule === "valid-zip")).toBe(true);
  });

  it("passes a well-formed package with zero violations", async () => {
    const { deps } = makeFakeDeps();
    const service = new SkillService(deps);
    const violations = await service.validateZipFormat(await validSkillZip());
    expect(violations).toEqual([]);
  });

  it("flags a missing SKILL.md", async () => {
    const zip = new JSZip();
    zip.folder("demo-skill")!.file("notes.txt", "hi");
    const buf = await zip.generateAsync({ type: "uint8array" });
    const { deps } = makeFakeDeps();
    const service = new SkillService(deps);
    const violations = await service.validateZipFormat(buf);
    expect(violations.some((v) => v.rule === "skill-md-exists" || v.rule === "allowed-root-items")).toBe(true);
  });
});
