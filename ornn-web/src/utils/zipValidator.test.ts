/**
 * Tests for the ZIP validator hardening landed in #443:
 *
 *   - cumulative uncompressed-size cap (zip-bomb defence)
 *   - explicit zip-slip / unsafe-path rejection
 *
 * Pre-existing happy-path behaviour is exercised via the
 * SkillUploadPage component tests; this file is scoped to the two
 * new guards.
 */

import { describe, expect, test } from "vitest";
import JSZip from "jszip";
import {
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  validateSkillZip,
} from "./zipValidator";

async function zipToFile(zip: JSZip): Promise<File> {
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "skill.zip");
}

async function zipWithDeclaredSizes(sizes: number[]): Promise<File> {
  const zip = new JSZip();
  zip.file("SKILL.md", "---\nname: x\n---\nbody");
  const declaredSizes = new Map(
    sizes.map((size, index) => [`references/entry-${index}.txt`, size]),
  );
  for (const path of declaredSizes.keys()) {
    zip.file(path, "A", { createFolders: false });
  }

  // The guard reads ZIP size metadata before extraction. Keep actual payloads
  // tiny and declare oversized entries instead of allocating/copying 50 MiB.
  // A regression that reaches extraction will fail JSZip's size verification.
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const view = new DataView(bytes.buffer);
  const endOfCentralDirectory = bytes.length - 22; // No archive comment.
  expect(view.getUint32(endOfCentralDirectory, true)).toBe(0x06054b50);
  let offset = view.getUint32(endOfCentralDirectory + 16, true);
  const entryCount = view.getUint16(endOfCentralDirectory + 10, true);
  let patched = 0;
  for (let index = 0; index < entryCount; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const path = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const size = declaredSizes.get(path);
    if (size !== undefined) {
      const localHeader = view.getUint32(offset + 42, true);
      expect(view.getUint32(localHeader, true)).toBe(0x04034b50);
      view.setUint32(localHeader + 22, size, true);
      view.setUint32(offset + 24, size, true);
      patched++;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  expect(patched).toBe(sizes.length);
  return new File([bytes], "skill.zip");
}

describe("validateSkillZip — zip-slip defence (#443)", () => {
  test("rejects a path with .. segment", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: x\n---\nbody");
    zip.file("../escape.txt", "i should not exist outside the skill dir");
    const file = await zipToFile(zip);

    const result = await validateSkillZip(file);
    // JSZip normalises `../` at archive-write time, so the entry
    // surfaces with the leading-slash form — the unsafe-path check
    // still has to fire on the normalised path.
    expect(result.status).toBe("invalid");
    expect(result.errors[0]?.key).toBe("errors.zip.unsafePath");
  });

  test("rejects a path starting with /", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: x\n---\nbody");
    zip.file("/etc/passwd", "root:x:0:0");
    const file = await zipToFile(zip);

    const result = await validateSkillZip(file);
    expect(result.status).toBe("invalid");
    expect(result.errors[0]?.key).toBe("errors.zip.unsafePath");
  });

  test("rejects a backslash path (Windows path separator)", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: x\n---\nbody");
    zip.file("scripts\\nested\\evil.bat", "echo pwned");
    const file = await zipToFile(zip);

    const result = await validateSkillZip(file);
    expect(result.status).toBe("invalid");
    expect(result.errors[0]?.key).toBe("errors.zip.unsafePath");
  });

  test("rejects a Windows drive-letter prefix", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: x\n---\nbody");
    // Use a backslash-free version since the backslash check fires first.
    zip.file("C:/Windows/system32/evil.bat", "echo pwned");
    const file = await zipToFile(zip);

    const result = await validateSkillZip(file);
    expect(result.status).toBe("invalid");
    expect(result.errors[0]?.key).toBe("errors.zip.unsafePath");
  });
});

describe("validateSkillZip — uncompressed-size cap (#443)", () => {
  test.each([
    ["one oversized entry", [MAX_TOTAL_UNCOMPRESSED_BYTES + 1]],
    ["multiple individually allowed entries", [MAX_TOTAL_UNCOMPRESSED_BYTES / 2, MAX_TOTAL_UNCOMPRESSED_BYTES / 2]],
  ])("rejects %s before extraction", async (_description, sizes) => {
    const file = await zipWithDeclaredSizes(sizes);
    expect(file.size).toBeLessThan(1024);

    const result = await validateSkillZip(file);
    expect(result.status).toBe("invalid");
    expect(result.files).toEqual([]);
    expect(result.errors).toEqual([{
      key: "errors.zip.uncompressedTooLarge",
      params: {
        actual: sizes.reduce((sum, size) => sum + size, "---\nname: x\n---\nbody".length),
        max: MAX_TOTAL_UNCOMPRESSED_BYTES,
      },
    }]);
  });

  test("accepts a ZIP comfortably under the cap", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: x\nversion: \"1.0\"\nmetadata:\n  category: text\n---\nbody");
    zip.file("references/note.md", "small file");
    const file = await zipToFile(zip);

    const result = await validateSkillZip(file);
    // The frontmatter parse warning is allowed; what we care about
    // here is that the cap didn't fire.
    expect(result.errors.find((e) => e.key === "errors.zip.uncompressedTooLarge")).toBeUndefined();
  });
});
