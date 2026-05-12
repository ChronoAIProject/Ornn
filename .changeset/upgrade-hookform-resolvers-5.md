---
"ornn-web": patch
---

Upgrade `@hookform/resolvers` 3 → 5. v5 changed the Resolver to reference the Zod output shape; form components are updated to use the `z.input` / `z.output` split so the form-state types and the submit-handler types are both correctly narrowed. Pure type refactor — no behaviour change.
