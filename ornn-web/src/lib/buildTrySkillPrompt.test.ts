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

  test("public skill — only renders the anonymous curl path (no token, no NyxID CLI)", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
      // Default is `isPrivate: false`; pass it explicitly here so the
      // intent of this test is obvious to a future reader.
      isPrivate: false,
    });
    // The skill is public — no auth instructions should appear.
    expect(out).not.toContain("nyxid proxy request");
    expect(out).not.toContain("Authorization: Bearer");
    expect(out).not.toContain("$TOKEN");
    expect(out).not.toContain("Option A");
    expect(out).not.toContain("Option B");
    // The anonymous curl line still uses the dynamic origin.
    expect(out).toContain(`curl "${ORIGIN}/api/v1/skills/${GUID}/json"`);
    expect(out).toContain("public");
    // Should NOT reference MCP tools
    expect(out).not.toContain("ornn__");
    expect(out).not.toContain("nyxid__nyx__");
  });

  test("private skill — renders NyxID CLI + bearer-token paths and explains anonymous won't work", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
      isPrivate: true,
    });
    expect(out).toContain(`nyxid proxy request ornn-api /api/v1/skills/${GUID}/json`);
    expect(out).toContain(`Authorization: Bearer $TOKEN`);
    expect(out).toContain(`${ORIGIN}/api/v1/skills/${GUID}/json`);
    expect(out).toMatch(/Anonymous fetch is not an option/);
    // Should NOT reference the deprecated `ornn` slug
    expect(out).not.toMatch(/nyxid proxy request ornn[\s/]/);
  });

  test("default (no isPrivate) treats the skill as public", () => {
    const out = buildTrySkillPrompt({
      guid: GUID,
      name: "s",
      description: "d",
      metadata: {},
      ornnOrigin: ORIGIN,
    });
    expect(out).not.toContain("Authorization: Bearer");
    expect(out).toContain(`curl "${ORIGIN}/api/v1/skills/${GUID}/json"`);
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
});
