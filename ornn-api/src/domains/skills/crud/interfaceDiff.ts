/**
 * Interface-diff for skill versions.
 *
 * A "breaking" change is anything the caller has to adapt to. We inspect only
 * the fields that a consuming agent or runner actually binds to:
 *   - category
 *   - outputType
 *   - declared runtimes (by name)
 *   - required runtime dependencies (by library name only — version bumps
 *     inside a library are ignored, they don't break the skill surface)
 *   - declared env var names (description text is metadata, not breaking)
 *   - tool names
 *
 * Description, tags, SKILL.md body, and dependency version bumps are
 * deliberately NOT considered breaking.
 *
 * @module domains/skills/crud/interfaceDiff
 */

import type { SkillMetadata } from "../../../shared/types/index";

export interface InterfaceChange {
  field: string;
  kind: "added" | "removed" | "changed";
  detail: string;
}

type RuntimeEntry = NonNullable<SkillMetadata["runtimes"]>[number];
type ToolEntry = NonNullable<SkillMetadata["tools"]>[number];

export function diffSkillInterface(prev: SkillMetadata, next: SkillMetadata): InterfaceChange[] {
  const changes: InterfaceChange[] = [];

  // category
  if (prev.category !== next.category) {
    changes.push({
      field: "category",
      kind: "changed",
      detail: `${prev.category} -> ${next.category}`,
    });
  }

  // outputType
  const prevOut = prev.outputType;
  const nextOut = next.outputType;
  if (prevOut !== nextOut) {
    if (prevOut === undefined) {
      changes.push({ field: "outputType", kind: "added", detail: String(nextOut) });
    } else if (nextOut === undefined) {
      changes.push({ field: "outputType", kind: "removed", detail: String(prevOut) });
    } else {
      changes.push({ field: "outputType", kind: "changed", detail: `${prevOut} -> ${nextOut}` });
    }
  }

  // runtimes — match by runtime name
  const prevRuntimes = indexByKey(prev.runtimes, (r) => r.runtime);
  const nextRuntimes = indexByKey(next.runtimes, (r) => r.runtime);

  for (const [name, _] of prevRuntimes) {
    if (!nextRuntimes.has(name)) {
      changes.push({ field: "runtimes", kind: "removed", detail: name });
    }
  }
  for (const [name, _] of nextRuntimes) {
    if (!prevRuntimes.has(name)) {
      changes.push({ field: "runtimes", kind: "added", detail: name });
    }
  }

  // For runtimes that exist in both, diff their dependency libraries and env vars.
  for (const [name, nextEntry] of nextRuntimes) {
    const prevEntry = prevRuntimes.get(name);
    if (!prevEntry) continue;
    changes.push(...diffRuntimeInternals(name, prevEntry, nextEntry));
  }

  // tools — match by tool name
  const prevTools = new Set((prev.tools ?? []).map((t: ToolEntry) => t.tool));
  const nextTools = new Set((next.tools ?? []).map((t: ToolEntry) => t.tool));
  for (const t of prevTools) {
    if (!nextTools.has(t)) changes.push({ field: "tools", kind: "removed", detail: t });
  }
  for (const t of nextTools) {
    if (!prevTools.has(t)) changes.push({ field: "tools", kind: "added", detail: t });
  }

  return changes;
}

function diffRuntimeInternals(runtimeName: string, prev: RuntimeEntry, next: RuntimeEntry): InterfaceChange[] {
  const changes: InterfaceChange[] = [];

  // Dependencies: identity = library name (version bumps intentionally ignored).
  const prevLibs = new Set((prev.dependencies ?? []).map((d) => d.library));
  const nextLibs = new Set((next.dependencies ?? []).map((d) => d.library));
  for (const lib of prevLibs) {
    if (!nextLibs.has(lib)) {
      changes.push({
        field: `runtimes.${runtimeName}.dependencies`,
        kind: "removed",
        detail: lib,
      });
    }
  }
  for (const lib of nextLibs) {
    if (!prevLibs.has(lib)) {
      changes.push({
        field: `runtimes.${runtimeName}.dependencies`,
        kind: "added",
        detail: lib,
      });
    }
  }

  // Env vars: identity = var name (description text is not binding).
  const prevEnvs = new Set((prev.envs ?? []).map((e) => e.var));
  const nextEnvs = new Set((next.envs ?? []).map((e) => e.var));
  for (const v of prevEnvs) {
    if (!nextEnvs.has(v)) {
      changes.push({ field: `runtimes.${runtimeName}.envs`, kind: "removed", detail: v });
    }
  }
  for (const v of nextEnvs) {
    if (!prevEnvs.has(v)) {
      changes.push({ field: `runtimes.${runtimeName}.envs`, kind: "added", detail: v });
    }
  }

  return changes;
}

function indexByKey<T>(list: T[] | undefined, key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of list ?? []) {
    m.set(key(item), item);
  }
  return m;
}
