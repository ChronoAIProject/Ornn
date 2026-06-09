/**
 * Integration: skills CRUD lifecycle spine (#874).
 *
 * Boots the real `bootstrap()` wiring against in-memory Mongo (shared
 * harness) and walks one happy lifecycle through the actual route →
 * service → repository stack: read → read-by-version → list versions →
 * dist-tags set/get/delete → delete a non-latest version → delete the
 * skill. This is a WIRING guard, not a branch matrix — the per-branch
 * behaviour is covered by the colocated unit suites.
 *
 * Zero network / zero external services: the harness points chrono-storage
 * at an empty/unreachable URL, so this test seeds the skill + version rows
 * directly via the `db` handle rather than POST-ing a real ZIP (which would
 * trigger a storage upload). The read paths mint presigned URLs
 * best-effort (failures are swallowed by the service) and the delete path's
 * storage cleanup is likewise best-effort — so the whole spine runs without
 * contacting chrono-storage. This is the documented deviation from the
 * "create via real ZIP" plan step, forced by the no-network harness rule.
 *
 * @module tests/integration/skillsCrud
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { startHarness, authHeaders, type Harness } from "./harness";

const OWNER = "user_crud_owner";
const GUID = "11111111-1111-1111-1111-111111111111";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.db.collection("skills").deleteMany({});
  await harness.db.collection("skill_versions").deleteMany({});
});

/** Seed a public skill + two version rows straight into Mongo. */
async function seedSkill(): Promise<void> {
  const now = new Date();
  await harness.db.collection("skills").insertOne({
    _id: GUID as never,
    name: "crud-spine-skill",
    description: "Integration lifecycle spine.",
    license: null,
    compatibility: null,
    metadata: { category: "plain", tags: ["spine"] },
    skillHash: "hash-11",
    storageKey: `skills/${GUID}/1.1.zip`,
    createdBy: OWNER,
    createdByEmail: `${OWNER}@test.local`,
    createdByDisplayName: "Owner",
    createdOn: now,
    updatedBy: OWNER,
    updatedOn: now,
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.1",
    distTags: { latest: "1.1" },
  } as never);

  for (const [version, major, minor] of [
    ["1.0", 1, 0],
    ["1.1", 1, 1],
  ] as const) {
    await harness.db.collection("skill_versions").insertOne({
      _id: `${GUID}@${version}` as never,
      skillGuid: GUID,
      version,
      majorVersion: major,
      minorVersion: minor,
      storageKey: `skills/${GUID}/${version}.zip`,
      skillHash: `hash-${version}`,
      metadata: { category: "plain" },
      license: null,
      compatibility: null,
      createdBy: OWNER,
      createdOn: now,
    } as never);
  }
}

describe("integration: skills CRUD lifecycle spine", () => {
  test("read → versions → dist-tags → delete-version → delete", async () => {
    await seedSkill();
    const headers = authHeaders({
      userId: OWNER,
      email: `${OWNER}@test.local`,
      permissions: ["ornn:skill:read", "ornn:skill:update", "ornn:skill:delete"],
    });

    // 1. GET the skill (latest).
    const getRes = await harness.app.request(`/api/v1/skills/${GUID}`, { headers });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { data: { guid: string; version: string } };
    expect(getBody.data.guid).toBe(GUID);
    expect(getBody.data.version).toBe("1.1");

    // 2. GET a specific version.
    const verRes = await harness.app.request(`/api/v1/skills/${GUID}?version=1.0`, { headers });
    expect(verRes.status).toBe(200);
    expect(((await verRes.json()) as { data: { version: string } }).data.version).toBe("1.0");

    // 3. List versions (newest first).
    const listRes = await harness.app.request(`/api/v1/skills/${GUID}/versions`, { headers });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: { items: Array<{ version: string }> } };
    expect(listBody.data.items.map((i) => i.version)).toEqual(["1.1", "1.0"]);

    // 4. Set a dist-tag.
    const setTagRes = await harness.app.request(`/api/v1/skills/${GUID}/dist-tags/stable`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ version: "1.0" }),
    });
    expect(setTagRes.status).toBe(200);
    expect(((await setTagRes.json()) as { data: { tags: Record<string, string> } }).data.tags.stable).toBe("1.0");

    // 5. Read dist-tags.
    const getTagsRes = await harness.app.request(`/api/v1/skills/${GUID}/dist-tags`, { headers });
    expect(getTagsRes.status).toBe(200);
    const tagsBody = (await getTagsRes.json()) as { data: { tags: Record<string, string> } };
    expect(tagsBody.data.tags.latest).toBe("1.1");
    expect(tagsBody.data.tags.stable).toBe("1.0");

    // 6. Delete the dist-tag.
    const delTagRes = await harness.app.request(`/api/v1/skills/${GUID}/dist-tags/stable`, {
      method: "DELETE",
      headers,
    });
    expect(delTagRes.status).toBe(200);

    // 7. Delete the non-latest version (1.0).
    const delVerRes = await harness.app.request(`/api/v1/skills/${GUID}/versions/1.0`, {
      method: "DELETE",
      headers,
    });
    expect(delVerRes.status).toBe(200);
    const remaining = await harness.db.collection("skill_versions").countDocuments({ skillGuid: GUID });
    expect(remaining).toBe(1);

    // 8. Delete the whole skill.
    const delRes = await harness.app.request(`/api/v1/skills/${GUID}`, { method: "DELETE", headers });
    expect(delRes.status).toBe(200);
    const after = await harness.db.collection("skills").countDocuments({ _id: GUID as never });
    expect(after).toBe(0);
  });
});

/**
 * #632 — server-side zip-bomb guard at the ingestion chokepoint.
 *
 * The guard now lives inside `SkillService.createSkill`, so it covers the
 * raw upload route (`POST /api/v1/skills`) AND the GitHub pull path that
 * bypasses the route. These end-to-end cases POST real synthetic bombs
 * through the actual route → service stack and assert the 413 RFC-7807
 * problem body — without ever touching chrono-storage, because the guard
 * short-circuits BEFORE the storage upload (the harness points
 * chrono-storage at an unreachable URL).
 *
 * Both fixtures compress to a tiny payload (highly-compressible content),
 * so the cheap route-level `maxFileSize` early-out (10 MiB compressed in
 * the harness) is cleared and the UNCOMPRESSED-side guard is what fires.
 */
describe("integration: zip-bomb guard at POST /skills (#632)", () => {
  const headers = authHeaders({
    userId: "user_bomb",
    email: "user_bomb@test.local",
    permissions: ["ornn:skill:create"],
  });
  const zipHeaders = { ...headers, "content-type": "application/zip" };

  test("a >50 MiB-uncompressed ZIP → 413 uncompressed_too_large", async () => {
    // SKILL.md + one 60 MiB entry of NUL bytes. Deflates to a few KiB, so
    // the compressed body clears the route's maxFileSize check; the 60 MiB
    // uncompressed size trips the per-entry / cumulative cap (both surface
    // the same `uncompressed_too_large` code).
    const zip = new JSZip();
    const folder = zip.folder("bomb-skill")!;
    folder.file("SKILL.md", "---\nname: bomb-skill\n---\nbody");
    folder.file("assets/zeros.bin", "\0".repeat(60 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    const res = await harness.app.request("/api/v1/skills", {
      method: "POST",
      headers: zipHeaders,
      body: bytes,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("uncompressed_too_large");
  });

  test("a >1000-entry ZIP → 413 too_many_files", async () => {
    const zip = new JSZip();
    const folder = zip.folder("many-files-skill")!;
    folder.file("SKILL.md", "---\nname: many-files-skill\n---\nbody");
    for (let i = 0; i < 1001; i++) {
      folder.file(`assets/f${i}.txt`, `c${i}`);
    }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    const res = await harness.app.request("/api/v1/skills", {
      method: "POST",
      headers: zipHeaders,
      body: bytes,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("too_many_files");
  });
});
