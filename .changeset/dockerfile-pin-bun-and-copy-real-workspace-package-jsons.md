---
"ornn-api": patch
"ornn-web": patch
---

fix(infra): pin bun in both Dockerfiles + copy real sibling workspace package.jsons instead of stubbing.

Caught while redeploying locally: a fresh `--no-cache` build of `ornn-web` failed at typecheck with `Cannot find module 'zustand'`. `bun install` ran successfully but skipped hoisting some transitive deps because the stubbed `ornn-api` / `ornn-sdk` `package.json` files (`{"name":"...","version":"...","private":true}` — no `dependencies` block) misled bun's hoister. The host's pinned bun (`1.3.8`) hoisted those deps fine; the floating `oven/bun:latest` had already moved to `1.3.13`, which behaves differently here.

Two-line repro of the hoister mismatch:

```
COPY ornn-api/package.json ornn-api/   # real, with deps
COPY ornn-sdk/package.json ornn-sdk/   # real, with deps
```

…replaces the previous `RUN mkdir … && echo '{}' > …/package.json` stubs that used to drift away from `bun.lock`.

Both Dockerfiles now:

- **Pin to `oven/bun:1.3.13`** (was `oven/bun:latest`). Stops surprise-upgrades from breaking the build.
- **Copy the real workspace `package.json` files** for every sibling the lockfile references, instead of stubbing them. Keeps `bun.lock` + the on-disk workspace graph consistent.

No runtime behaviour changes — pure build-pipeline reliability.
