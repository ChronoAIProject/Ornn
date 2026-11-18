// Bun's lockfile records the actual workspace dependency graph. Reconstruct it,
// rather than empty workspace stubs, so installation needs no app-only metadata.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const rootFields = ["overrides", "resolutions", "trustedDependencies"];
const canonical = (value) => JSON.stringify(value, (_, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export function manifests(lock) {
  if (lock.lockfileVersion !== 1 || !lock.workspaces?.[""] || !lock.workspaces["ornn-api"])
    throw new Error("Unsupported API lockfile workspace graph");
  const result = new Map();
  for (const [path, workspace] of Object.entries(lock.workspaces)) {
    if (path !== "" && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path))
      throw new Error("Unsafe workspace path");
    const manifest = { ...workspace };
    if (path === "") {
      manifest.private = true;
      manifest.workspaces = Object.keys(lock.workspaces).filter(Boolean).sort();
      for (const field of rootFields) if (lock[field] !== undefined) manifest[field] = lock[field];
    }
    result.set(path, manifest);
  }
  return result;
}

export function check(lock, directory) {
  const expected = manifests(lock);
  for (const [path, manifest] of expected) {
    const actual = JSON.parse(readFileSync(resolve(directory, path, "package.json"), "utf8"));
    if (actual.name !== manifest.name) throw new Error(`Workspace name differs: ${path}`);
    for (const field of [...fields, ...(path === "" ? rootFields : [])]) {
      if (canonical(actual[field] ?? {}) !== canonical(manifest[field] ?? {}))
        throw new Error(`Dependency declaration differs from frozen lockfile: ${path}/${field}`);
    }
    if (path === "" && canonical([...actual.workspaces].sort()) !== canonical(manifest.workspaces))
      throw new Error("Workspace membership differs from frozen lockfile");
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const verify = args[0] === "--check";
  if (verify) args.shift();
  if (args.length !== 2) throw new Error("Expected lockfile and output/workspace directory");
  const lock = Bun.JSONC.parse(readFileSync(args[0], "utf8"));
  if (verify) check(lock, args[1]);
  else for (const [path, manifest] of manifests(lock)) {
    const directory = resolve(args[1], path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, "package.json"), canonical(manifest) + "\n");
  }
}
