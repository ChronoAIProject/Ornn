import { describe, test, expect } from "bun:test";
import {
  parseJsonStringArray,
  resolveAuthorName,
  collectUploadedFiles,
  buildVirtualArchive,
} from "./skillPackageBuilder";

describe("parseJsonStringArray", () => {
  test("validJsonArray_returnsArray", () => {
    expect(parseJsonStringArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  test("emptyArray_returnsEmpty", () => {
    expect(parseJsonStringArray("[]")).toEqual([]);
  });

  test("invalidJson_returnsEmpty", () => {
    expect(parseJsonStringArray("not json")).toEqual([]);
  });

  test("nonString_returnsEmpty", () => {
    expect(parseJsonStringArray(123)).toEqual([]);
    expect(parseJsonStringArray(undefined)).toEqual([]);
    expect(parseJsonStringArray(null)).toEqual([]);
  });

  test("jsonObject_returnsEmpty", () => {
    expect(parseJsonStringArray('{"key":"val"}')).toEqual([]);
  });
});

describe("resolveAuthorName", () => {
  test("bodyValuePresent_returnsBodyValue", () => {
    expect(resolveAuthorName("john", { userId: "u1", email: "j@e.com", role: "user" })).toBe("john");
  });

  test("bodyValueEmpty_fallsBackToAuth", () => {
    expect(resolveAuthorName("", { userId: "u1", email: "j@e.com", role: "user" })).toBe("j@e.com");
  });

  test("bodyValueUndefined_fallsBackToAuth", () => {
    expect(resolveAuthorName(undefined, { userId: "u1", email: "j@e.com", role: "user" })).toBe("j@e.com");
  });

  test("noAuth_returnsUndefined", () => {
    expect(resolveAuthorName(undefined, null)).toBeUndefined();
  });

  test("nonString_fallsBackToAuth", () => {
    expect(resolveAuthorName(42, { userId: "u1", email: "j@e.com", role: "user" })).toBe("j@e.com");
  });
});

describe("collectUploadedFiles", () => {
  test("noFiles_returnsEmpty", () => {
    const result = collectUploadedFiles({});
    expect(result).toEqual([]);
  });

  test("singleFile_collectsIt", () => {
    const file = new File(["content"], "test.ts");
    const result = collectUploadedFiles({ file_0: file });
    expect(result.length).toBe(1);
    expect(result[0].file).toBe(file);
    expect(result[0].folder).toBe("");
  });

  test("fileWithFolderMeta_usesFolderMeta", () => {
    const file = new File(["content"], "deploy.ts");
    const result = collectUploadedFiles({
      file_0: file,
      file_0_folder: "scripts",
    });
    expect(result[0].folder).toBe("scripts");
  });

  test("fileWithSlashInName_extractsFolderFromName", () => {
    const file = new File(["content"], "scripts/deploy.ts");
    const result = collectUploadedFiles({ file_0: file });
    expect(result[0].folder).toBe("scripts");
  });

  test("multipleFiles_collectsAll", () => {
    const result = collectUploadedFiles({
      file_0: new File(["a"], "a.ts"),
      file_1: new File(["b"], "b.ts"),
      file_2: new File(["c"], "c.ts"),
    });
    expect(result.length).toBe(3);
  });

  test("stopsAtFirstNonFile", () => {
    const result = collectUploadedFiles({
      file_0: new File(["a"], "a.ts"),
      file_1: "not a file",
    });
    expect(result.length).toBe(1);
  });
});

describe("buildVirtualArchive", () => {
  test("createsArchiveWithSkillMd", async () => {
    const archive = await buildVirtualArchive(
      "test-skill",
      "---\nname: test\n---\n# Test",
      [],
    );
    expect(archive).toBeInstanceOf(File);
    expect(archive.name).toBe("test-skill.tar.gz");
    expect(archive.size).toBeGreaterThan(0);
  });

  test("createsArchiveWithFiles", async () => {
    const files = [
      {
        file: new File(["console.log('hello')"], "hello.ts"),
        folder: "scripts",
      },
    ];
    const archive = await buildVirtualArchive("test-skill", "", files);
    expect(archive.size).toBeGreaterThan(0);
  });

  test("archiveType_isTarGz", async () => {
    const archive = await buildVirtualArchive("my-skill", "# content", []);
    expect(archive.type).toBe("application/gzip");
    expect(archive.name).toContain(".tar.gz");
  });
});
