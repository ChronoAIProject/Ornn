---
"ornn-api": minor
"ornn-web": minor
---

Add caller-chosen, server-enforced generation modes to `POST /api/v1/skills/generate` (#1242). `mode: "simple"` asks for a single `SKILL.md`: the model gets a dedicated prompt and the server rejects any answer that is not a plain, file-less skill (one corrective retry, then a terminal `error`), so `generation_complete.raw` in simple mode never carries scripts, references or assets. `mode: "advanced"` — the default, and the pre-existing behaviour — lets the model emit `scripts[]` and, newly, `references[]` and `assets[]` text files. An unknown value fails with 400 `invalid_mode` before the quota reserve. The generative skill builder in ornn-web gains a Simple | Advanced toggle in the composer row (persisted like the model pick, locked while streaming), builds `references/` and `assets/` folders in the package preview, and now surfaces the server's problem+json detail when a generation request is rejected before the stream opens. The OpenAPI spec and the three agent manuals document the new field, the extended `raw` shape and the simple-mode guarantee.
