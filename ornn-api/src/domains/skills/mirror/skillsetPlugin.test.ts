/**
 * Unit tests for the curated multi-skill skillset plugin builder (#1155).
 *
 * Pure functions — no GitHub, no DB. Load-bearing properties:
 *   1. Layout — `skills/<member>/SKILL.md` (+ that member's files),
 *      `.claude-plugin/plugin.json`, `README.md`; NO root SKILL.md.
 *   2. plugin.json = { name, version, description } pinned to the skillset.
 *   3. The master prompt lands in the README only, never as a skill.
 *   4. Determinism — same input -> byte-identical output (members sorted +
 *      de-duped, no timestamp), so the mirror never churns no-op commits.
 *   5. Member-name safety filtering keeps a poisoned name out of the subtree.
 *   6. Marketplace entry source is `./skillsets/<name>`.
 */

import { describe, expect, it } from "bun:test";
import {
  buildSkillsetPlugin,
  isSafeMemberName,
  skillsetMarketplaceInput,
  type SkillsetPluginInput,
  type SkillsetPluginMember,
} from "./skillsetPlugin";

const CFG = {
  ornnPublicOrigin: "https://ornn.example",
  repoSlug: "ChronoAIProject/ornn-skills",
  repoName: "ornn-skills",
};

function member(overrides: Partial<SkillsetPluginMember> = {}): SkillsetPluginMember {
  return {
    name: "pdf-extract",
    version: "1.2",
    description: "Extract text from PDFs.",
    files: { "SKILL.md": "# pdf-extract" },
    ...overrides,
  };
}

function input(overrides: Partial<SkillsetPluginInput> = {}): SkillsetPluginInput {
  return {
    name: "research-bundle",
    description: "A curated research set.",
    version: "2.0",
    tags: ["research"],
    instructions: "Run pdf-extract, then ocr.",
    members: [
      member({ name: "pdf-extract", files: { "SKILL.md": "# pdf", "references/x.md": "ref" } }),
      member({ name: "ocr", description: "OCR images.", files: { "SKILL.md": "# ocr" } }),
    ],
    ...overrides,
  };
}

describe("buildSkillsetPlugin — layout", () => {
  it("places each member under skills/<member>/ and writes a plugin manifest + README", () => {
    const { files } = buildSkillsetPlugin(input(), CFG);
    const paths = [...files.keys()];
    expect(paths).toContain(".claude-plugin/plugin.json");
    expect(paths).toContain("skills/pdf-extract/SKILL.md");
    expect(paths).toContain("skills/pdf-extract/references/x.md");
    expect(paths).toContain("skills/ocr/SKILL.md");
    expect(paths).toContain("README.md");
    // Multi-skill plugins use skills/<name>/SKILL.md discovery — never a root one.
    expect(paths).not.toContain("SKILL.md");
  });

  it("embeds member files verbatim", () => {
    const { files } = buildSkillsetPlugin(input(), CFG);
    expect(files.get("skills/pdf-extract/references/x.md")).toBe("ref");
    expect(files.get("skills/ocr/SKILL.md")).toBe("# ocr");
  });
});

describe("buildSkillsetPlugin — plugin.json", () => {
  it("pins name/version/description to the skillset (NOT the members)", () => {
    const { files } = buildSkillsetPlugin(input(), CFG);
    const manifest = JSON.parse(files.get(".claude-plugin/plugin.json")!);
    expect(manifest).toEqual({
      name: "research-bundle",
      version: "2.0",
      description: "A curated research set.",
    });
  });
});

describe("buildSkillsetPlugin — README", () => {
  it("carries the master prompt, member list, and install snippet — never as a skill", () => {
    const { files } = buildSkillsetPlugin(input(), CFG);
    const readme = files.get("README.md")!;
    expect(readme).toContain("Run pdf-extract, then ocr."); // master prompt
    expect(readme).toContain("`pdf-extract@1.2`");
    expect(readme).toContain("`ocr@1.2`");
    expect(readme).toContain("/plugin marketplace add ChronoAIProject/ornn-skills");
    expect(readme).toContain("/plugin install research-bundle@ornn-skills");
    expect(readme).toContain("auto-update OFF");
    expect(readme).toContain("https://ornn.example/skillsets/research-bundle");
    // The master prompt is README-only: no skills/<name>/ file holds it.
    expect([...files.keys()].some((p) => p.startsWith("skills/") && files.get(p) === "Run pdf-extract, then ocr.")).toBe(false);
  });

  it("has NO timestamp so output stays byte-stable", () => {
    const a = buildSkillsetPlugin(input(), CFG).files.get("README.md")!;
    const b = buildSkillsetPlugin(input(), CFG).files.get("README.md")!;
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamp
  });
});

describe("buildSkillsetPlugin — determinism", () => {
  it("produces byte-identical output regardless of member input order", () => {
    const ordered = input();
    const shuffled = input({ members: [...input().members].reverse() });
    const a = buildSkillsetPlugin(ordered, CFG);
    const b = buildSkillsetPlugin(shuffled, CFG);
    // Same file set + same bytes per path.
    expect([...a.files.keys()].sort()).toEqual([...b.files.keys()].sort());
    for (const [path, content] of a.files) {
      expect(b.files.get(path)).toBe(content);
    }
  });

  it("de-dupes members that resolve to the same name (first wins)", () => {
    const dup = input({
      members: [
        member({ name: "pdf-extract", version: "1.2", files: { "SKILL.md": "first" } }),
        member({ name: "pdf-extract", version: "1.3", files: { "SKILL.md": "second" } }),
      ],
    });
    const { files } = buildSkillsetPlugin(dup, CFG);
    expect(files.get("skills/pdf-extract/SKILL.md")).toBe("first");
  });
});

describe("buildSkillsetPlugin — member-name safety", () => {
  it("skips a member whose name would escape its subtree (#807)", () => {
    const poisoned = input({
      members: [
        member({ name: "../evil", files: { "SKILL.md": "# evil" } }),
        member({ name: "ocr", files: { "SKILL.md": "# ocr" } }),
      ],
    });
    const { files } = buildSkillsetPlugin(poisoned, CFG);
    const paths = [...files.keys()];
    expect(paths.some((p) => p.includes(".."))).toBe(false);
    expect(paths).toContain("skills/ocr/SKILL.md");
    // The poisoned member's content never lands anywhere.
    expect([...files.values()].some((c) => c === "# evil")).toBe(false);
  });

  it("isSafeMemberName accepts kebab-case, rejects traversal/uppercase", () => {
    expect(isSafeMemberName("pdf-extract")).toBe(true);
    expect(isSafeMemberName("../evil")).toBe(false);
    expect(isSafeMemberName("a/b")).toBe(false);
    expect(isSafeMemberName("PdfExtract")).toBe(false);
  });
});

describe("skillsetMarketplaceInput", () => {
  it("sources from ./skillsets/<name> and maps tags to keywords", () => {
    const entry = skillsetMarketplaceInput({
      name: "research-bundle",
      description: "A set.",
      version: "2.0",
      keywords: ["research", "rag"],
    });
    expect(entry).toEqual({
      name: "research-bundle",
      source: "./skillsets/research-bundle",
      description: "A set.",
      version: "2.0",
      keywords: ["research", "rag"],
    });
  });

  it("is what buildSkillsetPlugin returns as the catalogue entry", () => {
    const { marketplace } = buildSkillsetPlugin(input(), CFG);
    expect(marketplace.source).toBe("./skillsets/research-bundle");
    expect(marketplace.name).toBe("research-bundle");
    expect(marketplace.keywords).toEqual(["research"]);
  });
});
