---
"ornn-web": patch
---

Playground model dropdown now flips upward when the trigger sits near the bottom of the viewport. Previously the menu always opened down, so long model lists got clipped under the composer bar. Smart placement: opens up only when remaining space below is less than the menu's max-height (320px) AND space above is larger; otherwise stays the default downward direction. Computed once per open before render, so no flicker.

Closes #300.
