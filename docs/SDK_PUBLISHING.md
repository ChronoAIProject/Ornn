# SDK Publishing Strategy

Current state of the TypeScript and Python SDKs on the public registries, and the path to v1 publish.

## Status (2026-05)

| Package | Registry name | Currently published? | Blocker |
|---|---|:---:|---|
| `@chronoai/ornn-sdk` | npm | **No** | `sdk/typescript/package.json` has `"private": true`. Removing the flag is the v1 step. |
| `ornn-sdk` | PyPI | **No** | Not yet uploaded; name not reserved. |

Until both ship, the SDKs are usable only from this monorepo. Consumers should pin to a specific git ref / tag and install from source — see [Pre-publish install](#pre-publish-install) below.

This matches the project's overall posture: Ornn is in **alpha (0.x)** per [`docs/API_STABILITY.md`](API_STABILITY.md), and no SDK-shape compatibility guarantees apply yet. Publishing now would bake in surface decisions that may move at v1.

## Decision

**Hold both packages for v1.0.** Publishing while the SDK contract may still shift creates an upgrade-treadmill for early adopters; the v1 release will publish both packages on the same tag.

The v1 release checklist (lives in milestone planning, not yet a doc):

1. `sdk/typescript/package.json` — drop `"private": true`, confirm `keywords`/`repository`/`license` are set (already done in [#468](https://github.com/ChronoAIProject/Ornn/pull/589)).
2. `sdk/python/pyproject.toml` — confirm `keywords`/`classifiers`/`urls` are set (already done in [#468](https://github.com/ChronoAIProject/Ornn/pull/589)).
3. Reserve `@chronoai/ornn-sdk` on npm — owner: `chronoai`.
4. Reserve `ornn-sdk` on PyPI — owner: `chronoai`.
5. Extend `.github/workflows/changeset-release.yml` to run `npm publish --access public` on the TS workspace and `twine upload` on the Python wheel when the bump PR lands on `main`.
6. Add the npm + PyPI tokens to org secrets.
7. Cut v1.0 — verify both packages resolve, smoke-test `npm install @chronoai/ornn-sdk` and `pip install ornn-sdk` against a clean machine.

## Pre-publish install

Until v1 ships, both SDKs are install-from-source:

### TypeScript

This is a Bun workspace; consumers depending on `@chronoai/ornn-sdk` from another local checkout can use `bun link`:

```bash
# From inside this monorepo
cd sdk/typescript
bun link

# From the consuming project
bun link @chronoai/ornn-sdk
```

Or pin to the monorepo via your package manager's git-subdirectory support. Most clients reach for `npm install <git-url>#<commit>`; the workspace layout means you need a builder that understands monorepo subdirs (pnpm, bun, yarn-berry).

### Python

Install editable from this monorepo:

```bash
pip install -e ./sdk/python
# or
pip install "git+https://github.com/ChronoAIProject/Ornn.git#subdirectory=sdk/python"
```

The Python form works out of the box because `pyproject.toml` is hatch-built.

## What does not change in alpha

- The SDK surface is unstable; pin to a specific commit, not `develop`.
- `OrnnError`, `OrnnClient`, the `.search()` / `.get()` / `.listVersions()` methods are the *intended* v1 surface — they may gain options but should not lose them.
- Sample code in `examples/` always tracks the SDK on `develop`, not a published release. Use those examples as the canonical reference shape.

## Open questions

1. Will the TS SDK be ESM-only or dual ESM+CJS at v1? Current source is ESM (`"type": "module"`); the publish step needs to decide whether to ship CJS too.
2. PyPI name `ornn-sdk` is unreserved. We should reserve it before someone else does, even if we hold publication. (Tracked separately.)
