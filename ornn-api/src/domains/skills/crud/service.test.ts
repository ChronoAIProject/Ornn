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
import { SYSTEM_ACTOR, type ActorContext } from "./authorize";
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

const STRANGER: ActorContext = { userId: "stranger", memberships: [], isPlatformAdmin: false };
const OWNER: ActorContext = { userId: "owner-1", memberships: [], isPlatformAdmin: false };
const ADMIN: ActorContext = { userId: "admin-1", memberships: [], isPlatformAdmin: true };

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
