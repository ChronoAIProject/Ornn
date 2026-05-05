import { describe, test, expect, mock } from "bun:test";
import { gunzipSync } from "node:zlib";
import { AuditBodyStorage, _internals } from "./bodyStorage";
import type { IStorageClient } from "../../clients/storageClient";

class FakeStorage implements IStorageClient {
  uploads: Array<{ bucket: string; key: string; data: Uint8Array; contentType: string }> = [];
  upload = mock(async (
    bucket: string,
    key: string,
    data: Uint8Array,
    contentType: string,
  ) => {
    this.uploads.push({ bucket, key, data, contentType });
    return { url: `mem://${bucket}/${key}` };
  });
  delete = mock(async () => {});
  getPresignedUrl = mock(async () => ({ presignedUrl: "x", expiresAt: "" }));
  copy = mock(async () => {});
}

describe("AuditBodyStorage", () => {
  test("gzips JSON body and uploads under a date-partitioned key", async () => {
    const storage = new FakeStorage();
    const subject = new AuditBodyStorage(storage, "ornn-audit-test");

    const result = await subject.put({
      auditId: "01HX0000000000000000000001",
      side: "req",
      body: { skillName: "alpha", ratio: 0.5 },
    });

    expect(storage.uploads).toHaveLength(1);
    const u = storage.uploads[0];
    expect(u.bucket).toBe("ornn-audit-test");
    expect(u.contentType).toBe("application/gzip");
    expect(u.key).toBe(result.key);
    expect(/^\d{4}\/\d{2}\/\d{2}\/01HX0000000000000000000001-req\.json\.gz$/.test(u.key)).toBe(
      true,
    );

    const decoded = JSON.parse(gunzipSync(Buffer.from(u.data)).toString("utf-8"));
    expect(decoded).toEqual({ skillName: "alpha", ratio: 0.5 });
  });

  test("buildKey shape — UTC, zero-padded", () => {
    const at = new Date(Date.UTC(2026, 0, 9, 12, 0, 0));
    const key = _internals.buildKey("01HXAUDITTEST00", "res", at);
    expect(key).toBe("2026/01/09/01HXAUDITTEST00-res.json.gz");
  });

  test("null body persists as `null`", async () => {
    const storage = new FakeStorage();
    const subject = new AuditBodyStorage(storage, "ornn-audit-test");

    await subject.put({
      auditId: "X",
      side: "res",
      body: null,
    });

    const u = storage.uploads[0];
    const decoded = JSON.parse(gunzipSync(Buffer.from(u.data)).toString("utf-8"));
    expect(decoded).toBeNull();
  });
});
