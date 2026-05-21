---
"ornn-api": patch
"ornn-web": patch
"@chronoai/ornn-sdk": patch
---

Enable stricter TS flags across all three packages (#450).

#450 part 1 (`noImplicitOverride`) landed in #638. This PR closes the bulk of parts 2 + 3:

- **All 3 packages now have `noUncheckedIndexedAccess: true`.** Array/object bracket access now widens to `T | undefined`, forcing explicit handling. Fix patterns by category:
  - **Length-guarded accesses** — `if (xs.length > 0)` followed by `xs[len-1]`, `findIndex` followed by `arr[idx]`. Marked `!` with a comment naming the guard. Most cases.
  - **Regex capture groups** — every `match[1]` / `match[2]` followed by a `match` check. Marked `!` with the regex-shape note.
  - **Defensive `if (!entry)` skips** — `zip.files[path]` where `path` came from `Object.keys(zip.files)`. Switched from `if (entry.dir)` to `if (!entry || entry.dir)` so a future zip-lib refactor that breaks the round-trip drops the file rather than crashes.
  - **Two non-mechanical fixes**: GenerateSkillModal.STEP_MESSAGES switched from `Record<string, string>` to `as const` (compile-time keys now return `string`, not `string | undefined`); SkillDetailPage.latestVersion now passed as `latestVersion ?? ""`.

- **SDK only: `exactOptionalPropertyTypes: true`.** The SDK had 4 errors total; all 4 were `{ requestId: undefined }`-style fields that violated the stricter `{ requestId?: string }` contract. Fixed with conditional spread (only set the key when the upstream actually has the value).

### Deferred

`exactOptionalPropertyTypes` on ornn-api (~77 errors) and ornn-web (~134 errors) — tracked as #657. These need per-site decisions (conditional spread vs widened field type vs constructor refactor), not mechanical fixes, so they don't fit a single-session PR.

### Net

- 3 tsconfig.json files updated.
- ornn-api: 26 files touched (68 fix sites + 1 tsconfig).
- ornn-web: 22 files touched (57 fix sites + 1 tsconfig).
- sdk/typescript: 3 files touched (4 fix sites + 1 tsconfig).
- 798 backend + 110 web + 17 sdk tests all still pass.
