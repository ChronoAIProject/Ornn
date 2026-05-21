---
"ornn-web": patch
---

Guided-create env-var input now enforces the 30-item cap inline (#683).

`runtime-env-var` is capped at 30 in both the frontend frontmatter schema (`shared/schemas/skillFrontmatter.ts`) and the backend Zod schema. The Guided wizard's env-var input was a `MultiValueInput` with no `max` prop, so it defaulted to 50 — the page happily accepted chip 31. Submit-time Zod validation then blocked navigation, but the NEXT button stayed enabled with no inline feedback; users saw "click NEXT, nothing happens".

Passing `max={30}` to the env-var `MultiValueInput` surfaces the cap in the field header (`N/30`), disables the input at the cap, and rejects pasted-past-cap input inline with the existing "Maximum 30 values" copy. Runtime dependencies (capped at 50 in both schemas) stay at the default, matching their real limit.
