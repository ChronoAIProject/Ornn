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
  it("pins name/description to the skillset (NOT the members)", () => {
    const { files } = buildSkillsetPlugin(input(), CFG);
    const manifest = JSON.parse(files.get(".claude-plugin/plugin.json")!);
    expect(manifest.name).toBe("research-bundle");
    expect(manifest.description).toBe("A curated research set.");
  });

  it("version is the plain skillset revision — no +sk fingerprint (#1162)", () => {
    const { files } = buildSkillsetPlugin(input(), CFG);
    const { version } = JSON.parse(files.get(".claude-plugin/plugin.json")!);
    expect(version).toBe("2.0");
  });
});

describe("buildSkillsetPlugin — version = skillset revision (#1162)", () => {
  it("plugin.json + marketplace carry the SAME revision (they agree, no +sk)", () => {
    const { files, marketplace } = buildSkillsetPlugin(input(), CFG);
    const { version } = JSON.parse(files.get(".claude-plugin/plugin.json")!);
    expect(version).toBe("2.0");
    expect(marketplace.version).toBe("2.0");
  });

  it("tracks the revision passed in — a member's resolved version no longer alters it", () => {
    // The revision is now bumped by the service before this builder runs, so a
    // moving member changes the plugin version ONLY via a higher `input.version`,
    // never a fingerprint over the member set.
    const at10 = JSON.parse(
      buildSkillsetPlugin(input({ version: "2.1" }), CFG).files.get(".claude-plugin/plugin.json")!,
    ).version;
    expect(at10).toBe("2.1");
    // Same revision but a member moved 1.2 -> 1.3 → identical plugin version.
    const movedMember = input({
      version: "2.0",
      members: [
        member({ name: "pdf-extract", version: "1.3", files: { "SKILL.md": "# pdf" } }),
        member({ name: "ocr", description: "OCR images.", files: { "SKILL.md": "# ocr" } }),
      ],
    });
    expect(
      JSON.parse(buildSkillsetPlugin(movedMember, CFG).files.get(".claude-plugin/plugin.json")!)
        .version,
    ).toBe("2.0");
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

describe("buildSkillsetPlugin — excluded members (#1161)", () => {
  it("adds a deterministic Excluded-members note when members were dropped", () => {
    const { files } = buildSkillsetPlugin(
      input({ excludedMembers: ["secret-tools", "legacy-thing"] }),
      CFG,
    );
    const readme = files.get("README.md")!;
    expect(readme).toContain("## Excluded members");
    expect(readme).toContain("currently private or unresolvable");
    expect(readme).toContain("`secret-tools`");
    expect(readme).toContain("`legacy-thing`");
    // Sorted + de-duped so the same exclusion set never churns.
    const a = buildSkillsetPlugin(
      input({ excludedMembers: ["legacy-thing", "secret-tools", "secret-tools"] }),
      CFG,
    ).files.get("README.md")!;
    const b = buildSkillsetPlugin(
      input({ excludedMembers: ["secret-tools", "legacy-thing"] }),
      CFG,
    ).files.get("README.md")!;
    expect(a).toBe(b);
  });

  it("omits the Excluded-members heading entirely when nothing was dropped", () => {
    const none = buildSkillsetPlugin(input(), CFG).files.get("README.md")!;
    expect(none).not.toContain("## Excluded members");
    const empty = buildSkillsetPlugin(input({ excludedMembers: [] }), CFG).files.get("README.md")!;
    expect(empty).not.toContain("## Excluded members");
  });

  it("the excluded list NEVER changes the plugin version (#1162)", () => {
    // The version is the skillset revision (`input.version`), independent of
    // the members or the exclusion list — so different exclusion lists yield an
    // identical plugin.json version but a README that differs by the note.
    const withExcl = buildSkillsetPlugin(input({ excludedMembers: ["dropped"] }), CFG);
    const withoutExcl = buildSkillsetPlugin(input(), CFG);
    const vA = JSON.parse(withExcl.files.get(".claude-plugin/plugin.json")!).version;
    const vB = JSON.parse(withoutExcl.files.get(".claude-plugin/plugin.json")!).version;
    expect(vA).toBe(vB);
    expect(vA).toBe("2.0");
    expect(withExcl.files.get("README.md")).not.toBe(withoutExcl.files.get("README.md"));
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

describe("buildSkillsetPlugin — owner listing overrides (#1157)", () => {
  it("emits displayName in plugin.json only when overridden", () => {
    const without = JSON.parse(
      buildSkillsetPlugin(input(), CFG).files.get(".claude-plugin/plugin.json")!,
    );
    expect(without.displayName).toBeUndefined();

    const withOverride = JSON.parse(
      buildSkillsetPlugin(
        input({ pluginConfig: { displayName: "Research Bundle" } }),
        CFG,
      ).files.get(".claude-plugin/plugin.json")!,
    );
    expect(withOverride.displayName).toBe("Research Bundle");
  });

  it("overrides plugin.json + marketplace description, falling back when absent", () => {
    const overridden = buildSkillsetPlugin(
      input({ pluginConfig: { description: "Custom blurb" } }),
      CFG,
    );
    expect(JSON.parse(overridden.files.get(".claude-plugin/plugin.json")!).description).toBe(
      "Custom blurb",
    );
    expect(overridden.marketplace.description).toBe("Custom blurb");
    // README blurb reflects the override too.
    expect(overridden.files.get("README.md")!).toContain("> Custom blurb");

    // No override → skillset description is used.
    const fallback = buildSkillsetPlugin(input(), CFG);
    expect(fallback.marketplace.description).toBe("A curated research set.");
  });

  it("overrides marketplace keywords, falling back to skillset tags when absent", () => {
    const overridden = buildSkillsetPlugin(
      input({ pluginConfig: { keywords: ["rag", "search"] } }),
      CFG,
    );
    expect(overridden.marketplace.keywords).toEqual(["rag", "search"]);

    const fallback = buildSkillsetPlugin(input(), CFG);
    expect(fallback.marketplace.keywords).toEqual(["research"]);
  });

  it("stays deterministic with overrides applied (no churn)", () => {
    const cfg = { pluginConfig: { displayName: "X", description: "Y", keywords: ["z"] } };
    const a = buildSkillsetPlugin(input(cfg), CFG);
    const b = buildSkillsetPlugin(input(cfg), CFG);
    for (const [path, content] of a.files) {
      expect(b.files.get(path)).toBe(content);
    }
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
