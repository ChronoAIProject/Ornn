---
"ornn-web": patch
---

Document or replace `key={i}` on `Array.map` lists across the web app (#451). Every site flagged in the audit was reviewed: positional lists that never reorder (skeleton cards, OTP cells, code-editor line numbers, table skeletons) keep `key={i}` but now carry a one-line comment so a future audit doesn't churn the file. Data-driven lists that can re-shape (RootLayout breadcrumbs, CreateSkillFreePage validation messages) switch to composite keys that include the data identity, so reconciliation doesn't preserve hover/focus state on the wrong element when the source array changes shape.
