/**
 * UT-WEB-GENERATION-PARSER-001 (#1242)
 *
 * First tests for the generation output parser. Pins the fence/prose
 * cleanup, metadata extraction, the SKILL.md assembly, and — new in
 * #1242 — that `references[]` and `assets[]` become folders next to
 * `scripts/` while empty arrays leave no folder behind (the simple-mode
 * preview must be a single SKILL.md).
 *
 * @module utils/generationParser.test
 */

import { describe, it, expect } from "vitest";
import {
  buildFileTreeFromParsed,
  cleanJsonFences,
  extractMetadata,
  parseGenerationOutput,
} from "./generationParser";
import type { FileNode } from "@/components/editor/FileTree";

const PLAIN = {
  name: "demo-skill",
  description: "A demo skill for the parser tests.",
  category: "plain",
  tags: ["demo"],
  readmeBody: "# Demo\n\nBody text.",
  runtimes: [],
  dependencies: [],
  envVars: [],
  scripts: [],
  references: [],
  assets: [],
};

const ADVANCED = {
  ...PLAIN,
  name: "advanced-skill",
  category: "runtime-based",
  outputType: "file",
  runtimes: ["node"],
  dependencies: ["sharp"],
  envVars: ["TARGET"],
  scripts: [{ filename: "main.js", content: "console.log(1)" }],
  references: [{ filename: "api.md", content: "# API" }],
  assets: [{ filename: "template.json", content: "{}" }],
};

/** Child ids under the root node, in order. */
function rootChildIds(files: FileNode[]): string[] {
  return (files[0]?.children ?? []).map((n) => n.id);
}

describe("cleanJsonFences", () => {
  it("strips a ```json fence", () => {
    expect(cleanJsonFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("strips a bare ``` fence", () => {
    expect(cleanJsonFences("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("slices the brace span out of surrounding prose", () => {
    expect(cleanJsonFences('Here you go:\n{"a":1}\nEnjoy!')).toBe('{"a":1}');
  });

  it("leaves text without braces untouched", () => {
    expect(cleanJsonFences("no json here")).toBe("no json here");
  });
});

describe("extractMetadata", () => {
  it("maps flat LLM fields into the nested metadata block", () => {
    const md = extractMetadata(ADVANCED);
    expect(md.name).toBe("advanced-skill");
    expect(md.metadata.category).toBe("runtime-based");
    expect(md.metadata.outputType).toBe("file");
    expect(md.metadata.runtime).toEqual(["node"]);
    expect(md.metadata.runtimeDependency).toEqual(["sharp"]);
    expect(md.metadata.runtimeEnvVar).toEqual(["TARGET"]);
    expect(md.metadata.tag).toEqual(["demo"]);
  });

  it("falls back to plain / empty arrays / generated-skill when fields are missing", () => {
    const md = extractMetadata({});
    expect(md.name).toBe("generated-skill");
    expect(md.metadata.category).toBe("plain");
    expect(md.metadata.runtime).toEqual([]);
    expect(md.metadata.tag).toEqual([]);
  });

  it("accepts the legacy env / npmDependencies spellings", () => {
    const md = extractMetadata({ env: ["A"], npmDependencies: ["b"] });
    expect(md.metadata.runtimeEnvVar).toEqual(["A"]);
    expect(md.metadata.runtimeDependency).toEqual(["b"]);
  });
});

describe("buildFileTreeFromParsed", () => {
  it("emits only SKILL.md when every file array is empty (simple-mode shape)", () => {
    const { files, contents } = buildFileTreeFromParsed(PLAIN, extractMetadata(PLAIN));
    expect(rootChildIds(files)).toEqual(["SKILL.md"]);
    expect([...contents.keys()]).toEqual(["SKILL.md"]);
    // SKILL.md = frontmatter + body.
    const skillMd = contents.get("SKILL.md")!;
    expect(skillMd.startsWith("---")).toBe(true);
    expect(skillMd).toContain("name: demo-skill");
    expect(skillMd).toContain("# Demo");
  });

  it("emits scripts/, references/ and assets/ folders in that order (advanced mode, #1242)", () => {
    const { files, contents } = buildFileTreeFromParsed(ADVANCED, extractMetadata(ADVANCED));
    expect(rootChildIds(files)).toEqual(["SKILL.md", "scripts", "references", "assets"]);
    const folders = files[0]!.children!.slice(1);
    expect(folders.map((f) => f.type)).toEqual(["folder", "folder", "folder"]);
    expect(folders[1]!.children).toEqual([{ id: "references/api.md", name: "api.md", type: "file" }]);
    expect(folders[2]!.children).toEqual([{ id: "assets/template.json", name: "template.json", type: "file" }]);
    expect(contents.get("scripts/main.js")).toBe("console.log(1)");
    expect(contents.get("references/api.md")).toBe("# API");
    expect(contents.get("assets/template.json")).toBe("{}");
  });

  it("omits a folder whose array is missing entirely (older model output)", () => {
    const { scripts, ...noArrays } = ADVANCED;
    const parsed = { ...noArrays, scripts, references: undefined, assets: undefined };
    const { files } = buildFileTreeFromParsed(parsed, extractMetadata(parsed));
    expect(rootChildIds(files)).toEqual(["SKILL.md", "scripts"]);
  });

  it("uses per-folder fallback filenames when an entry has none", () => {
    const parsed = {
      ...PLAIN,
      scripts: [{ content: "s" }],
      references: [{ content: "r" }],
      assets: [{ name: "named.txt", content: "a" }],
    };
    const { contents } = buildFileTreeFromParsed(parsed, extractMetadata(parsed));
    expect(contents.has("scripts/script.ts")).toBe(true);
    expect(contents.has("references/reference.md")).toBe(true);
    expect(contents.has("assets/named.txt")).toBe(true);
  });

  it("migrates legacy readmeMd (with frontmatter) into the body", () => {
    const parsed = {
      ...PLAIN,
      readmeBody: undefined,
      readmeMd: "---\ntitle: x\n---\n# Legacy body",
    };
    const { contents } = buildFileTreeFromParsed(parsed, extractMetadata(parsed));
    const skillMd = contents.get("SKILL.md")!;
    expect(skillMd).toContain("# Legacy body");
    expect(skillMd).not.toContain("title: x");
  });
});

describe("parseGenerationOutput", () => {
  it("parses fenced JSON into files + metadata", () => {
    const out = parseGenerationOutput("```json\n" + JSON.stringify(ADVANCED) + "\n```");
    expect(out.metadata?.name).toBe("advanced-skill");
    expect(rootChildIds(out.files)).toEqual(["SKILL.md", "scripts", "references", "assets"]);
  });

  it("falls back to treating unparseable output as SKILL.md with null metadata", () => {
    const out = parseGenerationOutput("Sorry, could you clarify what the skill should do?");
    expect(out.metadata).toBeNull();
    expect(rootChildIds(out.files)).toEqual(["SKILL.md"]);
    expect(out.contents.get("SKILL.md")).toContain("could you clarify");
  });
});
