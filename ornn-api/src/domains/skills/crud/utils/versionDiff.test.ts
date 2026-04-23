import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { computeVersionDiff } from "./versionDiff";

async function buildZip(files: Record<string, string | Uint8Array>, rootFolder = "my-skill"): Promise<Uint8Array> {
  const zip = new JSZip();
  const folder = zip.folder(rootFolder);
  if (!folder) throw new Error("JSZip folder creation failed");
  for (const [path, content] of Object.entries(files)) {
    folder.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("computeVersionDiff", () => {
  test("detects added / removed / modified / unchanged", async () => {
    const fromZip = await buildZip({
      "SKILL.md": "---\nname: my-skill\n---\n# v1\n",
      "scripts/main.js": "console.log('v1');\n",
      "kept.txt": "same on both sides\n",
    });
    const toZip = await buildZip({
      "SKILL.md": "---\nname: my-skill\n---\n# v2\n", // modified
      "scripts/main.js": "console.log('v2');\n",     // modified
      "kept.txt": "same on both sides\n",            // unchanged
      "scripts/helper.js": "export const x = 1;\n",  // added
    });

    const result = await computeVersionDiff(fromZip, toZip);
    expect(result.files.unchangedCount).toBe(1);
    expect(result.files.added.map((a) => a.path)).toEqual(["scripts/helper.js"]);
    expect(result.files.removed).toEqual([]);
    expect(result.files.modified.map((m) => m.path).sort()).toEqual([
      "SKILL.md",
      "scripts/main.js",
    ]);
  });

  test("text files include both contents for modified", async () => {
    const fromZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# Before\n",
    });
    const toZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# After\n",
    });
    const result = await computeVersionDiff(fromZip, toZip);
    const modified = result.files.modified.find((m) => m.path === "SKILL.md")!;
    expect(modified.isText).toBe(true);
    expect(modified.fromContent).toContain("Before");
    expect(modified.toContent).toContain("After");
    expect(modified.truncated).toBe(false);
  });

  test("binary files omit content field", async () => {
    const imgBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const fromZip = await buildZip({ "assets/logo.png": imgBytes });
    const toZip = await buildZip({
      "assets/logo.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
    });
    const result = await computeVersionDiff(fromZip, toZip);
    const modified = result.files.modified[0]!;
    expect(modified.isText).toBe(false);
    expect(modified.fromContent).toBeUndefined();
    expect(modified.toContent).toBeUndefined();
    expect(modified.fromHash).not.toBe(modified.toHash);
  });

  test("removed text file includes its content (for UI rendering)", async () => {
    const fromZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# keep\n",
      "scripts/old.js": "console.log('bye');\n",
    });
    const toZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# keep\n",
    });
    const result = await computeVersionDiff(fromZip, toZip);
    expect(result.files.removed).toHaveLength(1);
    expect(result.files.removed[0]!.path).toBe("scripts/old.js");
    expect(result.files.removed[0]!.content).toContain("bye");
  });

  test("added text file includes its content", async () => {
    const fromZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# keep\n",
    });
    const toZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# keep\n",
      "scripts/new.js": "console.log('hi');\n",
    });
    const result = await computeVersionDiff(fromZip, toZip);
    expect(result.files.added).toHaveLength(1);
    expect(result.files.added[0]!.content).toContain("hi");
  });

  test("truncates large text files and flags truncation", async () => {
    const huge = "a".repeat(200_000);
    const fromZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# header\n",
      "big.txt": huge,
    });
    const toZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n# header\n",
      "big.txt": huge + "MUTATE",
    });
    const result = await computeVersionDiff(fromZip, toZip, { maxContentBytesPerSide: 1024 });
    const big = result.files.modified.find((m) => m.path === "big.txt")!;
    expect(big.truncated).toBe(true);
    expect(big.fromContent?.length).toBe(1024);
    expect(big.toContent?.length).toBe(1024);
  });

  test("stable deterministic path ordering", async () => {
    const fromZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n\n# old",
    });
    const toZip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n\n# old",
      "c.txt": "c",
      "a.txt": "a",
      "b.txt": "b",
    });
    const result = await computeVersionDiff(fromZip, toZip);
    expect(result.files.added.map((a) => a.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  test("SAME_VERSION edge: identical zips report all-unchanged", async () => {
    const zip = await buildZip({
      "SKILL.md": "---\nname: x\n---\n\n# same",
      "scripts/main.js": "console.log(1);\n",
    });
    const result = await computeVersionDiff(zip, zip);
    expect(result.files.added).toEqual([]);
    expect(result.files.removed).toEqual([]);
    expect(result.files.modified).toEqual([]);
    expect(result.files.unchangedCount).toBe(2);
  });
});
