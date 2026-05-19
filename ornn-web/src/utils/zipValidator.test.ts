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

function fileFromZip(zip: JSZip, name = "skill.zip"): File {
  // jsdom doesn't provide a real File constructor without a Blob shim
  // — we construct from the underlying Uint8Array and trust the
  // function only calls arrayBuffer() on it.
  return new File([], name) as File & { arrayBuffer: () => Promise<ArrayBuffer> } &
    { _zip: JSZip };
}

async function zipToFile(zip: JSZip): Promise<File> {
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "skill.zip");
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
  test("rejects when cumulative uncompressed bytes exceed the cap", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: x\n---\nbody");
    // Single file just over the cap (highly compressible so the ZIP
    // itself stays tiny — that's the bomb pattern).
    const huge = "A".repeat(MAX_TOTAL_UNCOMPRESSED_BYTES + 1);
    zip.file("references/huge.txt", huge);
    const file = await zipToFile(zip);

    const result = await validateSkillZip(file);
    expect(result.status).toBe("invalid");
    expect(result.errors[0]?.key).toBe("errors.zip.uncompressedTooLarge");
    expect((result.errors[0]?.params?.max as number) ?? 0).toBe(
      MAX_TOTAL_UNCOMPRESSED_BYTES,
    );
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
