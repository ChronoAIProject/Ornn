import { describe, expect, test } from "bun:test";
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
    expect(out).toContain("# Try Ornn skill: my-skill");
    expect(out).toContain("> Does useful things.");
    expect(out).toContain(`GUID: ${GUID}`);
    expect(out).toContain(`Ornn URL: ${ORIGIN}/skills/${GUID}`);
    expect(out).toContain("~/.claude/skills/my-skill/");
    expect(out).toContain(`nyxid proxy request ornn /api/skills/${GUID}/json`);
  });

  test("prerequisites section embeds actionable CLI check commands", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).toContain("nyxid whoami");
    expect(out).toContain("nyxid proxy discover");
    // Should NOT reference MCP tools
    expect(out).not.toContain("ornn__");
    expect(out).not.toContain("nyxid__nyx__");
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
  });
});
