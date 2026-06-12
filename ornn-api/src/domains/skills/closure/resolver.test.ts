/**
 * Pure dependency-closure resolver tests (#968).
 *
 * The resolver is deliberately DB-free: it takes a `loadVersion(ref)`
 * loader and walks the dependency graph with a three-color DFS. These
 * tests exercise the five contract cases against an in-memory graph:
 *
 *   - linear chain      → topo order, deps before dependents
 *   - diamond           → shared node deduped, still correctly ordered
 *   - cycle             → `dependency_cycle` (409)
 *   - version conflict  → `dependency_conflict` (409) when the same skill
 *                         is pinned to two different versions in one graph
 *   - missing dep       → `skill_dependency_not_found` (404)
 *
 * @module domains/skills/closure/resolver.test
 */

import { describe, expect, it } from "bun:test";
import { resolveClosure, type ResolvedVersion, type LoadVersion } from "./resolver";
import { AppError } from "../../../shared/types/index";

/**
 * Build a `loadVersion` over a static graph keyed by the canonical
 * `<name>@<version>` ref. Each node declares the names+versions of its
 * direct deps. `loadVersion` returns null for any ref not in the graph
 * (the "missing dependency" signal). Dist-tag refs are resolved through
 * an optional alias map so tests can exercise tag → version pinning.
 */
function makeLoader(
  graph: Record<string, { name: string; version: string; deps: string[] }>,
  aliases: Record<string, string> = {},
): LoadVersion {
  return async (ref: string): Promise<ResolvedVersion | null> => {
    const resolvedRef = aliases[ref] ?? ref;
    const node = graph[resolvedRef];
    if (!node) return null;
    return {
      ref: `${node.name}@${node.version}`,
      name: node.name,
      version: node.version,
      dependsOn: node.deps,
    };
  };
}

async function catchErr(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error("expected the call to throw");
}

describe("resolveClosure (#968)", () => {
  it("resolves a linear chain in deps-before-dependents order", async () => {
    // a → b → c
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: ["b@1.0"] },
      "b@1.0": { name: "b", version: "1.0", deps: ["c@1.0"] },
      "c@1.0": { name: "c", version: "1.0", deps: [] },
    });
    const result = await resolveClosure(["a@1.0"], { loadVersion });
    const names = result.map((n) => n.name);
    // c before b before a (reverse-postorder topological sort).
    expect(names.indexOf("c")).toBeLessThan(names.indexOf("b"));
    expect(names.indexOf("b")).toBeLessThan(names.indexOf("a"));
    expect(names).toHaveLength(3);
    // depth: roots at 0, deeper deps higher.
    const byName = Object.fromEntries(result.map((n) => [n.name, n.depth]));
    expect(byName.a).toBe(0);
    expect(byName.b).toBe(1);
    expect(byName.c).toBe(2);
  });

  it("dedupes a shared node in a diamond graph", async () => {
    // a → b → d ; a → c → d. d appears once, before b and c.
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: ["b@1.0", "c@1.0"] },
      "b@1.0": { name: "b", version: "1.0", deps: ["d@1.0"] },
      "c@1.0": { name: "c", version: "1.0", deps: ["d@1.0"] },
      "d@1.0": { name: "d", version: "1.0", deps: [] },
    });
    const result = await resolveClosure(["a@1.0"], { loadVersion });
    const names = result.map((n) => n.name);
    expect(names).toHaveLength(4);
    expect(names.filter((n) => n === "d")).toHaveLength(1);
    expect(names.indexOf("d")).toBeLessThan(names.indexOf("b"));
    expect(names.indexOf("d")).toBeLessThan(names.indexOf("c"));
    expect(names.indexOf("b")).toBeLessThan(names.indexOf("a"));
    expect(names.indexOf("c")).toBeLessThan(names.indexOf("a"));
  });

  it("throws dependency_cycle (409) on a back-edge", async () => {
    // a → b → a
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: ["b@1.0"] },
      "b@1.0": { name: "b", version: "1.0", deps: ["a@1.0"] },
    });
    const err = await catchErr(() => resolveClosure(["a@1.0"], { loadVersion }));
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("dependency_cycle");
  });

  it("throws dependency_cycle on a self-loop reached via GUID ref", async () => {
    // a depends on itself — the frontmatter self-ref guard can't catch
    // a GUID-form self-ref, so the resolver's cycle check must.
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: ["a@1.0"] },
    });
    const err = await catchErr(() => resolveClosure(["a@1.0"], { loadVersion }));
    expect(err.code).toBe("dependency_cycle");
  });

  it("throws dependency_conflict (409) when one skill is pinned to two versions", async () => {
    // a → b@1.0 ; a → c → b@2.0. Same skill `b`, two versions.
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: ["b@1.0", "c@1.0"] },
      "b@1.0": { name: "b", version: "1.0", deps: [] },
      "b@2.0": { name: "b", version: "2.0", deps: [] },
      "c@1.0": { name: "c", version: "1.0", deps: ["b@2.0"] },
    });
    const err = await catchErr(() => resolveClosure(["a@1.0"], { loadVersion }));
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("dependency_conflict");
  });

  it("throws skill_dependency_not_found (404) when a dep cannot be loaded", async () => {
    // a → missing@1.0 (not in graph).
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: ["missing@1.0"] },
    });
    const err = await catchErr(() => resolveClosure(["a@1.0"], { loadVersion }));
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("skill_dependency_not_found");
  });

  it("throws skill_dependency_not_found when a root ref cannot be loaded", async () => {
    const loadVersion = makeLoader({});
    const err = await catchErr(() => resolveClosure(["ghost@1.0"], { loadVersion }));
    expect(err.code).toBe("skill_dependency_not_found");
  });

  it("resolves a dist-tag dependency to its concrete version", async () => {
    // a → b@beta, where beta aliases to b@1.0.
    const loadVersion = makeLoader(
      {
        "a@1.0": { name: "a", version: "1.0", deps: ["b@beta"] },
        "b@1.0": { name: "b", version: "1.0", deps: [] },
      },
      { "b@beta": "b@1.0" },
    );
    const result = await resolveClosure(["a@1.0"], { loadVersion });
    const b = result.find((n) => n.name === "b");
    expect(b?.version).toBe("1.0");
  });

  it("returns an empty closure for a dependency-free root", async () => {
    const loadVersion = makeLoader({
      "a@1.0": { name: "a", version: "1.0", deps: [] },
    });
    const result = await resolveClosure(["a@1.0"], { loadVersion });
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("a");
  });
});
