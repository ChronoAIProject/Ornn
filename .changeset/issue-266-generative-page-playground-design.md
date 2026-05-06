---
"ornn-web": patch
---

Generative skill creation page now uses the same UI/UX language as the Playground: chat is the page hero (centered `max-w-2xl`), composer pinned at the bottom of the chat column with the model picker + quota chip centered above, ember-tinted user bubble + cool assistant bubble (15px / leading-7), spring entrance choreography on each turn, smart auto-scroll that respects manual scroll-up, and a right-edge slide-in drawer hosting the package preview + Save / Start-over actions. The drawer is **pinned-open by default** here because the package preview IS the work product (not auxiliary context like in the Playground). Closes #266.
