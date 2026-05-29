---
"ornn-web": patch
---

Replace the BroadcastsPage recipients tooltip with a real popover (#507).

The recipients column rendered the email list inside the native HTML `title` attribute as a `\n`-joined string. That broke two ways:

- **Safari** collapses `\n` to a single space inside `title`, so all emails ran together as one unreadable line.
- **All browsers** truncate / flicker the multi-line native tooltip past ~20 entries — long broadcast lists were unusable.

Replaced with an inline `RecipientsPopover` that mirrors `CategoryTooltip`'s pattern: hover OR click opens, click-outside / Esc / second-click closes, `aria-expanded` reflects state. The list is `max-h-64 overflow-y-auto` so 20+ recipients stay readable. Component is kept inline (BroadcastsPage is the only consumer) — promoting to `components/ui/` would be premature.

Kept the inline anchor as a `<button>` rather than a `<span>` so it's keyboard-focusable + screen-reader-announceable.
