import { describe, expect, test } from "vitest";
import { buildTrySkillPrompt } from "./buildTrySkillPrompt";

const ORIGIN = "https://ornn.chrono-ai.fun";
const GUID = "1234-abcd";

describe("buildTrySkillPrompt", () => {
  test("includes skill name, GUID, description, and Ornn URL", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "my-skill",
      description: "Does useful things.",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("# Install Ornn skill: my-skill");
    expect(out).toContain("> Does useful things.");
    expect(out).toContain(`GUID: ${GUID}`);
    expect(out).toContain(`Ornn URL: ${ORIGIN}/skills/${GUID}`);
  });

  test("offers per-agent install conventions including Claude Code, Codex, and Cursor", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "my-skill",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("~/.claude/skills/my-skill/");
    expect(out).toContain("~/.codex/skills/my-skill/");
    expect(out).toContain(".cursor/rules/my-skill.md");
    expect(out).toMatch(/Other agents/);
  });

  test("instructs the agent to record the install in ~/.ornn/installed-skills.json", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "my-skill",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("~/.ornn/installed-skills.json");
    expect(out).toMatch(/installedVersion/);
    expect(out).toMatch(/ornn-agent-manual/);
  });

  test("renders both NyxID CLI + bearer-token fetch paths regardless of visibility", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    // NyxID CLI option present.
    expect(out).toContain(`nyxid proxy request ornn-api /api/v1/skills/${GUID}/json`);
    // Direct HTTPS bearer option present and uses the dynamic origin.
    expect(out).toContain(`Authorization: Bearer $TOKEN`);
    expect(out).toContain(`${ORIGIN}/api/v1/skills/${GUID}/json`);
    // No anonymous-curl option — every Ornn call goes through NyxID's
    // proxy, which requires a token even for public skills.
    expect(out).not.toMatch(/Option C/);
    // Should NOT reference the deprecated `ornn` slug.
    expect(out).not.toMatch(/nyxid proxy request ornn[\s/]/);
    // Should NOT reference MCP tools.
    expect(out).not.toContain("ornn__");
    expect(out).not.toContain("nyxid__nyx__");
  });

  test("explains the NyxID-proxy auth requirement for callers without nyxid installed", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).toMatch(/NyxID identity is required even for public skills/);
    expect(out).toMatch(/install it first|nyxid login/i);
  });

  test("renders runtime-dependency list as library@version", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "py-skill",
      description: "Python skill.",
      metadata: {
        category: "runtime-based",
        runtimes: [
          {
            runtime: "python",
            dependencies: [
              { library: "requests", version: "^2.32.0" },
              { library: "pydantic", version: "2.*" },
            ],
          },
        ],
      },
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("Runtime: python");
    expect(out).toContain("Runtime deps: requests@^2.32.0, pydantic@2.*");
  });

  test("handles empty/missing metadata fields gracefully", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "plain-skill",
      description: "No runtime.",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("Category: plain");
    expect(out).toContain("Runtime: plain (no runtime)");
    expect(out).toContain("Runtime deps: none");
    expect(out).toContain("Env vars: none");
    expect(out).toContain("Required tools: none");
  });

  test("renders tool-list and runtime-env-var when present", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "mixed-skill",
      description: "Mixed.",
      metadata: {
        category: "mixed",
        runtimes: [
          {
            runtime: "node",
            envs: [
              { var: "MY_API_KEY", description: "API key" },
              { var: "MY_ENDPOINT", description: "" },
            ],
          },
        ],
        tools: [
          { tool: "bash", type: "mcp" },
          { tool: "edit", type: "mcp" },
        ],
      },
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("Env vars: MY_API_KEY, MY_ENDPOINT");
    expect(out).toContain("Required tools: bash, edit");
  });

  test("trims trailing slashes from ornnOrigin", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: `${ORIGIN}///`,
    });
    expect(out).toContain(`Ornn URL: ${ORIGIN}/skills/${GUID}`);
    expect(out).not.toContain("https://ornn.chrono-ai.fun///");
  });

  describe("version pinning (#639)", () => {
    test("pins all three fetch surfaces to ?version=<v> when version is provided", () => {
      const out = buildTrySkillPrompt({
        guid: GUID,
        name: "s",
        description: "d",
        metadata: {},
        ornnOrigin: ORIGIN,
        version: "0.2",
      });
      // Header acknowledges the pin so the user/agent sees it.
      expect(out).toContain("# Install Ornn skill: s @ 0.2");
      expect(out).toMatch(/Pinned to version `0.2`/);
      // NyxID CLI option uses --query.
      expect(out).toContain(
        `nyxid proxy request ornn-api /api/v1/skills/${GUID}/json --query version=0.2`,
      );
      // Direct HTTPS curl URL pins via ?version=.
      expect(out).toContain(`${ORIGIN}/api/v1/skills/${GUID}/json?version=0.2`);
      // Ornn URL footer also points at the same version.
      expect(out).toContain(`Ornn URL: ${ORIGIN}/skills/${GUID}?version=0.2`);
    });

    test("absent version → no pin header, no ?version=", () => {
      const out = buildTrySkillPrompt({
        guid: GUID,
        name: "s",
        description: "d",
        metadata: {},
        ornnOrigin: ORIGIN,
      });
      expect(out).not.toMatch(/Pinned to version/);
      expect(out).not.toContain("?version=");
      expect(out).not.toContain("--query version=");
    });

    test("URL-encodes the version (defensive — server only accepts <major>.<minor> but be safe)", () => {
      const out = buildTrySkillPrompt({
        guid: GUID,
        name: "s",
        description: "d",
        metadata: {},
        ornnOrigin: ORIGIN,
        version: "stable",
      });
      // Plain dist-tag passes through unchanged.
      expect(out).toContain("?version=stable");
      expect(out).toContain("# Install Ornn skill: s @ stable");
    });
  });
});
