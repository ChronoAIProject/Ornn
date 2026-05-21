---
"ornn-web": patch
---

Fix Guided-create TagInput duplicate handling (#650 + #653).

Two bugs against the same code path:

- **#650** — typing a duplicate tag and pressing Enter left the rejected value in the input. The next typed character concatenated onto it, so `alpha` (rejected) + typing `beta` produced the tag `alphabeta`.
- **#653** — the duplicate was rejected silently with no feedback, so the user couldn't tell whether the tag was added or eaten.

Both fixed by:

1. Clearing the input on duplicate (nothing to fix — the existing tag is valid), matching the success path.
2. Surfacing `Already added` below the input on duplicate, mirroring `MultiValueInput`'s wording so the two multi-value components read the same.
3. Clearing the transient error on the next keystroke so it never blocks editing.

Pinned with a new `TagInput.test.tsx` (7 assertions covering the duplicate-clear-input contract, case/whitespace normalization, transient-error clearing, empty submissions, comma-commit, and Backspace removal).

`MultiValueInput` (env vars, runtime deps) has the same `input stays after duplicate` pattern but rejects different cases (e.g. validation errors where keeping the typo visible helps the user fix it). Out of scope here; if surfaced by users will be a separate ticket.
