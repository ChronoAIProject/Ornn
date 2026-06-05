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

import { describe, expect, it } from "bun:test";
import JSZip from "jszip";
import { SkillService } from "./service";
import { SYSTEM_ACTOR, canReadSkill, type ActorContext } from "./authorize";
import type { SkillRepository } from "./repository";
import type { SkillVersionRepository } from "./skillVersionRepository";
import type { IStorageClient } from "../../../clients/storageClient";
import type { SkillDocument } from "../../../shared/types/index";
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
