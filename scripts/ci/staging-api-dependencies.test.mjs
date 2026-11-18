import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifests, check } from "./staging-api-dependencies.mjs";

const fixture = () => ({ lockfileVersion: 1, workspaces: {
  "": { name: "root", devDependencies: { tool: "1" } },
  "ornn-api": { name: "ornn-api", version: "1", dependencies: { lib: "2" } },
  "ornn-web": { name: "ornn-web", dependencies: { web: "3" } },
}, overrides: { lib: "2" } });

function withTree(run) {
  const lock = fixture(), root = mkdtempSync(join(tmpdir(), "ornn-lock-"));
  const write = (path, data) => {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "package.json"), JSON.stringify(data));
  };
  for (const [path, data] of manifests(lock)) write(path, data);
  try { run(lock, root, write); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("keeps real sibling dependency graphs and root overrides", () => {
  const result = manifests(fixture());
  expect(result.get("ornn-web").dependencies).toEqual({ web: "3" });
  expect(result.get("").overrides).toEqual({ lib: "2" });
  expect(result.get("").workspaces).toEqual(["ornn-api", "ornn-web"]);
});
test("app version and scripts do not change dependency inputs", () => withTree((lock, root, write) => {
  write("ornn-api", { ...lock.workspaces["ornn-api"], version: "9", scripts: { start: "bun src/index.ts" } });
  expect(() => check(lock, root)).not.toThrow();
}));
test("dependency drift fails closed", () => withTree((lock, root, write) => {
  write("ornn-api", { ...lock.workspaces["ornn-api"], dependencies: { lib: "4" } });
  expect(() => check(lock, root)).toThrow("Dependency declaration differs");
}));
test("override drift fails closed", () => withTree((lock, root, write) => {
  write("", { ...manifests(lock).get(""), overrides: { lib: "4" } });
  expect(() => check(lock, root)).toThrow("Dependency declaration differs");
}));
test("workspace membership drift fails closed", () => withTree((lock, root, write) => {
  write("", { ...manifests(lock).get(""), workspaces: ["ornn-api"] });
  expect(() => check(lock, root)).toThrow("Workspace membership differs");
}));
test("unknown lockfile format and escaping workspace paths are rejected", () => {
  expect(() => manifests({ ...fixture(), lockfileVersion: 2 })).toThrow();
  const lock = fixture(); lock.workspaces["../outside"] = { name: "outside" };
  expect(() => manifests(lock)).toThrow("Unsafe workspace path");
});
