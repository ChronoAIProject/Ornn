---
"ornn-web": patch
---

refactor(web): Editorial Forge migration — Phase A, shared UI primitives (#203). API surfaces unchanged; only internal styling migrates from legacy `neon-*` tokens to Editorial Forge semantic tokens (`bg-card`, `bg-accent`, `text-strong`, `border-subtle`, etc.). Affects `Button`, `Card`, `Modal`, `Badge`, `Input`, `Select`, `Toast`, `Pagination`, `EmptyState`, `NeonSkeleton`, `CategoryTooltip`. Foundation for the rest of the migration.
