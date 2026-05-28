---
"ornn-web": patch
---

`useSectionForm` validation errors now include the offending field path and rephrase length-1 string failures as "is required" instead of the raw `Too small: expected string to have >=1 characters` (#698).

The shared admin-settings form hook joined `i.message` only when surfacing Zod validation issues. The Mirror section (and every other section that uses `.min(1)` as a required-field gate) ended up emitting a single SectionShell alert that read like:

> Too small: expected string to have >=1 characters; Too small: expected string to have >=1 characters; Too small: expected string to have >=1 characters; ...

— with no indication of which fields needed filling.

Fix: prefix each issue with `path.join(".")`, and for the specific `code: "too_small"` + `type: "string"` + `minimum: 1` triple swap the message to `is required`. Renders as:

> owner: is required; repo: is required; branch: is required; appId: is required; installationId: is required; appPrivateKey: is required

— actionable from the alert alone, no schema-by-schema rewrite needed.

Per-section schemas can still ship their own friendlier messages (`.min(1, "Owner is required")`) — those flow through `i.message` unchanged.
