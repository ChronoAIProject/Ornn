/**
 * Pure skill dependency-closure resolver (#968).
 *
 * Given a set of root dependency refs and a `loadVersion(ref)` loader,
 * walks the dependency graph and returns the full transitive closure in
 * topological order (every dependency appears before the dependents that
 * pin it). The module is DELIBERATELY pure — it imports no database, no
 * storage, no Hono. The only side-effect surface is the injected
 * `loadVersion`, which the caller wires to whatever source it has
 * (Mongo at publish time, an authorized read at request time, an
 * in-memory map in tests). That keeps the graph algorithm trivially
 * unit-testable and reusable across every closure-shaped feature.
 *
 * Algorithm: a three-color (WHITE / GRAY / BLACK) depth-first search.
 *   - WHITE  — not yet visited.
 *   - GRAY   — on the current DFS stack (being explored).
 *   - BLACK  — fully explored; its subtree is closed.
 * A GRAY node reached again is a back-edge ⇒ a cycle. Nodes are emitted
 * in DFS postorder (a node is appended only after all of its children
 * have been fully explored), which is itself a valid topological order
 * with dependencies before dependents — no reversal needed.
 *
 * Three failure modes map to the three lowercase error codes the
 * contract mandates (see docs/ERRORS.md §11-13):
 *   - cycle                     → `dependency_cycle`           (409)
 *   - same skill, two versions  → `dependency_conflict`        (409)
 *   - ref the loader can't find → `skill_dependency_not_found` (404)
 *
 * @module domains/skills/closure/resolver
 */

import { AppError } from "../../../shared/types/index";
import { createLogger } from "../../../shared/logger";

const logger = createLogger("closureResolver");

/**
 * A concrete, loaded skill version. The loader resolves a (possibly
 * dist-tagged) ref into this shape; `ref` is re-canonicalized to
 * `<name>@<version>` so two equivalent refs (e.g. `pdf@latest` and
 * `pdf@1.0`) collapse onto one graph node.
 */
export interface ResolvedVersion {
  /** Canonical `<name>@<version>` for this loaded node. */
  ref: string;
  /** Skill name. Used as the conflict key — one name may appear once. */
  name: string;
  /** Concrete `<major>.<minor>` version. */
  version: string;
  /** Stable skill GUID, when known. Surfaced in the closure output. */
  guid?: string;
  /** Package hash for the resolved version, when known. */
  skillHash?: string;
  /** Direct dependency refs declared by this version. */
  dependsOn: string[];
}

/**
 * Loader contract. Resolves a dependency ref (`<name-or-guid>@<version>`
 * or `<name>@<dist-tag>`) to a {@link ResolvedVersion}, or `null` when no
 * such version exists / is visible. Async so DB / network loaders fit.
 */
export type LoadVersion = (ref: string) => Promise<ResolvedVersion | null>;

/** One node in the resolved closure, carrying its BFS-style depth. */
export interface ClosureNode {
  ref: string;
  name: string;
  version: string;
  guid?: string;
  skillHash?: string;
  /** 0 for roots; max distance from any root for deeper deps. */
  depth: number;
}

export interface ResolveClosureOptions {
  loadVersion: LoadVersion;
}

export interface ResolveClosureSettings {
  /**
   * Hard ceiling on the number of distinct nodes in the closure. Guards
   * against a pathological graph blowing up memory / time. Default 500.
   */
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 500;

enum Color {
  WHITE,
  GRAY,
  BLACK,
}

/**
 * Resolve the full transitive dependency closure of `roots`.
 *
 * Returns nodes in DFS postorder (dependencies first), deduplicated by
 * canonical ref. Each node carries the MAXIMUM depth at which it was
 * reached, so a shared diamond node reports the deeper of its paths.
 *
 * Throws:
 *   - `dependency_cycle` (409) on a back-edge.
 *   - `dependency_conflict` (409) when one skill name resolves to two
 *     distinct versions anywhere in the graph.
 *   - `skill_dependency_not_found` (404) when `loadVersion` returns null
 *     for any ref reached (root or transitive).
 */
export async function resolveClosure(
  roots: string[],
  options: ResolveClosureOptions,
  settings: ResolveClosureSettings = {},
): Promise<ClosureNode[]> {
  const { loadVersion } = options;
  const maxNodes = settings.maxNodes ?? DEFAULT_MAX_NODES;

  // Canonical-ref → resolved version (graph node cache). One async load
  // per distinct ref; later refs to the same node are served from here.
  const loaded = new Map<string, ResolvedVersion>();
  const color = new Map<string, Color>();
  // name → version, to detect a same-skill / different-version conflict.
  const pinnedVersion = new Map<string, string>();
  // Canonical ref → max depth seen.
  const depthOf = new Map<string, number>();
  // Postorder accumulation (canonical refs).
  const postorder: string[] = [];

  /**
   * Load a ref into a canonical {@link ResolvedVersion}, caching by both
   * the requested ref AND the canonical ref so a dist-tag and its
   * concrete version share one node. Throws `skill_dependency_not_found`
   * when the loader can't resolve it.
   */
  async function resolve(ref: string): Promise<ResolvedVersion> {
    const cached = loaded.get(ref);
    if (cached) return cached;
    const node = await loadVersion(ref);
    if (!node) {
      logger.error({ ref }, "Dependency ref could not be resolved");
      throw AppError.notFound(
        "skill_dependency_not_found",
        `Skill dependency '${ref}' was not found or is not accessible.`,
      );
    }
    // Cache under both the requested ref and the canonical ref so
    // distinct aliases (e.g. `@beta` and `@1.0`) collapse onto one node.
    loaded.set(ref, node);
    loaded.set(node.ref, node);
    return node;
  }

  async function visit(ref: string, depth: number): Promise<string> {
    const node = await resolve(ref);
    const canonical = node.ref;

    // Conflict check: a single skill name may resolve to exactly one
    // version across the whole closure. Two different versions of the
    // same skill cannot be installed side by side.
    const priorVersion = pinnedVersion.get(node.name);
    if (priorVersion !== undefined && priorVersion !== node.version) {
      logger.error(
        { name: node.name, versions: [priorVersion, node.version] },
        "Conflicting versions of the same skill in dependency closure",
      );
      throw AppError.conflict(
        "dependency_conflict",
        `Dependency '${node.name}' is pinned to conflicting versions ` +
          `'${priorVersion}' and '${node.version}' within the same closure.`,
      );
    }
    pinnedVersion.set(node.name, node.version);

    // Track the deepest reach so diamond-shared nodes sort correctly.
    const prevDepth = depthOf.get(canonical);
    depthOf.set(canonical, prevDepth === undefined ? depth : Math.max(prevDepth, depth));

    const state = color.get(canonical) ?? Color.WHITE;
    if (state === Color.GRAY) {
      logger.error({ ref: canonical }, "Cycle detected in dependency closure");
      throw AppError.conflict(
        "dependency_cycle",
        `A dependency cycle was detected involving '${canonical}'.`,
      );
    }
    if (state === Color.BLACK) {
      // Already fully explored — nothing more to do (dedup).
      return canonical;
    }

    color.set(canonical, Color.GRAY);
    for (const childRef of node.dependsOn) {
      await visit(childRef, depth + 1);
      if (loaded.size > maxNodes) {
        throw AppError.conflict(
          "dependency_conflict",
          `Dependency closure exceeded the maximum of ${maxNodes} nodes.`,
        );
      }
    }
    color.set(canonical, Color.BLACK);
    postorder.push(canonical);
    return canonical;
  }

  for (const root of roots) {
    await visit(root, 0);
  }

  // Postorder already places dependencies before dependents (a node is
  // pushed only after all its children). That IS the deps-first topo
  // order — no reversal needed. Dedup is implicit: each canonical ref is
  // pushed exactly once (guarded by the BLACK check).
  const result: ClosureNode[] = postorder.map((canonical) => {
    const node = loaded.get(canonical)!;
    const out: ClosureNode = {
      ref: node.ref,
      name: node.name,
      version: node.version,
      depth: depthOf.get(canonical) ?? 0,
    };
    if (node.guid !== undefined) out.guid = node.guid;
    if (node.skillHash !== undefined) out.skillHash = node.skillHash;
    return out;
  });

  logger.info(
    { roots, nodeCount: result.length },
    "Dependency closure resolved",
  );
  return result;
}
