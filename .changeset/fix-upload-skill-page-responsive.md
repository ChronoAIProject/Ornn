---
"ornn-web": patch
---

Make the Build → Create Skill mode-selection page responsive. On 1366×768 / 1440×900 laptops the bottom row of cards used to be clipped because the page combined `overflow-hidden` parent, vertical centering, and a two-column grid for four cards. The page now scrolls when needed, uses a 1/2/3/4-column ladder, and shrinks card internals on narrow viewports.
