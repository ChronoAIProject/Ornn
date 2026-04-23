import { describe, expect, test } from "bun:test";
import type { SkillMetadata } from "../../../shared/types/index";
import { diffSkillInterface } from "./interfaceDiff";

function meta(overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return { category: "plain", ...overrides };
}

describe("diffSkillInterface", () => {
  test("no changes → empty diff", () => {
    const prev = meta({ category: "runtime-based", outputType: "text", runtimes: [{ runtime: "node" }] });
    const next = meta({ category: "runtime-based", outputType: "text", runtimes: [{ runtime: "node" }] });
    expect(diffSkillInterface(prev, next)).toEqual([]);
  });

  test("category change is breaking", () => {
    const prev = meta({ category: "plain" });
    const next = meta({ category: "tool-based", tools: [{ tool: "bash", type: "mcp" }] });
    const changes = diffSkillInterface(prev, next);
    const fields = changes.map((c) => c.field);
    expect(fields).toContain("category");
  });

  test("adding a tool is breaking", () => {
    const prev = meta({ category: "tool-based", tools: [{ tool: "bash", type: "mcp" }] });
    const next = meta({
      category: "tool-based",
      tools: [
        { tool: "bash", type: "mcp" },
        { tool: "edit", type: "mcp" },
      ],
    });
    const changes = diffSkillInterface(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("tools");
    expect(changes[0].kind).toBe("added");
    expect(changes[0].detail).toContain("edit");
  });

  test("removing a tool is breaking", () => {
    const prev = meta({
      category: "tool-based",
      tools: [
        { tool: "bash", type: "mcp" },
        { tool: "edit", type: "mcp" },
      ],
    });
    const next = meta({ category: "tool-based", tools: [{ tool: "bash", type: "mcp" }] });
    const changes = diffSkillInterface(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("removed");
    expect(changes[0].detail).toContain("edit");
  });

  test("adding a runtime is breaking", () => {
    const prev = meta({ category: "runtime-based", outputType: "text", runtimes: [{ runtime: "node" }] });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node" }, { runtime: "python" }],
    });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field === "runtimes" && c.kind === "added" && c.detail.includes("python"))).toBe(true);
  });

  test("removing a runtime is breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node" }, { runtime: "python" }],
    });
    const next = meta({ category: "runtime-based", outputType: "text", runtimes: [{ runtime: "node" }] });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field === "runtimes" && c.kind === "removed" && c.detail.includes("python"))).toBe(true);
  });

  test("adding a dependency library is breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", dependencies: [{ library: "axios", version: "*" }] }],
    });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [
        {
          runtime: "node",
          dependencies: [
            { library: "axios", version: "*" },
            { library: "zod", version: "*" },
          ],
        },
      ],
    });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field.includes("dependencies") && c.kind === "added" && c.detail.includes("zod"))).toBe(true);
  });

  test("removing a dependency library is breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [
        {
          runtime: "node",
          dependencies: [
            { library: "axios", version: "*" },
            { library: "zod", version: "*" },
          ],
        },
      ],
    });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", dependencies: [{ library: "axios", version: "*" }] }],
    });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field.includes("dependencies") && c.kind === "removed" && c.detail.includes("zod"))).toBe(true);
  });

  test("dependency version-only bump is NOT breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", dependencies: [{ library: "axios", version: "1.0.0" }] }],
    });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", dependencies: [{ library: "axios", version: "2.0.0" }] }],
    });
    expect(diffSkillInterface(prev, next)).toEqual([]);
  });

  test("adding an env var is breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", envs: [{ var: "API_KEY", description: "" }] }],
    });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [
        {
          runtime: "node",
          envs: [
            { var: "API_KEY", description: "" },
            { var: "DB_URL", description: "" },
          ],
        },
      ],
    });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field.includes("envs") && c.kind === "added" && c.detail.includes("DB_URL"))).toBe(true);
  });

  test("removing an env var is breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [
        {
          runtime: "node",
          envs: [
            { var: "API_KEY", description: "" },
            { var: "DB_URL", description: "" },
          ],
        },
      ],
    });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", envs: [{ var: "API_KEY", description: "" }] }],
    });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field.includes("envs") && c.kind === "removed" && c.detail.includes("DB_URL"))).toBe(true);
  });

  test("outputType change is breaking", () => {
    const prev = meta({ category: "runtime-based", outputType: "text", runtimes: [{ runtime: "node" }] });
    const next = meta({ category: "runtime-based", outputType: "file", runtimes: [{ runtime: "node" }] });
    const changes = diffSkillInterface(prev, next);
    expect(changes.some((c) => c.field === "outputType" && c.kind === "changed")).toBe(true);
  });

  test("tag changes are NOT breaking", () => {
    const prev = meta({ category: "plain", tags: ["old"] });
    const next = meta({ category: "plain", tags: ["new", "tags"] });
    expect(diffSkillInterface(prev, next)).toEqual([]);
  });

  test("env var description-only change is NOT breaking", () => {
    const prev = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", envs: [{ var: "API_KEY", description: "old desc" }] }],
    });
    const next = meta({
      category: "runtime-based",
      outputType: "text",
      runtimes: [{ runtime: "node", envs: [{ var: "API_KEY", description: "new desc" }] }],
    });
    expect(diffSkillInterface(prev, next)).toEqual([]);
  });
});
