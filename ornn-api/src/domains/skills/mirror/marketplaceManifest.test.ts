/**
 * Unit tests for the Claude Code marketplace manifest generators (#1153).
 *
 * Pure functions — no GitHub, no DB. The load-bearing properties:
 *   1. Output is valid JSON matching the Claude Code marketplace /
 *      plugin schema (name/owner/plugins, source "./<name>").
 *   2. Output is DETERMINISTIC — plugins sorted by name, stable key
 *      order — so the mirror's blob-SHA no-op check never sees churn.
 *   3. `keywords` is present only when the skill has tags.
 */

import { describe, expect, it } from "bun:test";
import {
  buildMarketplaceJson,
  buildPluginJson,
  MARKETPLACE_MANIFEST_PATH,
  PLUGIN_MANIFEST_RELPATH,
  type MarketplaceConfig,
  type MarketplacePluginInput,
} from "./marketplaceManifest";

const CFG: MarketplaceConfig = {
  name: "ornn-skills",
  owner: { name: "ChronoAIProject" },
};

/**
 * A single-skill plugin entry — source defaults to `./<name>` so the
 * existing per-skill assertions stay valid. Callers override `source`
 * (e.g. `./skillsets/<name>`) to exercise the #1155 generalization.
 */
function skill(overrides: Partial<MarketplacePluginInput> = {}): MarketplacePluginInput {
  const name = overrides.name ?? "demo-skill";
  return {
    name,
    source: `./${name}`,
    description: "A test skill.",
    version: "1.0",
    keywords: [],
    ...overrides,
  };
}

describe("constants", () => {
  it("uses the Claude Code well-known paths", () => {
    expect(MARKETPLACE_MANIFEST_PATH).toBe(".claude-plugin/marketplace.json");
    expect(PLUGIN_MANIFEST_RELPATH).toBe(".claude-plugin/plugin.json");
  });
});

describe("buildMarketplaceJson", () => {
  it("renders a valid marketplace catalogue for one skill", () => {
    const out = buildMarketplaceJson([skill({ name: "pdf-extract", keywords: ["pdf"] })], CFG);
    const parsed = JSON.parse(out);
    expect(parsed.name).toBe("ornn-skills");
    expect(parsed.owner).toEqual({ name: "ChronoAIProject" });
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0]).toEqual({
      name: "pdf-extract",
      source: "./pdf-extract",
      description: "A test skill.",
      version: "1.0",
      keywords: ["pdf"],
    });
  });

  it("carries an explicit skillset source path verbatim (#1155)", () => {
    const out = buildMarketplaceJson(
      [skill({ name: "research-bundle", source: "./skillsets/research-bundle", keywords: ["research"] })],
      CFG,
    );
    const parsed = JSON.parse(out);
    expect(parsed.plugins[0]).toEqual({
      name: "research-bundle",
      source: "./skillsets/research-bundle",
      description: "A test skill.",
      version: "1.0",
      keywords: ["research"],
    });
  });

  it("mixes per-skill and skillset entries, sorted by name (#1155)", () => {
    const out = buildMarketplaceJson(
      [
        skill({ name: "pdf-extract", source: "./pdf-extract" }),
        skill({ name: "research-bundle", source: "./skillsets/research-bundle" }),
        skill({ name: "alpha", source: "./alpha" }),
      ],
      CFG,
    );
    const parsed = JSON.parse(out);
    expect(parsed.plugins.map((p: { name: string; source: string }) => [p.name, p.source])).toEqual([
      ["alpha", "./alpha"],
      ["pdf-extract", "./pdf-extract"],
      ["research-bundle", "./skillsets/research-bundle"],
    ]);
  });

  it("sorts plugins by name regardless of input order (determinism)", () => {
    const a = buildMarketplaceJson(
      [skill({ name: "zebra" }), skill({ name: "alpha" }), skill({ name: "mike" })],
      CFG,
    );
    const b = buildMarketplaceJson(
      [skill({ name: "mike" }), skill({ name: "zebra" }), skill({ name: "alpha" })],
      CFG,
    );
    expect(a).toBe(b); // same set, any order -> identical bytes
    const names = JSON.parse(a).plugins.map((p: { name: string }) => p.name);
    expect(names).toEqual(["alpha", "mike", "zebra"]);
  });

  it("omits keywords for a tag-less skill but includes them when present", () => {
    const without = JSON.parse(buildMarketplaceJson([skill({ keywords: [] })], CFG));
    expect(without.plugins[0]).not.toHaveProperty("keywords");

    const withTags = JSON.parse(
      buildMarketplaceJson([skill({ keywords: ["a", "b"] })], CFG),
    );
    expect(withTags.plugins[0].keywords).toEqual(["a", "b"]);
  });

  it("handles an empty catalogue", () => {
    const parsed = JSON.parse(buildMarketplaceJson([], CFG));
    expect(parsed.plugins).toEqual([]);
    expect(parsed.name).toBe("ornn-skills");
  });

  it("escapes special characters in description without corrupting JSON", () => {
    const weird = 'Quote " backslash \\ newline \n tab \t end';
    const parsed = JSON.parse(
      buildMarketplaceJson([skill({ description: weird })], CFG),
    );
    expect(parsed.plugins[0].description).toBe(weird);
  });

  it("ends with a trailing newline (git-friendly)", () => {
    expect(buildMarketplaceJson([skill()], CFG).endsWith("}\n")).toBe(true);
  });

  it("does not mutate the caller's keywords array", () => {
    const tags = ["x"];
    const s = skill({ keywords: tags });
    buildMarketplaceJson([s], CFG);
    expect(tags).toEqual(["x"]);
  });
});

describe("buildPluginJson", () => {
  it("renders a one-skill plugin manifest pinned to the skill version", () => {
    const parsed = JSON.parse(
      buildPluginJson(skill({ name: "pdf-extract", version: "2.3" })),
    );
    expect(parsed).toEqual({
      name: "pdf-extract",
      version: "2.3",
      description: "A test skill.",
    });
  });

  it("is deterministic and trailing-newline terminated", () => {
    const a = buildPluginJson(skill());
    const b = buildPluginJson(skill());
    expect(a).toBe(b);
    expect(a.endsWith("}\n")).toBe(true);
  });

  it("escapes special characters in name/description", () => {
    const parsed = JSON.parse(
      buildPluginJson(skill({ description: 'has "quotes" and \\ slashes' })),
    );
    expect(parsed.description).toBe('has "quotes" and \\ slashes');
  });
});
